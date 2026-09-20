use crate::models::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, MutexGuard,
    },
    time::Duration,
};
use uuid::Uuid;

type Result<T> = std::result::Result<T, String>;
fn error(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// SQLite 锁仅覆盖短事务；扫描解析和音频读取在锁外执行。
pub struct Library {
    connection: Mutex<Connection>,
    pub scanning: AtomicBool,
    pub cancel: AtomicBool,
}
impl Library {
    /// 首次建库使用事务；拒绝较新版本，防止旧应用破坏已有数据。
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(error)?;
        }
        let mut conn = Connection::open(path).map_err(error)?;
        conn.busy_timeout(Duration::from_secs(5)).map_err(error)?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
            .map_err(error)?;
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(error)?;
        if version > 2 {
            return Err("数据库版本高于当前应用，请使用更新版本的留声".into());
        }
        if version == 0 {
            if path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
                conn.backup("main", path.with_extension("before-v1.sqlite"), None)
                    .map_err(error)?;
            }
            let tx = conn.transaction().map_err(error)?;
            tx.execute_batch("CREATE TABLE IF NOT EXISTS directories (
                id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, active INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'ready');
                CREATE TABLE IF NOT EXISTS tracks (
                id TEXT PRIMARY KEY, directory_id TEXT NOT NULL REFERENCES directories(id), path TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT NOT NULL,
                seconds REAL NOT NULL DEFAULT 0, size INTEGER NOT NULL, modified TEXT NOT NULL,
                available INTEGER NOT NULL DEFAULT 1, favorite INTEGER NOT NULL DEFAULT 0,
                metadata_error TEXT NOT NULL DEFAULT '', last_seen TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS tracks_directory ON tracks(directory_id);
                CREATE TABLE IF NOT EXISTS categories (
                kind TEXT NOT NULL CHECK(kind IN ('groups','tags')), name TEXT NOT NULL COLLATE NOCASE,
                PRIMARY KEY(kind,name));
                CREATE TABLE IF NOT EXISTS track_categories (
                track_id TEXT NOT NULL REFERENCES tracks(id), kind TEXT NOT NULL, name TEXT NOT NULL COLLATE NOCASE,
                PRIMARY KEY(track_id,kind,name), FOREIGN KEY(kind,name) REFERENCES categories(kind,name) ON UPDATE CASCADE ON DELETE CASCADE);
                CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY,value TEXT NOT NULL);
                PRAGMA user_version=1;").map_err(error)?;
            tx.commit().map_err(error)?;
            log::info!("本地数据库初始化完成 schema=1");
        }
        if version < 2 {
            // 升级前备份收藏及播放状态；不喜欢标记不随文件元数据刷新而重置。
            conn.backup("main", path.with_extension("before-v2.sqlite"), None)
                .map_err(error)?;
            let tx = conn.transaction().map_err(error)?;
            tx.execute_batch(
                "ALTER TABLE tracks ADD COLUMN disliked INTEGER NOT NULL DEFAULT 0;
                PRAGMA user_version=2;",
            )
            .map_err(error)?;
            tx.commit().map_err(error)?;
            log::info!("本地数据库升级完成 schema=2");
        }
        Ok(Self {
            connection: Mutex::new(conn),
            scanning: AtomicBool::new(false),
            cancel: AtomicBool::new(false),
        })
    }
    fn conn(&self) -> Result<MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| "数据库锁异常，请重启应用".into())
    }
    /// 仅加载启用来源且未标记不喜欢的歌曲；隐藏记录仍保留用户偏好。
    /// 旧分组保留在数据库中，不再进入界面或筛选。
    pub fn load(&self) -> Result<LibraryData> {
        let conn = self.conn()?;
        let mut statement = conn.prepare("SELECT t.id,t.directory_id,t.filename,t.title,t.artist,t.album,t.seconds,
            t.available AND d.active AND d.status<>'offline',t.favorite,t.metadata_error FROM tracks t JOIN directories d ON d.id=t.directory_id
            WHERE d.active=1 AND t.disliked=0 ORDER BY t.title COLLATE NOCASE,t.id").map_err(error)?;
        let mut tracks: Vec<Track> = statement
            .query_map([], |r| {
                let id: String = r.get(0)?;
                Ok(Track {
                    art: id.bytes().fold(0u8, |a, b| a.wrapping_add(b)) % 8,
                    id,
                    directory_id: r.get(1)?,
                    filename: r.get(2)?,
                    title: r.get(3)?,
                    artist: r.get(4)?,
                    album: r.get(5)?,
                    seconds: r.get(6)?,
                    available: r.get(7)?,
                    favorite: r.get(8)?,
                    metadata_error: r.get(9)?,
                    tags: vec![],
                })
            })
            .map_err(error)?
            .collect::<std::result::Result<_, _>>()
            .map_err(error)?;
        let positions: HashMap<String, usize> = tracks
            .iter()
            .enumerate()
            .map(|(i, t)| (t.id.clone(), i))
            .collect();
        let mut associations = conn
            .prepare("SELECT track_id,name FROM track_categories WHERE kind='tags' ORDER BY name")
            .map_err(error)?;
        for row in associations
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(error)?
        {
            let (id, name) = row.map_err(error)?;
            if let Some(&i) = positions.get(&id) {
                tracks[i].tags.push(name);
            }
        }
        let mut dirs = conn.prepare("SELECT d.id,d.path,d.status,COUNT(t.id) FROM directories d LEFT JOIN tracks t ON t.directory_id=d.id AND t.disliked=0 WHERE d.active=1 GROUP BY d.id ORDER BY d.path").map_err(error)?;
        let directories = dirs
            .query_map([], |r| {
                Ok(Directory {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    status: r.get(2)?,
                    count: r.get::<_, i64>(3)? as usize,
                })
            })
            .map_err(error)?
            .collect::<std::result::Result<_, _>>()
            .map_err(error)?;
        let mut cats = conn
            .prepare("SELECT name FROM categories WHERE kind='tags' ORDER BY name")
            .map_err(error)?;
        let tags = cats
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(error)?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(error)?;
        let state: Option<String> = conn
            .query_row(
                "SELECT value FROM app_state WHERE key='playback'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?;
        let mut settings = state
            .map(|v| serde_json::from_str::<serde_json::Value>(&v))
            .transpose()
            .map_err(error)?
            .unwrap_or(serde_json::json!({}));
        let queue: Option<String> = conn
            .query_row("SELECT value FROM app_state WHERE key='queue'", [], |r| {
                r.get(0)
            })
            .optional()
            .map_err(error)?;
        settings["queue"] = queue
            .map(|v| serde_json::from_str(&v))
            .transpose()
            .map_err(error)?
            .unwrap_or(serde_json::json!([]));
        let offsets: Option<String> = conn
            .query_row(
                "SELECT value FROM app_state WHERE key='lyric_offsets'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(error)?;
        settings["lyricOffsets"] = offsets
            .map(|v| serde_json::from_str(&v))
            .transpose()
            .map_err(error)?
            .unwrap_or(serde_json::json!({}));
        Ok(LibraryData {
            tracks,
            directories,
            tags,
            settings,
        })
    }
    /// 目录必须来自原生选择器；同根目录重新添加复用原来的歌曲 ID。
    pub fn add_directory(&self, path: &Path) -> Result<String> {
        let path = path
            .canonicalize()
            .map_err(|_| "无法访问所选目录，请检查权限或磁盘连接".to_string())?;
        if !path.is_dir() {
            return Err("请选择音乐文件夹".into());
        }
        let mut conn = self.conn()?;
        let active: Vec<String> = conn
            .prepare("SELECT path FROM directories WHERE active=1")
            .map_err(error)?
            .query_map([], |r| r.get(0))
            .map_err(error)?
            .collect::<std::result::Result<_, _>>()
            .map_err(error)?;
        for other in active {
            let other = Path::new(&other);
            if path.starts_with(other) || other.starts_with(&path) {
                return Err("所选目录与现有目录重复或重叠，请使用刷新，或先移除重叠目录".into());
            }
        }
        let text = path.to_str().ok_or("目录名称不是有效 Unicode，无法导入")?;
        let tx = conn.transaction().map_err(error)?;
        tx.execute("INSERT INTO directories(id,path,active,status) VALUES(?1,?2,1,'ready') ON CONFLICT(path) DO UPDATE SET active=1,status='ready'", params![Uuid::new_v4().to_string(),text]).map_err(error)?;
        let id = tx
            .query_row("SELECT id FROM directories WHERE path=?1", [text], |r| {
                r.get(0)
            })
            .map_err(error)?;
        tx.commit().map_err(error)?;
        log::info!("添加音乐目录 id={id}");
        Ok(id)
    }
    pub fn roots(&self) -> Result<Vec<(String, PathBuf)>> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare("SELECT id,path FROM directories WHERE active=1")
            .map_err(error)?;
        let result = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, PathBuf::from(r.get::<_, String>(1)?)))
            })
            .map_err(error)?
            .collect::<std::result::Result<_, _>>()
            .map_err(error)?;
        Ok(result)
    }
    pub fn known_files(&self, id: &str) -> Result<HashMap<String, (i64, String)>> {
        let conn = self.conn()?;
        let mut stmt = conn
            .prepare(
                "SELECT path,size,modified FROM tracks WHERE directory_id=?1 AND metadata_error=''",
            )
            .map_err(error)?;
        let result = stmt
            .query_map([id], |r| Ok((r.get(0)?, (r.get(1)?, r.get(2)?))))
            .map_err(error)?
            .collect::<std::result::Result<_, _>>()
            .map_err(error)?;
        Ok(result)
    }
    /// 只更新文件元数据，绝不覆盖用户收藏与分类关系。
    pub fn index_batch(&self, root: &str, scan: &str, batch: &[IndexedFile]) -> Result<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction().map_err(error)?;
        for file in batch {
            if let Some(m) = &file.metadata {
                tx.execute("INSERT INTO tracks(id,directory_id,path,filename,title,artist,album,seconds,size,modified,available,last_seen,metadata_error)
                    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?12)
                    ON CONFLICT(path) DO UPDATE SET directory_id=excluded.directory_id,filename=excluded.filename,title=excluded.title,
                    artist=excluded.artist,album=excluded.album,seconds=excluded.seconds,size=excluded.size,modified=excluded.modified,
                    available=1,last_seen=excluded.last_seen,metadata_error=excluded.metadata_error",
                    params![Uuid::new_v4().to_string(),root,file.path,file.filename,m.title,m.artist,m.album,m.seconds,file.size,file.modified,scan,m.error]).map_err(error)?;
            } else {
                tx.execute(
                    "UPDATE tracks SET available=1,last_seen=?1 WHERE path=?2 AND directory_id=?3",
                    params![scan, file.path, root],
                )
                .map_err(error)?;
            }
        }
        tx.commit().map_err(error)?;
        Ok(())
    }
    /// 仅完整扫描后删除未见歌曲；离线、取消及读取失败时保留索引。
    pub fn finish_scan(&self, id: &str, scan: &str, status: &str, complete: bool) -> Result<usize> {
        let mut conn = self.conn()?;
        let tx = conn.transaction().map_err(error)?;
        let mut removed = 0;
        if complete {
            // 旧表没有歌曲级联删除，先清理关联，保留用户创建的分组和标签本身。
            tx.execute("DELETE FROM track_categories WHERE track_id IN (SELECT id FROM tracks WHERE directory_id=?1 AND last_seen<>?2)", params![id, scan]).map_err(error)?;
            removed = tx
                .execute(
                    "DELETE FROM tracks WHERE directory_id=?1 AND last_seen<>?2",
                    params![id, scan],
                )
                .map_err(error)?;
            if removed > 0 {
                prune_playback(&tx)?;
            }
        }
        tx.execute(
            "UPDATE directories SET status=?1 WHERE id=?2",
            params![status, id],
        )
        .map_err(error)?;
        tx.commit().map_err(error)?;
        if removed > 0 {
            log::info!("清理缺失歌曲 root={id} removed={removed}");
        }
        Ok(removed)
    }
    /// 只允许打开已添加且启用的目录，前端不能提供任意路径或命令参数。
    pub fn directory_path(&self, id: &str) -> Result<PathBuf> {
        if Uuid::parse_str(id).is_err() {
            return Err("音乐文件夹 ID 无效".into());
        }
        let path: String = self
            .conn()?
            .query_row(
                "SELECT path FROM directories WHERE id=?1 AND active=1",
                [id],
                |r| r.get(0),
            )
            .map_err(|_| "音乐文件夹不存在或已移除".to_string())?;
        let real = Path::new(&path)
            .canonicalize()
            .map_err(|e| format!("无法打开音乐文件夹：{e}"))?;
        if !real.is_dir() {
            return Err("音乐文件夹已不存在".into());
        }
        Ok(real)
    }
    pub fn remove_directory(&self, id: &str) -> Result<()> {
        if self.scanning.load(Ordering::SeqCst) {
            return Err("请等待或取消当前扫描，再移除目录".into());
        }
        self.conn()?
            .execute(
                "UPDATE directories SET active=0,status='removed' WHERE id=?1",
                [id],
            )
            .map_err(error)?;
        log::info!("移除音乐目录来源 id={id}");
        Ok(())
    }
    pub fn favorite(&self, id: &str, value: bool) -> Result<()> {
        if self
            .conn()?
            .execute(
                "UPDATE tracks SET favorite=?1 WHERE id=?2",
                params![value, id],
            )
            .map_err(error)?
            == 0
        {
            return Err("歌曲不存在".into());
        }
        log::info!("更新收藏 track={id} favorite={value}");
        Ok(())
    }
    /// 仅隐藏曲库记录，保留原文件；刷新时按路径更新元数据不会清除此标记。
    pub fn dislike(&self, id: &str) -> Result<()> {
        let mut conn = self.conn()?;
        let tx = conn.transaction().map_err(error)?;
        if tx.execute("UPDATE tracks SET disliked=1 WHERE id=?1 AND directory_id IN (SELECT id FROM directories WHERE active=1)", [id]).map_err(error)? == 0 {
            return Err("歌曲不存在或来源已移除".into());
        }
        prune_playback(&tx)?;
        tx.commit().map_err(error)?;
        log::info!("标记不喜欢 track={id}");
        Ok(())
    }
    /// 确认删除后仅移除索引对应的 MP3；复用扫描互斥，避免在删除后被旧批次重新收录。
    pub fn delete_track(&self, id: &str) -> Result<()> {
        if self.scanning.swap(true, Ordering::SeqCst) {
            return Err("请等待当前扫描或删除完成后再删除歌曲".into());
        }
        let result = (|| {
            let path = self.media_path(id)?;
            let mut conn = self.conn()?;
            let tx = conn.transaction().map_err(error)?;
            tx.execute("DELETE FROM track_categories WHERE track_id=?1", [id])
                .map_err(error)?;
            tx.execute("DELETE FROM tracks WHERE id=?1", [id])
                .map_err(error)?;
            prune_playback(&tx)?;
            // 先完成可回滚的数据库写入；文件删除失败则自动回滚，保留曲库记录供重试。
            std::fs::remove_file(&path).map_err(|e| format!("删除文件失败：{e}"))?;
            tx.commit()
                .map_err(|e| format!("文件已删除，但曲库保存失败，请刷新曲库：{e}"))?;
            log::info!("物理删除歌曲 track={id}");
            Ok(())
        })();
        self.scanning.store(false, Ordering::SeqCst);
        result.inspect_err(|e| log::error!("删除歌曲失败 track={id} reason={e}"))
    }
    /// 所有分类写入通过参数绑定，更新与删除由外键级联保持关联一致。
    /// 标签管理沿用旧表结构，停用分组写入但不迁移或删除历史数据。
    pub fn category(
        &self,
        kind: &str,
        operation: &str,
        name: &str,
        next: Option<&str>,
    ) -> Result<()> {
        if kind != "tags" {
            return Err("分类类型无效".into());
        }
        validate_name(name)?;
        if let Some(n) = next {
            validate_name(n)?;
        }
        let conn = self.conn()?;
        let result = match operation {
            "create" => conn.execute(
                "INSERT INTO categories(kind,name) VALUES(?1,?2)",
                params![kind, name.trim()],
            ),
            "rename" => conn.execute(
                "UPDATE categories SET name=?1 WHERE kind=?2 AND name=?3",
                params![next.ok_or("缺少新名称")?.trim(), kind, name],
            ),
            "delete" => conn.execute(
                "DELETE FROM categories WHERE kind=?1 AND name=?2",
                params![kind, name],
            ),
            _ => return Err("分类操作无效".into()),
        };
        result.map_err(|e| {
            log::warn!("分类写入失败 kind={kind} op={operation} reason={e}");
            "分类名称重复或保存失败".to_string()
        })?;
        log::info!("分类写入 kind={kind} op={operation}");
        Ok(())
    }
    /// 在单个事务中批量更新歌曲标签，旧分组关联保持不变。
    pub fn assign(&self, assignment: Assignment) -> Result<()> {
        if assignment.ids.is_empty()
            || assignment.ids.len() > 15000
            || !["replace", "add", "remove"].contains(&assignment.operation.as_str())
        {
            return Err("分类操作参数无效".into());
        }
        if assignment.tags.len() > 500 {
            return Err("一次最多选择 500 个标签".into());
        }
        let mut conn = self.conn()?;
        let tx = conn.transaction().map_err(error)?;
        for id in &assignment.ids {
            // 替换范围限定为标签，升级后的首次编辑不会清空旧分组记录。
            if assignment.operation == "replace" {
                tx.execute(
                    "DELETE FROM track_categories WHERE track_id=?1 AND kind='tags'",
                    [id],
                )
                .map_err(error)?;
            }
            for name in &assignment.tags {
                validate_name(name)?;
                if assignment.operation == "remove" {
                    tx.execute("DELETE FROM track_categories WHERE track_id=?1 AND kind='tags' AND name=?2", params![id,name]).map_err(error)?;
                } else {
                    tx.execute("INSERT INTO track_categories(track_id,kind,name) VALUES(?1,'tags',?2) ON CONFLICT DO NOTHING", params![id,name]).map_err(error)?;
                }
            }
        }
        tx.commit().map_err(error)?;
        log::info!(
            "批量分类完成 count={} op={}",
            assignment.ids.len(),
            assignment.operation
        );
        Ok(())
    }
    /// 保存播放状态；歌词校准仅在用户调整时更新，避免周期性覆盖。
    pub fn save_settings(&self, s: PlaybackSettings) -> Result<()> {
        if s.skin.len() > 64
            || !s.volume.is_finite()
            || !(0.0..=1.0).contains(&s.volume)
            || !s.position.is_finite()
            || s.position < 0.0
            || !["order", "single", "shuffle"].contains(&s.mode.as_str())
        {
            return Err("播放设置无效".into());
        }
        if s.current
            .as_ref()
            .is_some_and(|id| Uuid::parse_str(id).is_err())
            || s.queue
                .as_ref()
                .is_some_and(|q| q.len() > 15000 || q.iter().any(|id| Uuid::parse_str(id).is_err()))
        {
            return Err("播放队列无效".into());
        }
        if s.lyric_offsets.as_ref().is_some_and(|offsets| {
            offsets.len() > 15000
                || offsets.iter().any(|(id, seconds)| {
                    Uuid::parse_str(id).is_err() || !seconds.is_finite() || seconds.abs() > 30.0
                })
        }) {
            return Err("歌词时间偏移无效".into());
        }
        let mut conn = self.conn()?;
        let tx = conn.transaction().map_err(error)?;
        // 校准独立保存，旧页面和周期性进度保存都不能清空已有偏移。
        if let Some(ref offsets) = s.lyric_offsets {
            tx.execute("INSERT INTO app_state VALUES('lyric_offsets',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                [serde_json::to_string(offsets).map_err(error)?]).map_err(error)?;
        }
        let value = serde_json::json!({"skin":s.skin,"volume":s.volume,"mode":s.mode,"current":s.current,"position":s.position});
        tx.execute("INSERT INTO app_state VALUES('playback',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[value.to_string()]).map_err(error)?;
        if let Some(queue) = s.queue {
            tx.execute("INSERT INTO app_state VALUES('queue',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value",[serde_json::to_string(&queue).map_err(error)?]).map_err(error)?;
        }
        // 页面旧快照可能晚于隐藏或删除完成，写入时再次清理，防止失效歌曲回到队列。
        prune_playback(&tx)?;
        tx.commit().map_err(error)?;
        if let Some(offsets) = s.lyric_offsets {
            log::info!("保存歌词校准 count={}", offsets.len());
        }
        Ok(())
    }
    /// 每次媒体请求均重新校验目录启用状态与真实路径，移除目录即时撤销读取权。
    pub fn media_path(&self, id: &str) -> Result<PathBuf> {
        if Uuid::parse_str(id).is_err() {
            return Err("歌曲 ID 无效".into());
        }
        let (path,root): (String,String)=self.conn()?.query_row("SELECT t.path,d.path FROM tracks t JOIN directories d ON t.directory_id=d.id WHERE t.id=?1 AND d.active=1 AND t.available=1 AND t.disliked=0",[id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_| "歌曲或目录不可用".to_string())?;
        let real = Path::new(&path)
            .canonicalize()
            .map_err(|_| "文件不存在或无权限".to_string())?;
        if real != Path::new(&path)
            || !real.starts_with(Path::new(&root))
            || !real
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("mp3"))
        {
            return Err("文件不在授权的音乐目录内".into());
        }
        Ok(real)
    }
}
/// 与曲库可见范围一致；扫描清理、单曲操作及旧快照保存共用同一事务内的引用清理。
fn prune_playback(conn: &Connection) -> Result<()> {
    conn.execute("UPDATE app_state SET value=(SELECT json_group_array(j.value ORDER BY CAST(j.key AS INTEGER)) FROM json_each(app_state.value) j JOIN tracks t ON t.id=j.value JOIN directories d ON d.id=t.directory_id WHERE t.disliked=0 AND d.active=1) WHERE key='queue'", []).map_err(error)?;
    conn.execute("UPDATE app_state SET value=(SELECT json_group_object(j.key,j.value) FROM json_each(app_state.value) j JOIN tracks t ON t.id=j.key JOIN directories d ON d.id=t.directory_id WHERE t.disliked=0 AND d.active=1) WHERE key='lyric_offsets'", []).map_err(error)?;
    conn.execute("UPDATE app_state SET value=json_set(value,'$.current',NULL,'$.position',0) WHERE key='playback' AND json_extract(value,'$.current') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tracks t JOIN directories d ON d.id=t.directory_id WHERE t.id=json_extract(app_state.value,'$.current') AND t.disliked=0 AND d.active=1)", []).map_err(error)?;
    Ok(())
}
fn validate_name(name: &str) -> Result<()> {
    if name.trim().is_empty() || name.chars().count() > 30 || name.chars().any(char::is_control) {
        Err("分类名称需为 1～30 个非控制字符".into())
    } else {
        Ok(())
    }
}

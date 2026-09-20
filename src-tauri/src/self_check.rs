use crate::{database::Library, lyrics, media, models::*, scanner};
use std::{fs, path::PathBuf};

/// 无需测试框架的端到端自查：临时曲库、持久化、范围读取及撤销目录授权。
pub fn run() -> Result<(), String> {
    for (filename, title, artist, expected_title, expected_artist) in [
        (
            "001.可爱女人 - 周杰伦",
            None,
            Some("米羊羊音乐"),
            "可爱女人",
            "周杰伦",
        ),
        (
            "013.泡沫 - G.E.M. 邓紫棋",
            None,
            None,
            "泡沫",
            "G.E.M. 邓紫棋",
        ),
        ("01.周杰伦 - 晴天", None, Some("周杰伦"), "晴天", "周杰伦"),
        ("01.周杰伦 - 晴天", Some("晴天"), None, "晴天", "周杰伦"),
        ("歌名 - 歌手", Some("歌名"), None, "歌名", "歌手"),
        ("测试歌手 - 测试歌曲", None, None, "测试歌曲", "测试歌手"),
        (
            "001.文件名 - 来源",
            Some("正确歌名"),
            Some("正确歌手"),
            "正确歌名",
            "正确歌手",
        ),
        ("001.歌名 - 歌手", Some(" "), Some(" "), "歌名", "歌手"),
        ("01 曲名", None, None, "曲名", "未知歌手"),
        (
            "2002年的第一场雪",
            None,
            None,
            "2002年的第一场雪",
            "未知歌手",
        ),
        ("7 rings", None, None, "7 rings", "未知歌手"),
        (
            "A-Lin - 给我一个理由忘记",
            None,
            None,
            "给我一个理由忘记",
            "A-Lin",
        ),
    ] {
        assert_eq!(
            scanner::resolve_track_names(filename, title, artist),
            (expected_title.into(), expected_artist.into())
        );
    }
    println!("PASS: 编号歌单、发行方标签、歌名歌手顺序、有效标签优先与数字歌名保护");
    #[cfg(target_os = "macos")]
    crate::tray::self_check();
    let root = std::env::temp_dir().join(format!("liusheng-check-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("音乐/子目录")).map_err(|e| e.to_string())?;
    let result = check(&root).and_then(|_| {
        // 单曲操作仅使用隔离样本；同时覆盖旧库升级和文件删除失败后的事务回滚。
        let music = root.join("单曲操作");
        fs::create_dir_all(&music).map_err(|e| e.to_string())?;
        for name in ["不喜欢", "删除", "保留"] {
            fs::write(music.join(format!("{name}.mp3")), vec![1u8; 2048]).map_err(|e| e.to_string())?;
        }
        let db_path = root.join("actions.sqlite");
        let library = Library::open(&db_path)?;
        let directory_id = library.add_directory(&music)?;
        scanner::scan(&library, None, |_| {})?;
        let data = library.load()?;
        let disliked = &data.tracks.iter().find(|t| t.title == "不喜欢").unwrap().id;
        let deleted = &data.tracks.iter().find(|t| t.title == "删除").unwrap().id;
        let retained = &data.tracks.iter().find(|t| t.title == "保留").unwrap().id;
        library.favorite(retained, true)?;
        drop(library);
        let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
        conn.execute_batch("ALTER TABLE tracks DROP COLUMN disliked; PRAGMA user_version=1;").map_err(|e| e.to_string())?;
        let library = Library::open(&db_path)?;
        assert!(db_path.with_extension("before-v2.sqlite").exists());
        assert!(library.load()?.tracks.iter().find(|t| t.id == *retained).unwrap().favorite);
        library.category("tags", "create", "删除关联", None)?;
        library.assign(Assignment { ids: vec![deleted.clone()], tags: vec!["删除关联".into()], operation: "replace".into() })?;
        let settings = serde_json::json!({"skin":"dark","volume":0.5,"mode":"order",
            "current":deleted,"position":10,"queue":[retained,disliked,deleted,retained],
            "lyricOffsets":{deleted:0.4,disliked:0.2,retained:-0.2}});
        library.save_settings(serde_json::from_value(settings.clone()).map_err(|e| e.to_string())?)?;
        library.dislike(disliked)?;
        assert!(music.join("不喜欢.mp3").exists());
        assert!(library.media_path(disliked).is_err());
        library.remove_directory(&directory_id)?;
        assert_eq!(library.add_directory(&music)?, directory_id);
        scanner::scan(&library, Some(&directory_id), |_| {})?;
        scanner::scan(&library, None, |_| {})?;
        let reopened = Library::open(&db_path)?.load()?;
        assert_eq!(reopened.tracks.len(), 2);
        assert_eq!(reopened.directories[0].count, 2);
        assert!(!reopened.tracks.iter().any(|t| t.id == *disliked));
        assert_eq!(reopened.settings["queue"], serde_json::json!([retained,deleted,retained]));
        assert!(library.delete_track("../../outside.mp3").is_err());
        library.scanning.store(true, std::sync::atomic::Ordering::SeqCst);
        assert!(library.delete_track(deleted).is_err());
        library.scanning.store(false, std::sync::atomic::Ordering::SeqCst);
        let path = music.join("删除.mp3");
        let moved = music.join("删除.backup");
        fs::rename(&path, &moved).map_err(|e| e.to_string())?;
        fs::create_dir(&path).map_err(|e| e.to_string())?;
        assert!(library.delete_track(deleted).is_err());
        assert_eq!(library.load()?.tracks.len(), 2);
        assert_eq!(library.load()?.tracks.iter().find(|t| t.id == *deleted).unwrap().tags, vec!["删除关联"]);
        assert_eq!(library.load()?.settings["current"], *deleted);
        fs::remove_dir(&path).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            let outside = root.join("outside.mp3");
            fs::write(&outside, "不能删除目录外文件").map_err(|e| e.to_string())?;
            std::os::unix::fs::symlink(&outside, &path).map_err(|e| e.to_string())?;
            assert!(library.delete_track(deleted).is_err());
            assert!(outside.exists());
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        fs::rename(&moved, &path).map_err(|e| e.to_string())?;
        let lrc = path.with_extension("lrc");
        fs::write(&lrc, "保留独立歌词文件").map_err(|e| e.to_string())?;
        library.delete_track(deleted)?;
        assert!(!path.exists());
        assert!(lrc.exists() && music.join("保留.mp3").exists());
        // 延迟到达的播放快照不得把不喜欢或已删除歌曲带回队列。
        library.save_settings(serde_json::from_value(settings).map_err(|e| e.to_string())?)?;
        scanner::scan(&library, None, |_| {})?;
        let reopened = Library::open(&db_path)?.load()?;
        assert_eq!(reopened.tracks.len(), 1);
        assert_eq!(reopened.tracks[0].id, *retained);
        assert!(reopened.tracks[0].favorite);
        assert_eq!(reopened.settings["queue"], serde_json::json!([retained,retained]));
        assert!(reopened.settings["current"].is_null());
        assert_eq!(reopened.settings["position"], 0);
        assert_eq!(reopened.settings["lyricOffsets"], serde_json::json!({retained:-0.2}));
        let associations: i64 = conn.query_row("SELECT COUNT(*) FROM track_categories WHERE track_id=?1", [deleted], |row| row.get(0)).map_err(|e| e.to_string())?;
        assert_eq!(associations, 0);
        println!("PASS: 旧库升级、不喜欢持久化与重新导入、物理删除、扫描互斥、越界拒绝、失败回滚及旧队列清理");
        Ok(())
    });
    let _ = fs::remove_dir_all(&root);
    result
}
fn check(root: &std::path::Path) -> Result<(), String> {
    let music = root.join("音乐");
    let path = music.join("子目录/测试歌手 - 测试歌曲.MP3");
    // 损坏的音频仍应被收录，标签失败不得终止扫描。
    fs::write(&path, vec![1u8; 2048]).map_err(|e| e.to_string())?;
    let library = Library::open(&root.join("data/library.sqlite"))?;
    let id = library.add_directory(&music)?;
    assert!(library.add_directory(&music.join("子目录")).is_err());
    assert_eq!(
        library.directory_path(&id)?,
        music.canonicalize().map_err(|e| e.to_string())?
    );
    assert!(library.directory_path("../../outside").is_err());
    scanner::scan(&library, None, |_| {})?;
    let data = library.load()?;
    assert_eq!(data.tracks.len(), 1);
    let track = &data.tracks[0];
    assert_eq!(track.title, "测试歌曲");
    assert!(!track.metadata_error.is_empty());
    let lrc = path.with_extension("LRC");
    fs::write(&lrc, "[00:01.20]中文歌词").map_err(|e| e.to_string())?;
    assert_eq!(
        lyrics::load(&library, &track.id)?.text,
        "[00:01.20]中文歌词"
    );
    let (gbk, _, _) = encoding_rs::GBK.encode("[00:02]旧编码歌词");
    fs::write(&lrc, &gbk).map_err(|e| e.to_string())?;
    assert!(lyrics::load(&library, &track.id)?
        .text
        .contains("旧编码歌词"));
    let utf16: Vec<u8> = [0xff, 0xfe]
        .into_iter()
        .chain("带标记歌词".encode_utf16().flat_map(u16::to_le_bytes))
        .collect();
    fs::write(&lrc, utf16).map_err(|e| e.to_string())?;
    assert_eq!(lyrics::load(&library, &track.id)?.text, "带标记歌词");
    fs::write(&lrc, vec![b'a'; 1024 * 1024 + 1]).map_err(|e| e.to_string())?;
    assert!(lyrics::load(&library, &track.id).is_err());
    fs::remove_file(&lrc).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        let outside = root.join("outside.lrc");
        fs::write(&outside, "不可越界读取").map_err(|e| e.to_string())?;
        std::os::unix::fs::symlink(&outside, &lrc).map_err(|e| e.to_string())?;
        assert!(lyrics::load(&library, &track.id).is_err());
        fs::remove_file(&lrc).map_err(|e| e.to_string())?;
    }
    assert!(lyrics::load(&library, "../../outside.lrc").is_err());
    println!("PASS: 同名 LRC、UTF-8 / UTF-16 / GBK、歌词体积限制及目录边界");
    library.favorite(&track.id, true)?;
    // 模拟升级前的分组，功能下线后保留历史记录，但拒绝继续编辑。
    let legacy =
        rusqlite::Connection::open(root.join("data/library.sqlite")).map_err(|e| e.to_string())?;
    legacy
        .execute(
            "INSERT INTO categories(kind,name) VALUES('groups','夜行')",
            [],
        )
        .map_err(|e| e.to_string())?;
    legacy
        .execute(
            "INSERT INTO track_categories(track_id,kind,name) VALUES(?1,'groups','夜行')",
            [&track.id],
        )
        .map_err(|e| e.to_string())?;
    assert!(library.category("groups", "create", "通勤", None).is_err());
    library.category("tags", "create", "安静", None)?;
    assert!(library.category("tags", "create", "安静", None).is_err());
    library.assign(Assignment {
        ids: vec![track.id.clone()],
        tags: vec!["安静".into()],
        operation: "replace".into(),
    })?;
    library.category("tags", "rename", "安静", Some("轻柔"))?;
    library.category("tags", "rename", "轻柔", Some("安静"))?;
    let req = tauri::http::Request::builder()
        .uri(format!("music://localhost/{}", track.id))
        .header("Range", "bytes=100-199")
        .body(vec![])
        .unwrap();
    let response = media::respond(&library, req);
    assert_eq!(response.status(), 206);
    assert_eq!(response.body().len(), 100);
    assert_eq!(media::byte_range("bytes=-50", 100), Some((50, 99)));
    assert_eq!(media::byte_range("bytes=100-", 100), None);
    assert_eq!(media::byte_range("bytes=0-1,4-5", 100), None);
    assert!(library.media_path("../../etc/passwd").is_err());
    library.finish_scan(&id, "incomplete", "error", false)?;
    assert!(library.load()?.tracks[0].available);
    library.remove_directory(&id)?;
    // 移除来源后立即退出曲库，刷新及重启也不能带回旧记录。
    assert!(library.load()?.tracks.is_empty());
    scanner::scan(&library, None, |_| {})?;
    assert!(library.load()?.tracks.is_empty());
    assert!(Library::open(&root.join("data/library.sqlite"))?
        .load()?
        .tracks
        .is_empty());
    assert!(library.directory_path(&id).is_err());
    assert!(library.media_path(&track.id).is_err());
    assert!(lyrics::load(&library, &track.id).is_err());
    assert!(path.exists());
    let restored = library.add_directory(&music)?;
    assert_eq!(restored, id);
    scanner::scan(&library, None, |_| {})?;
    let restored = library.load()?;
    assert_eq!(restored.tracks[0].id, track.id);
    assert!(restored.tracks[0].favorite);
    assert_eq!(restored.tracks[0].tags, vec!["安静"]);
    let old_groups: i64 = legacy
        .query_row(
            "SELECT COUNT(*) FROM track_categories WHERE track_id=?1 AND kind='groups'",
            [&track.id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    assert_eq!(old_groups, 1);
    assert!(serde_json::to_value(&restored)
        .map_err(|e| e.to_string())?
        .get("groups")
        .is_none());
    drop(legacy);
    println!("PASS: 分组功能下线、标签替换与重命名、旧分组数据保留");
    library.save_settings(PlaybackSettings {
        skin: "light".into(),
        volume: 0.6,
        mode: "order".into(),
        current: Some(track.id.clone()),
        position: 1.2,
        queue: Some(vec![track.id.clone()]),
        lyric_offsets: Some([(track.id.clone(), 0.4)].into_iter().collect()),
    })?;
    // 旧页面不传校准字段时保留偏移，非法输入不能部分写入播放设置。
    let old_settings = serde_json::json!({"skin":"light","volume":0.6,"mode":"order",
        "current":track.id,"position":1.2});
    library
        .save_settings(serde_json::from_value(old_settings.clone()).map_err(|e| e.to_string())?)?;
    for (key, value) in [
        (track.id.as_str(), 30.2),
        ("invalid-id", 0.2),
        (track.id.as_str(), -30.2),
    ] {
        let mut invalid = old_settings.clone();
        invalid["lyricOffsets"] = serde_json::json!({key: value});
        assert!(library
            .save_settings(serde_json::from_value(invalid).map_err(|e| e.to_string())?)
            .is_err());
    }
    assert_eq!(library.load()?.settings["lyricOffsets"][&track.id], 0.4);
    println!("PASS: 歌词校准保存、旧设置兼容、范围与歌曲 ID 校验");
    let persisted = Library::open(&root.join("data/library.sqlite"))?.load()?;
    assert!(persisted.tracks[0].favorite);
    assert_eq!(persisted.settings["lyricOffsets"][&track.id], 0.4);
    // 另一目录的歌曲及队列顺序不能被本目录的缺失清理波及。
    let other_root = root.join("保留 音乐 & test");
    fs::create_dir_all(&other_root).map_err(|e| e.to_string())?;
    let other_path = other_root.join("保留歌曲.mp3");
    fs::write(&other_path, vec![1u8; 2048]).map_err(|e| e.to_string())?;
    let other_id = library.add_directory(&other_root)?;
    scanner::scan(&library, Some(&other_id), |_| {})?;
    assert_eq!(
        library.directory_path(&other_id)?,
        other_root.canonicalize().map_err(|e| e.to_string())?
    );
    let retained = library
        .load()?
        .tracks
        .into_iter()
        .find(|t| t.directory_id == other_id)
        .unwrap();
    let mut playback = old_settings.clone();
    playback["queue"] = serde_json::json!([retained.id, track.id, retained.id]);
    playback["lyricOffsets"] = serde_json::json!({&track.id:0.4, &retained.id:-0.2});
    library.save_settings(serde_json::from_value(playback).map_err(|e| e.to_string())?)?;
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    library.finish_scan(&id, "partial", "error", false)?;
    assert_eq!(library.load()?.tracks.len(), 2);
    // 目录暂时离线和主动取消都不能将未见歌曲视为已删除。
    let offline = root.join("临时离线");
    fs::rename(&music, &offline).map_err(|e| e.to_string())?;
    assert!(library.directory_path(&id).is_err());
    assert_eq!(scanner::scan(&library, Some(&id), |_| {})?.removed, 0);
    let offline_tracks = library.load()?.tracks;
    assert_eq!(offline_tracks.len(), 2);
    assert!(offline_tracks
        .iter()
        .any(|t| t.id == track.id && !t.available));
    fs::rename(&offline, &music).map_err(|e| e.to_string())?;
    let cancelled = scanner::scan(&library, Some(&id), |progress| {
        if !progress.finished {
            library
                .cancel
                .store(true, std::sync::atomic::Ordering::SeqCst);
        }
    })?;
    assert!(cancelled.cancelled);
    assert_eq!(cancelled.removed, 0);
    assert_eq!(library.load()?.tracks.len(), 2);
    assert_eq!(scanner::scan(&library, None, |_| {})?.removed, 1);
    assert_eq!(scanner::scan(&library, None, |_| {})?.removed, 0);
    assert!(other_path.exists());
    library.category("tags", "delete", "安静", None)?;
    drop(library);
    let reopened = Library::open(&root.join("data/library.sqlite"))?.load()?;
    assert_eq!(reopened.tracks.len(), 1);
    assert_eq!(reopened.tracks[0].id, retained.id);
    assert_eq!(reopened.settings["skin"], "light");
    assert!(reopened.settings["current"].is_null());
    assert_eq!(reopened.settings["position"], 0);
    assert_eq!(
        reopened.settings["queue"],
        serde_json::json!([retained.id, retained.id])
    );
    assert!(reopened.settings["lyricOffsets"].get(&track.id).is_none());
    assert_eq!(reopened.settings["lyricOffsets"][&retained.id], -0.2);
    let conn =
        rusqlite::Connection::open(root.join("data/library.sqlite")).map_err(|e| e.to_string())?;
    let associations: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM track_categories WHERE track_id=?1",
            [&track.id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    assert_eq!(associations, 0);
    println!("PASS: 缺失歌曲删除、分类与队列及歌词偏移清理、跨目录隔离、重复刷新、离线及取消保护、打开目录路径校验");
    println!("PASS: 目录扫描、损坏标签降级、收藏/分类持久化、目录撤销/恢复、字节范围和路径边界");
    // 有外部提供的真实 MP3 样本时，额外校验时长与元数据解析。
    if let Some(sample) = std::env::var_os("LIUSHENG_CHECK_MP3") {
        let sample = PathBuf::from(sample);
        let library = Library::open(&root.join("real.sqlite"))?;
        let dest = root.join("真实样本");
        fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        fs::copy(sample, dest.join("中文 空格.mp3")).map_err(|e| e.to_string())?;
        library.add_directory(&dest)?;
        scanner::scan(&library, None, |_| {})?;
        let data = library.load()?;
        assert!(data.tracks[0].seconds > 0.0);
        assert!(data.tracks[0].metadata_error.is_empty());
        assert!(lyrics::load(&library, &data.tracks[0].id)?.text.is_empty());
        // 只向自查的临时副本写入 ID3，绝不修改传入的样本文件。
        use lofty::{
            config::WriteOptions,
            prelude::{ItemKey, TagExt},
            tag::{Tag, TagType},
        };
        let mut tag = Tag::new(TagType::Id3v2);
        tag.insert_text(ItemKey::UnsyncLyrics, "内嵌歌词正文".into());
        tag.save_to_path(dest.join("中文 空格.mp3"), WriteOptions::default())
            .map_err(|e| e.to_string())?;
        assert_eq!(
            lyrics::load(&library, &data.tracks[0].id)?.text,
            "内嵌歌词正文"
        );
        fs::write(dest.join("中文 空格.lrc"), "[00:00]优先外部歌词").map_err(|e| e.to_string())?;
        assert!(lyrics::load(&library, &data.tracks[0].id)?
            .text
            .contains("优先外部歌词"));
        println!("PASS: 真实 MP3 时长、内嵌歌词、缺失歌词与 LRC 优先级");
        // 仅在临时副本模拟缺失歌名及推广歌手标签，再验证刷新能修复未变化文件的旧索引。
        let numbered = dest.join("001.可爱女人 - 周杰伦.mp3");
        fs::copy(dest.join("中文 空格.mp3"), &numbered).map_err(|e| e.to_string())?;
        tag.insert_text(ItemKey::TrackArtist, "米羊羊音乐".into());
        tag.save_to_path(&numbered, WriteOptions::default())
            .map_err(|e| e.to_string())?;
        scanner::scan(&library, None, |_| {})?;
        let parsed = library
            .load()?
            .tracks
            .into_iter()
            .find(|t| t.filename.starts_with("001."))
            .unwrap();
        assert_eq!((&*parsed.title, &*parsed.artist), ("可爱女人", "周杰伦"));
        library.favorite(&parsed.id, true)?;
        let conn =
            rusqlite::Connection::open(root.join("real.sqlite")).map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE tracks SET title='周杰伦',artist='米羊羊音乐' WHERE id=?1",
            [&parsed.id],
        )
        .map_err(|e| e.to_string())?;
        scanner::scan(&library, None, |_| {})?;
        let refreshed = library
            .load()?
            .tracks
            .into_iter()
            .find(|t| t.id == parsed.id)
            .unwrap();
        assert_eq!(
            (&*refreshed.title, &*refreshed.artist),
            ("可爱女人", "周杰伦")
        );
        assert!(refreshed.favorite);
        println!("PASS: 真实 MP3 编号文件名纠正、未变化文件刷新修复及收藏 / 歌曲 ID 保留");
    }
    Ok(())
}

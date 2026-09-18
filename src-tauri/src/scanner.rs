use crate::{database::Library, models::*};
use lofty::{
    config::ParseOptions,
    file::{AudioFile, TaggedFileExt},
    prelude::Accessor,
    probe::Probe,
};
use std::{path::Path, sync::atomic::Ordering, time::UNIX_EPOCH};
use uuid::Uuid;
use walkdir::WalkDir;

/// 添加目录采用增量扫描，全库刷新重读标签；遍历错误时禁止清理未见歌曲。
pub fn scan(
    library: &Library,
    selected: Option<&str>,
    emit: impl Fn(ScanProgress),
) -> Result<ScanProgress, String> {
    if library.scanning.swap(true, Ordering::SeqCst) {
        return Err("已有扫描正在进行".into());
    }
    library.cancel.store(false, Ordering::SeqCst);
    let mut progress = ScanProgress::default();
    emit(progress.clone());
    let result = (|| {
        for (id, root) in library.roots()? {
            if selected.is_some_and(|s| s != id) {
                continue;
            }
            let scan_id = Uuid::new_v4().to_string();
            if std::fs::read_dir(&root).is_err() {
                report(&mut progress, "目录离线或无访问权限".into());
                library.finish_scan(&id, &scan_id, "offline", false)?;
                log::warn!("扫描目录不可访问 root={id}");
                continue;
            }
            library.finish_scan(&id, &scan_id, "scanning", false)?;
            log::info!("扫描开始 root={id} reread_metadata={}", selected.is_none());
            // 手动刷新必须重读旧索引，否则解析规则修复后未变化的文件永远不会更新。
            let known = if selected.is_none() {
                Default::default()
            } else {
                library.known_files(&id)?
            };
            let mut batch = Vec::with_capacity(100);
            let mut complete = true;
            for entry in WalkDir::new(&root).follow_links(false) {
                if library.cancel.load(Ordering::SeqCst) {
                    progress.cancelled = true;
                    complete = false;
                    break;
                }
                let entry = match entry {
                    Ok(e) => e,
                    Err(e) => {
                        complete = false;
                        report(&mut progress, "部分子目录无法读取".into());
                        log::warn!(
                            "目录遍历失败 root={id} reason={:?}",
                            e.io_error().map(|e| e.kind())
                        );
                        continue;
                    }
                };
                if !entry.file_type().is_file()
                    || !entry
                        .path()
                        .extension()
                        .is_some_and(|e| e.eq_ignore_ascii_case("mp3"))
                {
                    continue;
                }
                let file_path = match entry.path().canonicalize() {
                    Ok(p) if p.starts_with(&root) => p,
                    _ => {
                        complete = false;
                        report(&mut progress, "歌曲路径无法访问或超出目录".into());
                        continue;
                    }
                };
                let Some(path) = file_path.to_str() else {
                    complete = false;
                    report(&mut progress, "跳过无法编码的文件名".into());
                    continue;
                };
                let metadata = match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => {
                        complete = false;
                        report(&mut progress, "无法读取文件信息".into());
                        continue;
                    }
                };
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_nanos().to_string())
                    .unwrap_or_default();
                let size = metadata.len() as i64;
                let filename = entry.file_name().to_string_lossy().into_owned();
                let unchanged = known.get(path).is_some_and(|(old_size, old_modified)| {
                    *old_size == size && old_modified == &modified
                });
                let parsed = if unchanged {
                    None
                } else {
                    let meta = read_metadata(&file_path);
                    if !meta.error.is_empty() {
                        report(
                            &mut progress,
                            format!("{}：标签读取失败，仍可尝试播放", filename),
                        );
                    }
                    Some(meta)
                };
                batch.push(IndexedFile {
                    path: path.into(),
                    filename,
                    size,
                    modified,
                    metadata: parsed,
                });
                progress.processed += 1;
                if batch.len() == 100 {
                    library.index_batch(&id, &scan_id, &batch)?;
                    batch.clear();
                    emit(progress.clone());
                }
            }
            if !batch.is_empty() {
                library.index_batch(&id, &scan_id, &batch)?;
            }
            let status = if progress.cancelled {
                "cancelled"
            } else if complete {
                "ready"
            } else {
                "error"
            };
            progress.removed += library.finish_scan(&id, &scan_id, status, complete)?;
            log::info!(
                "扫描完成 root={id} processed={} failed={} complete={complete}",
                progress.processed,
                progress.failed
            );
            emit(progress.clone());
            if progress.cancelled {
                break;
            }
        }
        Ok(())
    })();
    library.scanning.store(false, Ordering::SeqCst);
    progress.finished = true;
    emit(progress.clone());
    result.map(|_| progress)
}
fn report(progress: &mut ScanProgress, message: String) {
    progress.failed += 1;
    if progress.errors.len() < 20 {
        progress.errors.push(message);
    }
}
/// 不读取封面图片，避免大图标签放大扫描的内存开销。
fn read_metadata(path: &Path) -> Metadata {
    let stem = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    let (title, artist) = resolve_track_names(&stem, None, None);
    let mut meta = Metadata {
        title,
        artist,
        album: "未知专辑".into(),
        seconds: 0.0,
        error: String::new(),
    };
    match Probe::open(path)
        .and_then(|p| p.options(ParseOptions::new().read_cover_art(false)).read())
    {
        Ok(file) => {
            meta.seconds = file.properties().duration().as_secs_f64();
            if let Some(tag) = file.primary_tag().or_else(|| file.first_tag()) {
                let title = tag.title();
                let artist = tag.artist();
                (meta.title, meta.artist) =
                    resolve_track_names(&stem, title.as_deref(), artist.as_deref());
                if let Some(album) = tag.album().filter(|s| !s.trim().is_empty()) {
                    meta.album = album.into_owned();
                }
            }
        }
        Err(e) => {
            meta.error = "MP3 标签解析失败".into();
            log::warn!("单曲标签解析失败 reason={e}");
        }
    }
    meta
}

/// 完整标签优先；缺少歌名时识别编号歌单的“序号.歌名 - 歌手”，避免发行方标签充当歌手。
pub(crate) fn resolve_track_names(
    stem: &str,
    tagged_title: Option<&str>,
    tagged_artist: Option<&str>,
) -> (String, String) {
    let title = tagged_title.map(str::trim).filter(|s| !s.is_empty());
    let artist = tagged_artist.map(str::trim).filter(|s| !s.is_empty());
    let stem = stem.trim();
    let digits = stem.bytes().take_while(u8::is_ascii_digit).count();
    // 只移除明确的曲目序号，不截断“2002年的第一场雪”等以数字开头的歌名。
    let numbered = (1..=3).contains(&digits)
        && (stem[digits..].starts_with(['.', '．', '、'])
            || (digits >= 2 && stem[digits..].starts_with(' ')));
    let name = if numbered {
        stem[digits..]
            .trim_start_matches(['.', '．', '、', ' '])
            .trim()
    } else {
        stem
    };
    let pair = name
        .split_once(" - ")
        .map(|(left, right)| (left.trim(), right.trim()))
        .filter(|(left, right)| !left.is_empty() && !right.is_empty());
    if let Some((left, right)) = pair {
        // 已有歌手与左侧吻合时仍按“歌手 - 歌名”；无编号文件维持原有约定。
        let title_first = artist == Some(right)
            || (artist != Some(left)
                && (title == Some(left) || (numbered && title != Some(right))));
        let (file_title, file_artist) = if title_first {
            (left, right)
        } else {
            (right, left)
        };
        if title.is_none() {
            return (
                file_title.into(),
                if numbered {
                    file_artist
                } else {
                    artist.unwrap_or(file_artist)
                }
                .into(),
            );
        }
        return (title.unwrap().into(), artist.unwrap_or(file_artist).into());
    }
    (
        title.unwrap_or(name).into(),
        artist.unwrap_or("未知歌手").into(),
    )
}

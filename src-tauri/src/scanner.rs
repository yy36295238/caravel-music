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

/// 后台增量扫描；单文件损坏可恢复，遍历错误则禁止批量缺失判定。
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
            log::info!("扫描开始 root={id}");
            let known = library.known_files(&id)?;
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
            library.finish_scan(&id, &scan_id, status, complete)?;
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
    let (artist, title) = stem
        .split_once(" - ")
        .map(|(a, t)| (a.to_string(), t.to_string()))
        .unwrap_or(("未知歌手".into(), stem));
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
                if let Some(title) = tag.title().filter(|s| !s.trim().is_empty()) {
                    meta.title = title.into_owned();
                }
                if let Some(artist) = tag.artist().filter(|s| !s.trim().is_empty()) {
                    meta.artist = artist.into_owned();
                }
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

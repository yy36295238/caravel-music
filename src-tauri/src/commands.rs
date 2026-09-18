use crate::{database::Library, models::*, scanner};
use std::sync::{atomic::Ordering, Arc};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

/// 所有数据库和扫描命令离开 UI 线程执行，统一保留失败原因。
async fn run<T: Send + 'static>(
    app: AppHandle,
    label: &'static str,
    work: impl FnOnce(Arc<Library>) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let db = app.state::<Arc<Library>>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || work(db))
        .await
        .map_err(|e| e.to_string())?
        .inspect_err(|e| log::error!("本地操作失败 action={label} reason={e}"))
}
#[tauri::command]
pub async fn load_library(app: AppHandle) -> Result<LibraryData, String> {
    run(app, "load", |db| db.load()).await
}
#[tauri::command]
pub async fn add_directory(app: AppHandle) -> Result<Option<ScanProgress>, String> {
    let handle = app.clone();
    run(app, "add_directory", move |db| {
        if db.scanning.load(Ordering::SeqCst) {
            return Err("请先等待当前扫描完成".into());
        }
        let Some(selected) = handle
            .dialog()
            .file()
            .set_title("选择音乐文件夹（包含子目录）")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = selected
            .into_path()
            .map_err(|_| "无法读取所选目录".to_string())?;
        let id = db.add_directory(&path)?;
        scanner::scan(&db, Some(&id), |progress| {
            let _ = handle.emit("scan-progress", progress);
        })
        .map(Some)
    })
    .await
}
#[tauri::command]
pub async fn refresh_library(app: AppHandle) -> Result<ScanProgress, String> {
    let handle = app.clone();
    run(app, "refresh", move |db| {
        scanner::scan(&db, None, |progress| {
            let _ = handle.emit("scan-progress", progress);
        })
    })
    .await
}
#[tauri::command]
pub fn cancel_scan(app: AppHandle) {
    app.state::<Arc<Library>>()
        .cancel
        .store(true, Ordering::SeqCst);
}
#[tauri::command]
pub async fn remove_directory(app: AppHandle, id: String) -> Result<(), String> {
    run(app, "remove_directory", move |db| db.remove_directory(&id)).await
}
#[tauri::command]
pub async fn set_favorite(app: AppHandle, id: String, value: bool) -> Result<(), String> {
    run(app, "favorite", move |db| db.favorite(&id, value)).await
}
#[tauri::command]
pub async fn edit_category(
    app: AppHandle,
    kind: String,
    operation: String,
    name: String,
    next: Option<String>,
) -> Result<(), String> {
    run(app, "category", move |db| {
        db.category(&kind, &operation, &name, next.as_deref())
    })
    .await
}
#[tauri::command]
pub async fn assign_categories(app: AppHandle, assignment: Assignment) -> Result<(), String> {
    run(app, "assign", move |db| db.assign(assignment)).await
}
#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: PlaybackSettings) -> Result<(), String> {
    run(app, "save_settings", move |db| db.save_settings(settings)).await
}
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// 按歌曲 ID 按需读取歌词，界面不能传入任意文件路径。
#[tauri::command]
pub async fn load_lyrics(app: AppHandle, id: String) -> Result<crate::lyrics::Lyrics, String> {
    run(app, "load_lyrics", move |db| crate::lyrics::load(&db, &id)).await
}

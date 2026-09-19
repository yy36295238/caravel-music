#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod commands;
mod database;
mod lyrics;
mod media;
mod models;
mod scanner;
mod self_check;
mod tray;
#[cfg(target_os = "macos")]
mod tray_panel;

use std::sync::Arc;
use tauri::{Emitter, Manager};

fn main() {
    // 可运行的集成自查使用临时目录，不接触用户的应用数据库。
    if std::env::args().nth(1).as_deref() == Some("--self-check") {
        self_check::run().expect("本地音乐集成自查失败");
        return;
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(2_000_000)
                .build(),
        )
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("library.sqlite");
            let library = database::Library::open(&path).map_err(std::io::Error::other)?;
            // 启动只检查目录可访问性，不全量扫描音乐文件。
            for (id, root) in library.roots().map_err(std::io::Error::other)? {
                let status = if std::fs::read_dir(root).is_ok() {
                    "ready"
                } else {
                    "offline"
                };
                library
                    .finish_scan(&id, "", status, false)
                    .map_err(std::io::Error::other)?;
            }
            app.manage(Arc::new(library));
            tray::init(app)?;
            log::info!("留声启动 version={}", env!("CARGO_PKG_VERSION"));
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("music", |ctx, request, responder| {
            let library = ctx
                .app_handle()
                .state::<Arc<database::Library>>()
                .inner()
                .clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(media::respond(&library, request))
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_library,
            commands::load_lyrics,
            commands::add_directory,
            commands::open_directory,
            commands::refresh_library,
            commands::cancel_scan,
            commands::remove_directory,
            commands::set_favorite,
            commands::edit_category,
            commands::assign_categories,
            commands::save_settings,
            commands::quit_app,
            tray::update_menu_player,
            tray::menu_player_snapshot,
            tray::menu_player_action
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                if window.label() != "main" {
                    let _ = window.hide();
                    return;
                }
                #[cfg(target_os = "macos")]
                {
                    let _ = window.emit("save-playback", ());
                    let _ = window.hide();
                }
                #[cfg(not(target_os = "macos"))]
                request_quit(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("无法启动留声");
    app.run(|app, event| match event {
        tauri::RunEvent::ExitRequested {
            api, code: None, ..
        } => {
            api.prevent_exit();
            request_quit(app);
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        _ => {}
    });
}
/// 给前端一次保存进度的机会；页面异常时仍能正常退出应用。
fn request_quit(app: &tauri::AppHandle) {
    let _ = app.emit("before-quit", ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        handle.exit(0);
    });
}

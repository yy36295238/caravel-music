use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// 菜单栏只接收播放摘要，不持有歌曲路径或独立播放队列。
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    title: String,
    artist: String,
    skin: String,
    /// 与主播放器共享模式，兼容未携带此字段的旧页面快照。
    #[serde(default)]
    mode: String,
    playing: bool,
    animate: bool,
    can_play: bool,
    can_previous: bool,
    can_next: bool,
}

#[derive(Default)]
pub struct MenuPlayer {
    snapshot: Mutex<Snapshot>,
    /// 序号使已排队的动画帧和延迟收起在状态变化后失效。
    #[cfg(target_os = "macos")]
    animation: std::sync::atomic::AtomicU64,
    #[cfg(target_os = "macos")]
    hover: std::sync::atomic::AtomicU64,
    #[cfg(target_os = "macos")]
    pinned: std::sync::atomic::AtomicBool,
    /// 连续离开可操作区域后才收起，跨越图标和卡片间隙不计作离开。
    #[cfg(target_os = "macos")]
    outside_since: Mutex<Option<std::time::Instant>>,
}

/// Windows 沿用现有播放器，仅 macOS 创建菜单栏窗口。
pub fn init(app: &tauri::App) -> tauri::Result<()> {
    app.manage(MenuPlayer::default());
    #[cfg(target_os = "macos")]
    native::init(app)?;
    Ok(())
}

/// 仅主播放器能发布真实状态；长度校验防止损坏标签撑大跨窗口消息。
#[tauri::command]
pub fn update_menu_player(window: tauri::WebviewWindow, snapshot: Snapshot) -> Result<(), String> {
    if window.label() != "main" || snapshot.title.len() > 4096 || snapshot.artist.len() > 4096 {
        return Err("无效的播放状态".into());
    }
    let app = window.app_handle();
    let state = app.state::<MenuPlayer>();
    #[cfg(target_os = "macos")]
    let animate = snapshot.animate && snapshot.playing;
    #[cfg(target_os = "macos")]
    let changed;
    {
        let mut current = state.snapshot.lock().map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        {
            changed = current.animate != animate;
        }
        *current = snapshot.clone();
    }
    #[cfg(target_os = "macos")]
    if changed {
        native::animate(app, animate);
    }
    app.emit_to("mini-player", "menu-state", snapshot)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn menu_player_snapshot(state: tauri::State<MenuPlayer>) -> Result<Snapshot, String> {
    state
        .snapshot
        .lock()
        .map(|s| s.clone())
        .map_err(|e| e.to_string())
}

/// 浮层仅转发白名单操作，播放仍由主窗口的 Audio 执行。
#[tauri::command]
pub fn menu_player_action(window: tauri::WebviewWindow, action: &str) -> Result<(), String> {
    if window.label() != "mini-player" {
        return Err("无效的控制来源".into());
    }
    let app = window.app_handle();
    let result = match action {
        "toggle-play" | "previous" | "next" | "mode" => app.emit_to("main", "menu-control", action),
        "hide" | "open" => {
            #[cfg(target_os = "macos")]
            native::hide(app).map_err(|e| e.to_string())?;
            if action == "open" {
                if let Some(main) = app.get_webview_window("main") {
                    main.show()
                        .and_then(|_| main.set_focus())
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        }
        _ => return Err("不支持的菜单栏操作".into()),
    };
    if let Err(error) = &result {
        log::warn!("菜单栏操作失败 action={action}: {error}");
    } else {
        log::info!("菜单栏操作 action={action}");
    }
    result.map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSEvent, NSScreen, NSStatusBar, NSWindow};
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use std::sync::atomic::Ordering::SeqCst;
    use std::time::{Duration, Instant};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    // 包含四周 8pt 透明阴影区，实际卡片为 248 × 136pt。
    const WIDTH: f64 = 264.0;
    const HEIGHT: f64 = 152.0;

    pub fn init(app: &tauri::App) -> tauri::Result<()> {
        let popup = tauri::WebviewWindowBuilder::new(
            app,
            "mini-player",
            tauri::WebviewUrl::App("mini.html".into()),
        )
        .title("留声 · 菜单栏播放器")
        .inner_size(WIDTH, HEIGHT)
        .transparent(true)
        .decorations(false)
        .resizable(false)
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .shadow(false)
        .build()?;
        // 初始化在主线程执行，原生指针由当前存活的 Tauri 窗口持有。
        let native = unsafe { &*popup.ns_window()?.cast::<NSWindow>() };
        crate::tray_panel::attach(native, MainThreadMarker::new().expect("主线程初始化"))?;
        TrayIconBuilder::with_id("liusheng-player")
            .icon(frame(0))
            .icon_as_template(true)
            .tooltip("留声 · 播放控制")
            .show_menu_on_left_click(false)
            .on_tray_icon_event(|tray, event| {
                let app = tray.app_handle();
                let result = match event {
                    TrayIconEvent::Enter { rect, .. } => show(app, rect, false),
                    TrayIconEvent::Click {
                        rect,
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => {
                        if app.state::<MenuPlayer>().pinned.load(SeqCst) {
                            hide(app)
                        } else {
                            show(app, rect, true)
                        }
                    }
                    _ => Ok(()),
                };
                if let Err(error) = result {
                    log::warn!("菜单栏浮层操作失败: {error}");
                }
            })
            .build(app)?;
        // 与鼠标共用同一浮层，为键盘用户提供应用内入口（非全局热键）。
        if let Some(menu) = app.menu() {
            if let Some(submenu) = menu.items()?.first().and_then(|item| item.as_submenu()) {
                submenu.insert(
                    &tauri::menu::MenuItem::with_id(
                        app,
                        "menu-player",
                        "菜单栏播放器",
                        true,
                        Some("CmdOrCtrl+Shift+M"),
                    )?,
                    2,
                )?;
            }
        }
        app.on_menu_event(|app, event| {
            if event.id().as_ref() != "menu-player" {
                return;
            }
            let result = (|| {
                if let Some(tray) = app.tray_by_id("liusheng-player") {
                    if let Some(rect) = tray.rect()? {
                        show(app, rect, true)?;
                    }
                }
                Ok::<_, tauri::Error>(())
            })();
            if let Err(error) = result {
                log::warn!("打开菜单栏播放器失败: {error}");
            }
        });
        log::info!("macOS 菜单栏播放器已就绪");
        Ok(())
    }

    /// 鼠标、屏幕和窗口全程使用 AppKit 的点坐标（左下原点），避免跨屏 DPI 混算。
    fn show(app: &tauri::AppHandle, rect: tauri::Rect, pin: bool) -> tauri::Result<()> {
        let mtm = MainThreadMarker::new()
            .ok_or_else(|| std::io::Error::other("菜单栏定位须在主线程执行"))?;
        let mouse = NSEvent::mouseLocation();
        let menu_height = NSStatusBar::systemStatusBar().thickness();
        let screens = NSScreen::screens(mtm);
        let target = screens.iter().find_map(|screen| {
            // 事件图标矩形按所在屏幕缩放还原为点；鼠标只负责选屏，不决定横向位置。
            let scale = screen.backingScaleFactor();
            let center = rect.position.to_logical::<f64>(scale).x
                + rect.size.to_logical::<f64>(scale).width / 2.0;
            popup_origin(
                mouse,
                center,
                screen.frame(),
                screen.visibleFrame(),
                menu_height,
            )
            .map(|origin| (screen, origin))
        });
        let Some((screen, origin)) = target else {
            log::warn!("菜单栏定位失败：鼠标未落在可用屏幕内");
            return Ok(());
        };
        let native = crate::tray_panel::get(mtm)?;
        // 图标动画可能重复产生 Enter；同屏已展开时不能跟着这些事件重新定位。
        let same_screen = native
            .screen()
            .is_some_and(|current| current.frame() == screen.frame());
        let opened = !native.isVisible() || !same_screen;
        if opened {
            // 直接使用 AppKit 点坐标，绕过 Tauri 按移动前缩放比例换算的问题。
            native.setFrameTopLeftPoint(origin);
        }
        if pin {
            app.state::<MenuPlayer>().pinned.store(true, SeqCst);
        }
        // Tauri show/set_focus 会激活普通窗口；面板只排序到前方，不切换应用或空间。
        native.orderFrontRegardless();
        if pin {
            native.makeKeyWindow();
        }
        if opened {
            let scale = screen.backingScaleFactor();
            let icon_width = rect.size.to_logical::<f64>(scale).width;
            let center = rect.position.to_logical::<f64>(scale).x + icon_width / 2.0;
            let frame = screen.frame();
            // 过渡区域只覆盖图标宽度，邻近菜单栏图标不会让浮层一直停留。
            let bridge = NSRect::new(
                NSPoint::new(center - icon_width / 2.0, origin.y),
                NSSize::new(
                    icon_width,
                    (frame.origin.y + frame.size.height - origin.y).max(0.0),
                ),
            );
            watch_hover(app, bridge);
        }
        if opened {
            log::info!(
                "菜单栏面板展开 x={:.0} y={:.0} pinned={pin}",
                origin.x,
                origin.y
            );
        }
        Ok(())
    }

    /// 仅匹配鼠标所在屏幕，并为菜单栏、Dock 与卡片阴影预留空间。
    pub(super) fn popup_origin(
        mouse: NSPoint,
        icon_center_x: f64,
        frame: NSRect,
        visible: NSRect,
        menu_height: f64,
    ) -> Option<NSPoint> {
        if mouse.x < frame.origin.x
            || mouse.x >= frame.origin.x + frame.size.width
            || mouse.y < frame.origin.y
            || mouse.y >= frame.origin.y + frame.size.height
        {
            return None;
        }
        let left = visible.origin.x;
        let right = (left + visible.size.width - WIDTH).max(left);
        let top = (visible.origin.y + visible.size.height)
            .min(frame.origin.y + frame.size.height - menu_height);
        Some(NSPoint::new(
            (icon_center_x - WIDTH / 2.0).clamp(left, right),
            top,
        ))
    }

    pub fn hide(app: &tauri::AppHandle) -> tauri::Result<()> {
        let state = app.state::<MenuPlayer>();
        state.pinned.store(false, SeqCst);
        state.hover.fetch_add(1, SeqCst);
        // IPC 可能来自工作线程，AppKit 排序操作必须回到主线程。
        if let Some(mtm) = MainThreadMarker::new() {
            crate::tray_panel::get(mtm)?.orderOut(None);
        } else {
            app.run_on_main_thread(|| {
                match crate::tray_panel::get(MainThreadMarker::new().expect("主线程隐藏")) {
                    Ok(panel) => panel.orderOut(None),
                    Err(error) => log::warn!("菜单栏面板隐藏失败: {error}"),
                }
            })?;
        }
        Ok(())
    }

    /// 只在浮层可见期间检查真实鼠标位置，不依赖未激活 WebView 的 enter/leave 事件。
    fn watch_hover(app: &tauri::AppHandle, bridge: NSRect) {
        let ticket = app.state::<MenuPlayer>().hover.fetch_add(1, SeqCst) + 1;
        *app.state::<MenuPlayer>().outside_since.lock().unwrap() = None;
        let handle = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(100));
            if handle.state::<MenuPlayer>().hover.load(SeqCst) != ticket {
                break;
            }
            let app = handle.clone();
            let result = handle.run_on_main_thread(move || {
                let state = app.state::<MenuPlayer>();
                if state.hover.load(SeqCst) != ticket {
                    return;
                }
                if let Err(error) = check_hover(&app, bridge) {
                    state.hover.fetch_add(1, SeqCst);
                    log::warn!("菜单栏悬浮检查失败: {error}");
                }
            });
            if let Err(error) = result {
                log::warn!("菜单栏悬浮任务失败: {error}");
                break;
            }
        });
    }

    /// 所有自动收起走同一个判断；显式关闭和 Esc 仍立即生效。
    fn check_hover(app: &tauri::AppHandle, bridge: NSRect) -> tauri::Result<()> {
        let state = app.state::<MenuPlayer>();
        let mtm = MainThreadMarker::new()
            .ok_or_else(|| std::io::Error::other("菜单栏悬浮检查须在主线程执行"))?;
        let native = crate::tray_panel::get(mtm)?;
        if !native.isVisible() {
            state.hover.fetch_add(1, SeqCst);
            return Ok(());
        }
        // 点击其他窗口后解除固定；鼠标仍在卡片内时继续按悬浮规则显示。
        if state.pinned.load(SeqCst) && !native.isKeyWindow() {
            state.pinned.store(false, SeqCst);
        }
        let mut outside = state.outside_since.lock().unwrap();
        if keep_open(
            NSEvent::mouseLocation(),
            native.frame(),
            bridge,
            state.pinned.load(SeqCst),
        ) {
            *outside = None;
        } else if outside.get_or_insert_with(Instant::now).elapsed() >= Duration::from_millis(450) {
            drop(outside);
            hide(app)?;
        }
        Ok(())
    }

    /// 鼠标在卡片（含透明边缘）或图标过渡区时必须可操作，固定展开也保持显示。
    pub(super) fn keep_open(mouse: NSPoint, popup: NSRect, bridge: NSRect, pinned: bool) -> bool {
        let contains = |rect: NSRect| {
            mouse.x >= rect.origin.x
                && mouse.x <= rect.origin.x + rect.size.width
                && mouse.y >= rect.origin.y
                && mouse.y <= rect.origin.y + rect.size.height
        };
        pinned || contains(popup) || contains(bridge)
    }

    /// 播放状态驱动的轻微律动，不采集或分析音频；暂停后工作线程立即结束。
    pub fn animate(app: &tauri::AppHandle, playing: bool) {
        let ticket = app.state::<MenuPlayer>().animation.fetch_add(1, SeqCst) + 1;
        let handle = app.clone();
        std::thread::spawn(move || {
            let mut index = 0;
            loop {
                let app = handle.clone();
                let result = handle.run_on_main_thread(move || {
                    if app.state::<MenuPlayer>().animation.load(SeqCst) != ticket {
                        return;
                    }
                    if let Some(tray) = app.tray_by_id("liusheng-player") {
                        if let Err(error) = tray.set_icon_with_as_template(Some(frame(index)), true)
                        {
                            log::warn!("菜单栏图标更新失败: {error}");
                        }
                    }
                });
                if let Err(error) = result {
                    log::warn!("菜单栏律动任务失败: {error}");
                    break;
                }
                if !playing {
                    break;
                }
                std::thread::sleep(Duration::from_millis(200));
                if handle.state::<MenuPlayer>().animation.load(SeqCst) != ticket {
                    break;
                }
                index = index % 4 + 1;
            }
        });
    }

    /// 36 像素模板图标由系统适配菜单栏深浅色；圆头柱形保留小尺寸清晰度。
    pub(super) fn frame(index: usize) -> tauri::image::Image<'static> {
        let heights = [
            [10, 24, 18, 12],
            [16, 22, 12, 18],
            [24, 14, 20, 10],
            [18, 10, 24, 16],
            [12, 18, 14, 24],
        ][index % 5];
        let mut rgba = vec![0; 36 * 36 * 4];
        for (bar, height) in heights.iter().enumerate() {
            let start = (36 - height) / 2;
            for y in start..start + height {
                for x in 5 + bar * 7..9 + bar * 7 {
                    // 端点各裁一像素，避免细柱在 Retina 菜单栏呈生硬方角。
                    if (y == start || y == start + height - 1)
                        && (x == 5 + bar * 7 || x == 8 + bar * 7)
                    {
                        continue;
                    }
                    rgba[(y * 36 + x) * 4 + 3] = 255;
                }
            }
        }
        tauri::image::Image::new_owned(rgba, 36, 36)
    }
}

/// 复用现有 --self-check，确认图标有内容、循环稳定且各帧不同。
#[cfg(target_os = "macos")]
pub fn self_check() {
    let first = native::frame(0);
    assert_eq!(first.rgba().len(), 36 * 36 * 4);
    assert!(first.rgba().chunks_exact(4).any(|pixel| pixel[3] == 255));
    assert_ne!(first.rgba(), native::frame(1).rgba());
    assert_eq!(first.rgba(), native::frame(5).rgba());
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    let screen = |x, y, w, h| NSRect::new(NSPoint::new(x, y), NSSize::new(w, h));
    // 实际创建 AppKit 面板，防止退回普通窗口或丢失非激活属性后仍通过几何自查。
    use objc2_app_kit::{
        NSApplication, NSStatusWindowLevel, NSWindowCollectionBehavior, NSWindowStyleMask,
    };
    let mtm = objc2::MainThreadMarker::new().expect("原生面板自查须在主线程运行");
    let _app = NSApplication::sharedApplication(mtm);
    let panel = crate::tray_panel::create(screen(0.0, 0.0, 264.0, 152.0), mtm);
    assert!(panel
        .styleMask()
        .contains(NSWindowStyleMask::NonactivatingPanel));
    assert!(panel.collectionBehavior().contains(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
    ));
    assert_eq!(panel.level(), NSStatusWindowLevel);
    assert!(!panel.hidesOnDeactivate());
    assert!(panel.canBecomeKeyWindow());
    assert!(!panel.canBecomeMainWindow());
    println!("PASS: 原生非激活面板、跨空间属性、层级与键盘焦点资格");
    let main = screen(0.0, 0.0, 1440.0, 900.0);
    // 1× 扩展屏在 2× 主屏右侧；坐标不随任一屏幕缩放比例变化。
    let external = screen(1440.0, 0.0, 1920.0, 1080.0);
    let visible = screen(1440.0, 0.0, 1920.0, 1056.0);
    let mouse = NSPoint::new(2400.0, 1068.0);
    assert!(native::popup_origin(mouse, 2400.0, main, main, 24.0).is_none());
    assert_eq!(
        native::popup_origin(mouse, 2400.0, external, visible, 24.0),
        Some(NSPoint::new(2268.0, 1056.0))
    );
    let left = screen(-1920.0, -180.0, 1920.0, 1080.0);
    assert_eq!(
        native::popup_origin(NSPoint::new(-1918.0, 888.0), -1918.0, left, left, 24.0),
        Some(NSPoint::new(-1920.0, 876.0))
    );
    let above = screen(0.0, 900.0, 1920.0, 1080.0);
    assert_eq!(
        native::popup_origin(NSPoint::new(1918.0, 1968.0), 1918.0, above, above, 24.0),
        Some(NSPoint::new(1656.0, 1956.0))
    );
    assert_eq!(
        native::popup_origin(
            NSPoint::new(2392.0, 1068.0),
            2400.0,
            external,
            visible,
            24.0
        ),
        native::popup_origin(
            NSPoint::new(2408.0, 1064.0),
            2400.0,
            external,
            visible,
            24.0
        )
    );
    let popup = screen(-500.0, 600.0, 264.0, 152.0);
    let bridge = screen(-382.0, 752.0, 28.0, 24.0);
    assert!(native::keep_open(
        NSPoint::new(-370.0, 670.0),
        popup,
        bridge,
        false
    ));
    assert!(native::keep_open(
        NSPoint::new(-500.0, 600.0),
        popup,
        bridge,
        false
    ));
    assert!(native::keep_open(
        NSPoint::new(-370.0, 760.0),
        popup,
        bridge,
        false
    ));
    assert!(!native::keep_open(
        NSPoint::new(-300.0, 770.0),
        popup,
        bridge,
        false
    ));
    assert!(!native::keep_open(
        NSPoint::new(300.0, 700.0),
        popup,
        bridge,
        false
    ));
    assert!(native::keep_open(
        NSPoint::new(300.0, 700.0),
        popup,
        bridge,
        true
    ));
    println!("PASS: 浮层内、边缘及图标间隙保持显示，离开区域与固定展开判断");
    println!("PASS: 图标中心锚定与鼠标移动位置不变");
    println!("PASS: 扩展屏隔离、负坐标屏幕、上下排列及屏幕边缘约束");
    println!("PASS: 菜单栏模板图标尺寸、可见性及动画帧循环");
}

//! 原生非激活面板承载菜单栏 WebView，避免打开浮层时切离其他应用的全屏空间。
use objc2::rc::Retained;
use objc2::{define_class, msg_send, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSBackingStoreType, NSColor, NSPanel, NSStatusWindowLevel, NSWindow,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
use objc2_foundation::NSRect;
use std::cell::OnceCell;

define_class!(
    // 只覆盖键盘焦点资格，不替换 Tauri 窗口的 Objective-C 类或代理。
    #[unsafe(super = NSPanel)]
    #[name = "LiushengMenuPanel"]
    #[thread_kind = MainThreadOnly]
    pub struct MenuPanel;

    impl MenuPanel {
        #[unsafe(method(canBecomeKeyWindow))]
        fn can_become_key_window(&self) -> bool { true }

        #[unsafe(method(canBecomeMainWindow))]
        fn can_become_main_window(&self) -> bool { false }
    }
);

thread_local! {
    // AppKit 对象只在主线程持有；Tauri 继续管理原 WebView 的 IPC 与生命周期。
    static PANEL: OnceCell<Retained<MenuPanel>> = const { OnceCell::new() };
}

/// 从创建时就指定 NonactivatingPanel，后改 styleMask 不会正确设置系统焦点标签。
pub fn create(frame: NSRect, mtm: MainThreadMarker) -> Retained<MenuPanel> {
    // 初始化签名与 NSPanel 一致；关闭时不自动释放，由 Retained 管理所有权。
    let panel: Retained<MenuPanel> = unsafe {
        msg_send![MenuPanel::alloc(mtm),
            initWithContentRect: frame,
            styleMask: NSWindowStyleMask::Borderless | NSWindowStyleMask::NonactivatingPanel,
            backing: NSBackingStoreType::Buffered,
            defer: false]
    };
    unsafe { panel.setReleasedWhenClosed(false) };
    panel.setFloatingPanel(true);
    panel.setHidesOnDeactivate(false);
    panel.setLevel(NSStatusWindowLevel);
    panel.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Transient
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    panel.setOpaque(false);
    panel.setBackgroundColor(Some(&NSColor::clearColor()));
    panel.setHasShadow(false);
    panel
}

/// 迁移整个内容视图，保留原 WebView、尺寸与消息通道；原 Tauri 窗口保持隐藏。
pub fn attach(source: &NSWindow, mtm: MainThreadMarker) -> tauri::Result<()> {
    let content = source
        .contentView()
        .ok_or_else(|| std::io::Error::other("菜单栏窗口缺少内容视图"))?;
    let panel = create(source.frame(), mtm);
    panel.setTitle(&source.title());
    source.setContentView(None);
    panel.setContentView(Some(&content));
    PANEL.with(|slot| {
        slot.set(panel)
            .map_err(|_| std::io::Error::other("菜单栏面板重复初始化"))
    })?;
    Ok(())
}

pub fn get(_mtm: MainThreadMarker) -> tauri::Result<Retained<MenuPanel>> {
    PANEL.with(|slot| {
        slot.get()
            .cloned()
            .ok_or_else(|| std::io::Error::other("菜单栏面板尚未初始化").into())
    })
}

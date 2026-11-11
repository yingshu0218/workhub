//! Tauri 桌面壳入口。
//!
//! ## 窗口生命周期约定（三端不同，刻意分开处理）
//!
//! - **桌面（macOS / Windows）**：点窗口关闭按钮 **不退出应用**，而是把窗口收进
//!   托盘 —— macOS 落在菜单栏，Windows 落在系统托盘。原因：这是个常驻工作台
//!   （同步引擎 30s 心跳、Agent 桥要在线），一关窗口就杀掉进程会让「后台同步」
//!   彻底失效。真正退出走托盘菜单的「退出寻鸽工作台」或 macOS 的 ⌘Q。
//! - **移动端（Android / iOS）**：**不接管窗口事件**。移动端的窗口生命周期由系统
//!   管（返回键、后台回收、电池优化白名单），硬留一个「隐藏窗口」既没意义也不符合
//!   平台习惯。所以下面所有托盘/关闭拦截的代码都带 `#[cfg(desktop)]`。

use tauri::Manager;

use tauri::WindowEvent;

/// 把主窗口唤起（显示 + 取消最小化 + 抢焦点）。
#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 安装托盘图标与菜单（macOS 菜单栏 / Windows 系统托盘）。
#[cfg(desktop)]
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::image::Image;
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    // 菜单栏图标必须是**单色 template 图**：直接把彩色应用图标塞进菜单栏，会得到一块
    // 有色方块，与系统及其它应用图标风格不一致。字形由 scripts/gen-tray-icon.py
    // 从 public/favicon.svg 生成（透明底 + 纯黑，超采样 4× 后再降采样）。
    let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?;

    let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出寻鸽工作台", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id("main-tray")
        .icon(tray_icon)
        // macOS：把着色交回系统（深色菜单栏 → 白，浅色 → 黑）。
        // 不设这一项，纯黑字形在深色菜单栏上会直接看不见。Windows 忽略此参数。
        .icon_as_template(true)
        .tooltip("寻鸽工作台 · Nexus Workspace")
        .menu(&menu)
        // 关掉「左键弹菜单」：菜单栏（macOS）与系统托盘（Windows）上更通用的直觉是
        // 「左键唤起窗口、右键出菜单」，两端统一成这一套，避免同一个软件在两端手感不同。
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 桌面端才有托盘；移动端交给系统
            #[cfg(desktop)]
            setup_tray(app.handle())?;

            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(mobile)]
            if let WindowEvent::Resumed = event {
                if let Some(webview) = window.get_webview_window(window.label()) {
                    let _ = webview.eval("window.dispatchEvent(new Event('workhub:resume'))");
                }
            }
            // 桌面端：点关闭 = 收进托盘，而不是退出应用（见文件头注释）
            #[cfg(desktop)]
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }

            #[cfg(not(desktop))]
            let _ = (window, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS：窗口隐藏后点 Dock 图标要能唤回窗口，
            // 否则「收进菜单栏」的应用会变成一个点不回来的壳。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app);
            }

            #[cfg(not(target_os = "macos"))]
            {
                let _ = app;
                let _ = event;
            }
        });
}

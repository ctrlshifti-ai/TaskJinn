// The tray (menu bar) icon.
//
// - macOS and Windows: clicking the icon toggles the popup window (../app/popup.html).
//   Right-clicking shows a small menu. On macOS the icon also shows the running timer.
// - Linux: most desktops can only show a menu from a tray icon, so the menu lists the tasks
//   in progress with Pause / Resume / Stop items (sent by JavaScript, see set_tray_state).

use serde::Deserialize;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Rect, Wry};

const TRAY_ID: &str = "main";

/// A menu item sent from JavaScript. Clicking it sends `id` back as a "tray-action" event.
#[derive(Deserialize, Clone, PartialEq, Default)]
pub struct TrayItem {
    id: String,
    label: String,
    #[serde(default)]
    enabled: bool,
}

/// What the tray shows, as last sent by JavaScript.
#[derive(Default)]
pub struct TrayState(Mutex<TrayInfo>);

#[derive(Default)]
struct TrayInfo {
    /// When the newest running session started (milliseconds since 1970), if any task runs.
    session_started_ms: Option<i64>,
    running_count: usize,
    items: Vec<TrayItem>,
    title: Option<String>,
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let icon = if cfg!(target_os = "macos") {
        // Black shape that macOS recolours for light and dark menu bars.
        tauri::image::Image::from_bytes(include_bytes!("../icons/tray-template.png"))?
    } else {
        tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?
    };

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("TaskJinn")
        .menu(&build_menu(app, &[])?)
        .show_menu_on_left_click(cfg!(target_os = "linux"))
        .on_menu_event(|app, event| handle_menu_click(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                toggle_popup(tray.app_handle(), rect);
            }
        })
        .build(app)?;

    start_title_clock(app.clone());
    Ok(())
}

fn build_menu(app: &AppHandle, items: &[TrayItem]) -> tauri::Result<Menu<Wry>> {
    let menu = Menu::new(app)?;
    for item in items {
        menu.append(&MenuItem::with_id(app, &item.id, &item.label, item.enabled, None::<&str>)?)?;
    }
    if !items.is_empty() {
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }
    menu.append(&MenuItem::with_id(app, "open", "Open TaskJinn", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, "new-task", "New Task…", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)?;
    Ok(menu)
}

fn handle_menu_click(app: &AppHandle, id: &str) {
    match id {
        "open" => show_main_window(app),
        "new-task" => {
            show_main_window(app);
            let _ = app.emit("new-task", ());
        }
        "quit" => app.exit(0),
        // Task items, e.g. "pause:<org id>:<task id>". JavaScript handles these.
        other => {
            let _ = app.emit("tray-action", other.to_string());
        }
    }
}

/// Shows the popup just below the tray icon (or above it when the taskbar is at the bottom).
fn toggle_popup(app: &AppHandle, icon: Rect) {
    let Some(popup) = crate::window(app, "popup") else { return };
    if popup.is_visible().unwrap_or(false) {
        let _ = popup.hide();
        return;
    }
    let scale = popup.scale_factor().unwrap_or(1.0);
    let icon_position = icon.position.to_physical::<f64>(scale);
    let icon_size = icon.size.to_physical::<f64>(scale);
    let size = popup.outer_size().unwrap_or_default();

    let x = icon_position.x + icon_size.width / 2.0 - size.width as f64 / 2.0;
    let near_top_of_screen = icon_position.y < 200.0;
    let y = if near_top_of_screen {
        icon_position.y + icon_size.height + 4.0
    } else {
        icon_position.y - size.height as f64 - 4.0
    };

    let _ = popup.set_position(PhysicalPosition::new(x.max(0.0), y.max(0.0)));
    let _ = popup.show();
    let _ = popup.set_focus();
    let _ = app.emit_to("popup", "popup-shown", ());
}

/// Updates the menu bar timer once a second (macOS shows text next to the icon).
fn start_title_clock(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let state = app.state::<TrayState>();
        let mut info = state.0.lock().unwrap();

        let title = info.session_started_ms.map(|started| {
            let seconds = ((now_ms() - started) / 1000).max(0);
            let others = if info.running_count > 1 { format!(" +{}", info.running_count - 1) } else { String::new() };
            format!("{}:{:02}:{:02}{}", seconds / 3600, (seconds % 3600) / 60, seconds % 60, others)
        });

        if title != info.title {
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                let _ = tray.set_title(title.as_deref());
            }
            info.title = title;
        }
    });
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Called by JavaScript whenever tasks start, pause or stop.
#[tauri::command]
pub fn set_tray_state(
    app: AppHandle,
    state: tauri::State<'_, TrayState>,
    session_started_ms: Option<i64>,
    running_count: usize,
    items: Vec<TrayItem>,
) -> Result<(), String> {
    let mut info = state.0.lock().unwrap();
    info.session_started_ms = session_started_ms;
    info.running_count = running_count;

    // Only rebuild the menu when its items change, so an open menu isn't disturbed.
    if info.items != items {
        let menu = build_menu(&app, &items).map_err(|e| e.to_string())?;
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
        }
        info.items = items;
    }
    Ok(())
}

/// The popup page reports its height so the window fits its content.
#[tauri::command]
pub fn resize_popup(app: AppHandle, height: f64) {
    if let Some(popup) = crate::window(&app, "popup") {
        let _ = popup.set_size(LogicalSize::new(340.0, height.clamp(120.0, 700.0)));
    }
}

#[tauri::command]
pub fn show_main(app: AppHandle) {
    show_main_window(&app);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(popup) = crate::window(app, "popup") {
        let _ = popup.hide();
    }
    if let Some(main) = crate::window(app, "main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

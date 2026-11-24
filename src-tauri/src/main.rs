// TaskJinn: the native shell.
//
// All app logic lives in JavaScript (../app). This Rust part only provides what a web page
// can't do on its own: SQLite access, file handling, folder picking, serving images,
// and the tray (menu bar) icon with its popup window.

// Don't open a console window next to the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod database;
mod files;
mod tray;

use tauri::{Manager, WindowEvent};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(tray::TrayState::default())
        .register_uri_scheme_protocol("attachment", files::serve_attachment)
        .invoke_handler(tauri::generate_handler![
            database::db_query,
            database::db_execute,
            files::path_info,
            files::make_dir,
            files::write_base64,
            files::remove_file,
            files::move_path,
            files::read_text,
            files::write_text,
            files::app_data_dir,
            files::pick_folder,
            files::reveal_folder,
            tray::set_tray_state,
            tray::resize_popup,
            tray::show_main,
            tray::quit_app,
        ])
        .setup(|app| {
            tray::create(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Closing the main window only hides it; the app keeps running in the tray.
            WindowEvent::CloseRequested { api, .. } if window.label() == "main" => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The popup closes when you click anywhere else.
            WindowEvent::Focused(false) if window.label() == "popup" => {
                let _ = window.hide();
            }
            _ => {}
        })
        .build(tauri::generate_context!())
        .expect("error while starting TaskJinn")
        .run(|app, event| {
            // macOS: clicking the Dock icon shows the main window again.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                tray::show_main_window(app);
            }
            let _ = (app, event);
        });
}

/// Looks up one of the app's windows ("main" or "popup").
pub fn window(app: &tauri::AppHandle, label: &str) -> Option<tauri::WebviewWindow> {
    app.get_webview_window(label)
}

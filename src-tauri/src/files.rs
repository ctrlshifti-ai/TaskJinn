// File handling for the JavaScript side: folders, images, the organization list, and the
// folder picker. Also serves description and comment images through `attachment://` links.

use base64::Engine;
use serde::Serialize;
use std::borrow::Cow;
use std::fs;
use std::path::Path;
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext};
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
pub struct PathInfo {
    exists: bool,
    is_dir: bool,
    /// Number of items in a folder, not counting hidden ones (names starting with ".").
    visible_items: usize,
}

#[tauri::command]
pub fn path_info(path: String) -> PathInfo {
    let path = Path::new(&path);
    let visible_items = fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
                .count()
        })
        .unwrap_or(0);
    PathInfo { exists: path.exists(), is_dir: path.is_dir(), visible_items }
}

#[tauri::command]
pub fn make_dir(path: String) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

/// Writes base64 data (e.g. a pasted image) to a file. Returns its size in bytes.
#[tauri::command]
pub fn write_base64(path: String, data: String) -> Result<usize, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|e| e.to_string())?;
    fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len())
}

#[tauri::command]
pub fn remove_file(path: String) -> Result<(), String> {
    if Path::new(&path).exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Moves a file or folder. Falls back to copy-then-delete when moving to another disk.
#[tauri::command]
pub fn move_path(from: String, to: String) -> Result<(), String> {
    if fs::rename(&from, &to).is_ok() {
        return Ok(());
    }
    let source = Path::new(&from);
    if source.is_dir() {
        copy_folder(source, Path::new(&to)).map_err(|e| e.to_string())?;
        fs::remove_dir_all(source).map_err(|e| e.to_string())
    } else {
        fs::copy(&from, &to).map_err(|e| e.to_string())?;
        fs::remove_file(&from).map_err(|e| e.to_string())
    }
}

fn copy_folder(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_folder(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

/// Reads a text file, or returns nothing if it doesn't exist.
#[tauri::command]
pub fn read_text(path: String) -> Result<Option<String>, String> {
    if !Path::new(&path).exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text(path: String, text: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, text).map_err(|e| e.to_string())
}

/// Where the app keeps its own small files (the list of organizations).
#[tauri::command]
pub fn app_data_dir(app: AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Shows the system folder picker. Returns nothing if the user cancels.
#[tauri::command]
pub async fn pick_folder(app: AppHandle, title: String) -> Option<String> {
    app.dialog()
        .file()
        .set_title(title)
        .blocking_pick_folder()
        .and_then(|folder| folder.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

/// Shows the system file picker for one file with one of `extensions` (e.g. ["png", "jpg"]).
#[tauri::command]
pub async fn pick_file(app: AppHandle, title: String, extensions: Vec<String>) -> Option<String> {
    let extensions: Vec<&str> = extensions.iter().map(|e| e.as_str()).collect();
    app.dialog()
        .file()
        .set_title(title)
        .add_filter("Files", &extensions)
        .blocking_pick_file()
        .and_then(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn copy_file(from: String, to: String) -> Result<(), String> {
    fs::copy(from, to).map(|_| ()).map_err(|e| e.to_string())
}

/// Reads a file as base64 (used to preview the signature image).
#[tauri::command]
pub fn read_base64(path: String) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

/// Opens a file or folder with its usual app (Finder / Explorer / Excel...).
#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    let program = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(program).arg(path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Serves images used in descriptions and comments.
///
/// The page asks for `attachment://localhost/<file>?dir=<attachments folder>`
/// (on Windows: `http://attachment.localhost/<file>?dir=...`). Only plain file names inside a
/// folder called `attachments` are served.
pub fn serve_attachment<R: Runtime>(
    _context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let not_found = || Response::builder().status(404).body(Cow::Borrowed(&[][..])).unwrap();

    let uri = request.uri();
    let name = uri.path().trim_start_matches('/');
    let dir = uri
        .query()
        .and_then(|query| query.split('&').find_map(|pair| pair.strip_prefix("dir=")))
        .map(|value| percent_encoding::percent_decode_str(value).decode_utf8_lossy().into_owned());

    let Some(dir) = dir else { return not_found() };
    let safe_name = !name.is_empty() && !name.contains('/') && !name.contains('\\') && !name.contains("..");
    let is_attachments_folder = Path::new(&dir).file_name().map(|n| n == "attachments").unwrap_or(false);
    if !safe_name || !is_attachments_folder {
        return not_found();
    }

    match fs::read(Path::new(&dir).join(name)) {
        Ok(bytes) => Response::builder()
            .status(200)
            .header("Content-Type", mime_type(name))
            .body(Cow::Owned(bytes))
            .unwrap(),
        Err(_) => not_found(),
    }
}

fn mime_type(name: &str) -> &'static str {
    let extension = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

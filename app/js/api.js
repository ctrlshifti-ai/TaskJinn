// Thin wrappers around the native commands in ../../src-tauri/src.
// Every function returns a Promise.

const tauri = window.__TAURI__;
const invoke = tauri.core.invoke;

export const api = {
  // SQLite (one taskjinn.sqlite per organization folder)
  query: (folder, sql, params = []) => invoke('db_query', { folder, sql, params }),
  execute: (folder, statements) => invoke('db_execute', { folder, statements }),

  // Files and folders
  pathInfo: (path) => invoke('path_info', { path }),
  makeDir: (path) => invoke('make_dir', { path }),
  writeBase64: (path, data) => invoke('write_base64', { path, data }),
  removeFile: (path) => invoke('remove_file', { path }),
  movePath: (from, to) => invoke('move_path', { from, to }),
  readText: (path) => invoke('read_text', { path }),
  writeText: (path, text) => invoke('write_text', { path, text }),
  appDataDir: () => invoke('app_data_dir'),
  pickFolder: (title) => invoke('pick_folder', { title }),
  pickFile: (title, extensions) => invoke('pick_file', { title, extensions }),
  copyFile: (from, to) => invoke('copy_file', { from, to }),
  readBase64: (path) => invoke('read_base64', { path }),
  openPath: (path) => invoke('open_path', { path }),

  // Spreadsheets (layout described in reports.js)
  writeXlsx: (path, sheet) => invoke('write_xlsx', { path, sheet }),

  // Tray and windows
  setTrayState: (sessionStartedMs, runningCount, items) =>
    invoke('set_tray_state', { sessionStartedMs, runningCount, items }),
  resizePopup: (height) => invoke('resize_popup', { height }),
  showMain: () => invoke('show_main'),
  quit: () => invoke('quit_app'),
};

/** "main" or "popup". */
export const windowLabel = tauri.window.getCurrentWindow().label;

/** Sends an event to every window of the app. */
export function emit(name, payload = {}) {
  return tauri.event.emit(name, { ...payload, from: windowLabel });
}

/** Calls `handler(payload)` whenever the event arrives. */
export function on(name, handler) {
  return tauri.event.listen(name, (event) => handler(event.payload ?? {}));
}

# TaskJinn

TaskJinn is a small desktop app for tracking time on tasks, for macOS, Windows and Linux.

- **Organizations → Projects → Tasks.** Each project has a board with To Do, In Progress, In Review and Done columns. Drag a card to change its status.
- **Timers.** Press ▶ to start, ❚❚ to pause, ■ to stop (moves the task to Done). Several tasks can run at once. Every start → pause/stop is saved, so time spent is always worked out from real sessions.
- **History.** Every status change is recorded with its time, so the app can show time spent in each status and how long a task took from creation to done.
- **Rich text** descriptions and comments (headings, lists, checklists, links, code, pasted images).
- **Subtasks** with their own To Do / In Progress / Done status.
- **Tray / menu bar timer.** Click the tray icon for the tasks in progress with their controls. On Linux the tray shows a menu instead, because most Linux desktops can't open a window from a tray icon.
- **Your data stays in folders you choose.** Each organization is a folder with a `taskjinn.sqlite` database and an `attachments/` folder for images. Put it in Dropbox or iCloud, back it up, or open it on another computer with **Open Existing…**.

## Building

The app is built with [Tauri 2](https://tauri.app). Its code is plain HTML, CSS and JavaScript in `app/` (no npm, no build step). A small Rust part in `src-tauri/` gives it database, file and tray access.

You need **Rust** to build it, but you don't need to write any. Install it from [rustup.rs](https://rustup.rs). The build scripts install the Tauri command-line tool the first time they run.

| System | Command | Output in `dist/` |
|---|---|---|
| macOS | `./scripts/build-mac.sh` (add `universal` for Intel + Apple silicon) | `.dmg` |
| Windows | `powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1` | setup `.exe`, `.msi` |
| Linux | `./scripts/build-linux.sh` | `.AppImage`, `.deb` |

Each system's installers are built on that system.

- **Windows** also needs the Microsoft C++ build tools. The Rust installer offers them.
- **Linux** needs WebKitGTK and a few other libraries. The Linux script tells you what to install if they're missing.

To run the app from the source without making an installer: `./scripts/dev.sh` (or `cargo tauri dev` on Windows).

## Project layout

```
app/                  The app itself (HTML, CSS, JavaScript)
  index.html          Main window
  popup.html          Tray popup
  js/store.js         All data and changes to it
  js/schema.js        Database tables and upgrades
  js/main.js          Main window
  js/board.js         Project board
  js/taskpage.js      Task page
  js/richtext.js      Rich text editor (Quill)
  lib/                Vue and Quill, unchanged
src-tauri/            Native part (Rust): SQLite, files, images, tray
scripts/              Build scripts
```

## Data format

Each organization folder contains:

- `taskjinn.sqlite`: tables `organization`, `projects`, `tasks`, `task_labels`, `subtasks`, `time_entries`, `task_status_history`, `comments`, `attachments` (see `app/js/schema.js`)
- `attachments/`: images used in descriptions and comments, referenced from the HTML as `attachment://<file>`

The list of organizations and their folders is kept in `organizations.json` in the app's data folder.

## License

Copyright (C) 2026 TaskJinn contributors.

TaskJinn is free software: you can redistribute it and/or modify it under the terms of the
[GNU General Public License](LICENSE) as published by the Free Software Foundation, either
version 3 of the License, or (at your option) any later version. It is distributed WITHOUT ANY
WARRANTY; see the license for details.

Third-party parts keep their own (GPL-compatible) licenses, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

// The tables in each organization's taskjinn.sqlite.
//
// PRAGMA user_version records the database version. When a future version of the app
// changes these tables, add the upgrade steps to prepareDatabase() and raise LATEST_VERSION.

import { api } from './api.js';

const LATEST_VERSION = 1;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS organization (
     id          TEXT PRIMARY KEY,
     name        TEXT NOT NULL,
     created_at  TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS projects (
     id          TEXT PRIMARY KEY,
     name        TEXT NOT NULL,
     key         TEXT NOT NULL UNIQUE,
     next_number INTEGER NOT NULL DEFAULT 1,
     created_at  TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS tasks (
     id               TEXT PRIMARY KEY,
     project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     number           INTEGER NOT NULL,
     title            TEXT NOT NULL,
     description_html TEXT NOT NULL DEFAULT '',
     type             TEXT NOT NULL DEFAULT 'Task',
     status           TEXT NOT NULL DEFAULT 'To Do',
     priority         TEXT NOT NULL DEFAULT 'Medium',
     due_date         TEXT,
     estimate_minutes INTEGER,
     created_at       TEXT NOT NULL,
     updated_at       TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS task_labels (
     task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     label   TEXT NOT NULL,
     PRIMARY KEY (task_id, label))`,
  `CREATE TABLE IF NOT EXISTS subtasks (
     id       TEXT PRIMARY KEY,
     task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     title    TEXT NOT NULL,
     status   TEXT NOT NULL DEFAULT 'To Do',
     position INTEGER NOT NULL)`,
  // One row per start → pause/stop. ended_at is empty while the timer runs.
  `CREATE TABLE IF NOT EXISTS time_entries (
     id         TEXT PRIMARY KEY,
     task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     started_at TEXT NOT NULL,
     ended_at   TEXT)`,
  // One row each time a task's status changes. from_status is empty when the task was created.
  `CREATE TABLE IF NOT EXISTS task_status_history (
     id          TEXT PRIMARY KEY,
     task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     from_status TEXT,
     to_status   TEXT NOT NULL,
     changed_at  TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS comments (
     id         TEXT PRIMARY KEY,
     task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     body_html  TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL)`,
  // Image files (in the attachments/ folder) used by a task's description or comments.
  `CREATE TABLE IF NOT EXISTS attachments (
     id            TEXT PRIMARY KEY,
     task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
     file_name     TEXT NOT NULL,
     original_name TEXT NOT NULL,
     mime_type     TEXT NOT NULL,
     size          INTEGER NOT NULL,
     created_at    TEXT NOT NULL)`,
];

/** Creates any missing tables in `folder` and records the database version. */
export async function prepareDatabase(folder) {
  await api.execute(folder, TABLES.map((sql) => ({ sql })));

  const version = (await api.query(folder, 'PRAGMA user_version'))[0]?.user_version ?? 0;
  if (version < LATEST_VERSION) {
    await api.execute(folder, [{ sql: `PRAGMA user_version = ${LATEST_VERSION}` }]);
  }
}

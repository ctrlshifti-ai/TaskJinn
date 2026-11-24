// All app data and every change to it.
//
// Each organization lives in its own folder (chosen by the user) with a taskjinn.sqlite
// database and an attachments/ folder for images. The app itself only remembers the list
// of organizations and where their folders are (organizations.json in the app data folder).
//
// After every change the store re-reads everything from the databases, then tells the other
// window (main window / tray popup) to do the same.

import { api, emit, on, windowLabel } from './api.js';
import { prepareDatabase } from './schema.js';
import * as u from './util.js';

export const state = Vue.reactive({
  orgs: [],          // see loadOrganization() for the shape
  now: Date.now(),   // ticks every second while a timer runs
  error: null,       // message shown to the user
  loaded: false,
});

let registry = [];   // [{ id, name, folderPath }]
let registryFile = '';
const prepared = new Set();   // folders whose tables were checked this session

/** The UI sets this so the store can ask yes/no questions. Returns a Promise<boolean>. */
let askUser = async () => true;
export function setAskUser(fn) { askUser = fn; }

/** One SQL statement for api.execute(). */
const sql = (text, ...params) => ({ sql: text, params });

// ======================================================================
// Start-up and reading
// ======================================================================

export async function init() {
  registryFile = u.joinPath(await api.appDataDir(), 'organizations.json');
  const text = await api.readText(registryFile);
  registry = text ? JSON.parse(text) : [];
  await reloadAll();
  state.loaded = true;

  // Another window changed something: read everything again.
  on('data-changed', (payload) => {
    if (payload.from !== windowLabel) reloadAll();
  });

  setInterval(() => {
    if (runningTasks().length) state.now = Date.now();
  }, 1000);
}

export async function reloadAll() {
  state.orgs = await Promise.all(registry.map(loadOrganization));
  state.now = Date.now();
}

async function loadOrganization(entry) {
  const org = { id: entry.id, name: entry.name, folderPath: entry.folderPath ?? null, projects: [] };
  if (!entry.folderPath) return { ...org, storage: 'noFolder' };
  if (!(await hasDatabase(entry.folderPath))) return { ...org, storage: 'missing' };
  try {
    await prepare(entry.folderPath);
    return { ...org, storage: 'ready', projects: await readProjects(entry.folderPath) };
  } catch (error) {
    state.error = `Couldn't read “${entry.name}”: ${error}`;
    return { ...org, storage: 'missing' };
  }
}

async function hasDatabase(folder) {
  return (await api.pathInfo(u.databasePath(folder))).exists;
}

async function prepare(folder) {
  if (prepared.has(folder)) return;
  await prepareDatabase(folder);
  prepared.add(folder);
}

/** Groups rows by their task_id column: { taskId: [rows] }. */
function byTask(rows) {
  const groups = {};
  for (const row of rows) (groups[row.task_id] ??= []).push(row);
  return groups;
}

async function readProjects(folder) {
  const read = (text) => api.query(folder, text);
  const [projects, tasks, labels, subtasks, entries, history, comments] = await Promise.all([
    read('SELECT * FROM projects ORDER BY created_at'),
    read('SELECT * FROM tasks ORDER BY number'),
    read('SELECT * FROM task_labels ORDER BY label'),
    read('SELECT * FROM subtasks ORDER BY position'),
    read('SELECT * FROM time_entries ORDER BY started_at'),
    read('SELECT * FROM task_status_history ORDER BY changed_at'),
    read('SELECT * FROM comments ORDER BY created_at'),
  ]);
  const groups = {
    labels: byTask(labels), subtasks: byTask(subtasks), entries: byTask(entries),
    history: byTask(history), comments: byTask(comments),
  };

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    key: p.key,
    tasks: tasks.filter((t) => t.project_id === p.id).map((t) => makeTask(t, p.key, groups)),
  }));
}

function makeTask(row, projectKey, groups) {
  const id = row.id;
  return {
    id,
    projectId: row.project_id,
    number: row.number,
    key: `${projectKey}-${row.number}`,
    title: row.title,
    descriptionHtml: row.description_html,
    descriptionText: u.plainText(row.description_html),
    type: row.type,
    status: row.status,
    priority: row.priority,
    dueDate: u.parseDate(row.due_date),
    estimateMinutes: row.estimate_minutes,
    createdAt: u.parseDate(row.created_at),
    updatedAt: u.parseDate(row.updated_at),
    labels: (groups.labels[id] ?? []).map((r) => r.label),
    subtasks: (groups.subtasks[id] ?? []).map((r) => ({ id: r.id, title: r.title, status: r.status })),
    entries: (groups.entries[id] ?? []).map((r) => ({
      id: r.id, startedAt: u.parseDate(r.started_at), endedAt: u.parseDate(r.ended_at),
    })),
    history: (groups.history[id] ?? []).map((r) => ({
      id: r.id, from: r.from_status, to: r.to_status, changedAt: u.parseDate(r.changed_at),
    })),
    comments: (groups.comments[id] ?? []).map((r) => ({
      id: r.id, html: r.body_html, createdAt: u.parseDate(r.created_at), updatedAt: u.parseDate(r.updated_at),
    })),
  };
}

// ======================================================================
// Lookups
// ======================================================================

export const findOrg = (orgId) => state.orgs.find((o) => o.id === orgId);
export const findProject = (orgId, projectId) => findOrg(orgId)?.projects.find((p) => p.id === projectId);
export const findTask = (orgId, projectId, taskId) => findProject(orgId, projectId)?.tasks.find((t) => t.id === taskId);

/** Searches every project of an organization for a task. */
function taskById(orgId, taskId) {
  for (const p of findOrg(orgId)?.projects ?? []) {
    const task = p.tasks.find((t) => t.id === taskId);
    if (task) return task;
  }
  return null;
}

/** Tasks started and not yet stopped: running ones first, then the most recently started. */
export function ongoingTasks() {
  const result = [];
  for (const org of state.orgs) {
    if (org.storage !== 'ready') continue;
    for (const project of org.projects) {
      for (const task of project.tasks) {
        if (u.isOngoing(task)) result.push({ org, project, task });
      }
    }
  }
  return result.sort((a, b) => {
    const running = Number(u.isRunning(b.task)) - Number(u.isRunning(a.task));
    return running || u.lastStartedAt(b.task) - u.lastStartedAt(a.task);
  });
}

export const runningTasks = () => ongoingTasks().filter((ref) => u.isRunning(ref.task));

export const attachmentsDirFor = (orgId) => {
  const folder = findOrg(orgId)?.folderPath;
  return folder ? u.attachmentsDir(folder) : null;
};

// ======================================================================
// Saving
// ======================================================================

/**
 * Runs a change against an organization's database, then reloads everything.
 * `build(folder)` returns the SQL statements to run (it may read the database first).
 * Refuses when the organization has no usable folder, so nothing is saved without one.
 */
async function write(orgId, build) {
  const org = findOrg(orgId);
  if (org?.storage !== 'ready') {
    state.error = 'Choose a storage folder for this organization first.';
    return false;
  }
  let ok = true;
  try {
    const statements = await build(org.folderPath);
    if (statements.length) await api.execute(org.folderPath, statements);
  } catch (error) {
    state.error = String(error.message ?? error);
    ok = false;
  }
  await reloadAll();
  emit('data-changed');
  return ok;
}

// ======================================================================
// Organizations and their folders
// ======================================================================

async function saveRegistry() {
  await api.writeText(registryFile, JSON.stringify(registry, null, 2));
}

async function afterRegistryChange() {
  await saveRegistry();
  await reloadAll();
  emit('data-changed');
}

export async function addOrganization(name) {
  const entry = { id: u.newId(), name, folderPath: null };
  registry.push(entry);
  await afterRegistryChange();
  return entry.id;
}

export async function renameOrganization(orgId, name) {
  const entry = registry.find((e) => e.id === orgId);
  if (!entry) return;
  entry.name = name;
  if (findOrg(orgId)?.storage === 'ready') {
    await api.execute(entry.folderPath, [sql('UPDATE organization SET name = ?', name)]);
  }
  await afterRegistryChange();
}

/** Removes the organization from the app. Its folder and data stay on disk. */
export async function removeOrganization(orgId) {
  registry = registry.filter((e) => e.id !== orgId);
  await afterRegistryChange();
}

/** Reads the id and name stored in a folder's database. */
async function readOrganizationInfo(folder) {
  try {
    await prepare(folder);
    const [row] = await api.query(folder, 'SELECT id, name FROM organization LIMIT 1');
    if (!row) state.error = 'The database in that folder has no organization in it.';
    return row ?? null;
  } catch (error) {
    state.error = `Couldn't read that folder's database: ${error}`;
    return null;
  }
}

async function confirmFolderIfNotEmpty(folder) {
  const info = await api.pathInfo(folder);
  if (info.visible_items === 0) return true;
  return askUser('Use a folder that isn\'t empty?',
    `It already has ${u.plural(info.visible_items, 'item')}. The app will add taskjinn.sqlite and an attachments folder next to them.`,
    'Use Folder');
}

/** First folder for an organization that has none yet. */
export async function attachFolder(orgId, folder) {
  const entry = registry.find((e) => e.id === orgId);
  if (!entry) return;

  // The folder already holds an organization: offer to open that one instead.
  if (await hasDatabase(folder)) {
    const info = await readOrganizationInfo(folder);
    if (!info) return;
    if (registry.some((e) => e.id === info.id)) {
      state.error = `The organization in that folder (“${info.name}”) is already open in the app.`;
      return;
    }
    const open = await askUser(`Open “${info.name}”?`,
      `This folder already holds the organization “${info.name}”. It will replace the empty “${entry.name}”.`, 'Open');
    if (!open) return;
    Object.assign(entry, { id: info.id, name: info.name, folderPath: folder });
    await afterRegistryChange();
    return;
  }

  if (!(await confirmFolderIfNotEmpty(folder))) return;
  try {
    await prepare(folder);
    await api.execute(folder, [sql('INSERT INTO organization (id, name, created_at) VALUES (?, ?, ?)', entry.id, entry.name, u.nowIso())]);
    await api.makeDir(u.attachmentsDir(folder));
    entry.folderPath = folder;
  } catch (error) {
    state.error = `Couldn't set up the folder: ${error}`;
  }
  await afterRegistryChange();
}

/** Adds an organization from a folder that already has a database (e.g. from another computer). */
export async function openExistingOrganization(folder) {
  if (!(await hasDatabase(folder))) {
    state.error = 'That folder has no taskjinn.sqlite. Choose the folder of an existing organization.';
    return;
  }
  const info = await readOrganizationInfo(folder);
  if (!info) return;
  if (registry.some((e) => e.id === info.id)) {
    state.error = `“${info.name}” is already open in the app.`;
    return;
  }
  registry.push({ id: info.id, name: info.name, folderPath: folder });
  await afterRegistryChange();
}

/** Points an organization at its folder again after it was moved or renamed. */
export async function locateFolder(orgId, folder) {
  const entry = registry.find((e) => e.id === orgId);
  const info = (await hasDatabase(folder)) ? await readOrganizationInfo(folder) : null;
  if (!entry || info?.id !== orgId) {
    state.error = `That folder doesn't hold “${entry?.name}”. Choose the folder that contains its taskjinn.sqlite.`;
    return;
  }
  entry.folderPath = folder;
  await afterRegistryChange();
}

/** Moves an organization's database and images to another folder. */
export async function changeFolder(orgId, folder) {
  const entry = registry.find((e) => e.id === orgId);
  if (!entry?.folderPath || entry.folderPath === folder) return;
  if (await hasDatabase(folder)) {
    state.error = 'That folder already holds an organization. Choose another folder.';
    return;
  }
  if (!(await confirmFolderIfNotEmpty(folder))) return;
  try {
    await api.movePath(u.databasePath(entry.folderPath), u.databasePath(folder));
    const oldAttachments = u.attachmentsDir(entry.folderPath);
    if ((await api.pathInfo(oldAttachments)).exists) {
      await api.movePath(oldAttachments, u.attachmentsDir(folder));
    }
    entry.folderPath = folder;
  } catch (error) {
    state.error = `Couldn't move the data: ${error}. Check both folders before trying again.`;
  }
  await afterRegistryChange();
}

// ======================================================================
// Projects
// ======================================================================

export function addProject(orgId, name, key) {
  return write(orgId, async () => {
    const taken = findOrg(orgId).projects.map((p) => p.key);
    const finalKey = u.cleanKey(key) || u.suggestKey(name, taken);
    if (taken.includes(finalKey)) throw new Error(`The key “${finalKey}” is already used by another project.`);
    return [sql('INSERT INTO projects (id, name, key, next_number, created_at) VALUES (?, ?, ?, 1, ?)',
      u.newId(), name, finalKey, u.nowIso())];
  });
}

export function updateProject(orgId, projectId, name, key) {
  return write(orgId, async () => {
    const newKey = u.cleanKey(key);
    if (!newKey) return [sql('UPDATE projects SET name = ? WHERE id = ?', name, projectId)];
    const clash = findOrg(orgId).projects.some((p) => p.key === newKey && p.id !== projectId);
    if (clash) throw new Error(`The key “${newKey}” is already used by another project.`);
    return [sql('UPDATE projects SET name = ?, key = ? WHERE id = ?', name, newKey, projectId)];
  });
}

export function deleteProject(orgId, projectId) {
  return write(orgId, async (folder) => {
    const files = await api.query(folder,
      'SELECT a.file_name FROM attachments a JOIN tasks t ON a.task_id = t.id WHERE t.project_id = ?', [projectId]);
    await deleteFiles(folder, files.map((f) => f.file_name));
    return [sql('DELETE FROM projects WHERE id = ?', projectId)];
  });
}

// ======================================================================
// Tasks
// ======================================================================

/** Statements that change a task's status and record the change in its history. */
function statusChange(task, toStatus) {
  if (task.status === toStatus) return [];
  const now = u.nowIso();
  return [
    sql('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', toStatus, now, task.id),
    sql('INSERT INTO task_status_history (id, task_id, from_status, to_status, changed_at) VALUES (?, ?, ?, ?, ?)',
      u.newId(), task.id, task.status, toStatus, now),
  ];
}

/** Creates a task and returns its id. */
export async function addTask(orgId, projectId, title) {
  const taskId = u.newId();
  const ok = await write(orgId, async (folder) => {
    const [project] = await api.query(folder, 'SELECT next_number FROM projects WHERE id = ?', [projectId]);
    const number = project?.next_number ?? 1;
    const now = u.nowIso();
    return [
      sql('UPDATE projects SET next_number = ? WHERE id = ?', number + 1, projectId),
      sql('INSERT INTO tasks (id, project_id, number, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        taskId, projectId, number, title, now, now),
      sql('INSERT INTO task_status_history (id, task_id, from_status, to_status, changed_at) VALUES (?, ?, NULL, ?, ?)',
        u.newId(), taskId, 'To Do', now),
    ];
  });
  return ok ? taskId : null;
}

export function deleteTask(orgId, taskId) {
  return write(orgId, async (folder) => {
    const files = await api.query(folder, 'SELECT file_name FROM attachments WHERE task_id = ?', [taskId]);
    await deleteFiles(folder, files.map((f) => f.file_name));
    return [sql('DELETE FROM tasks WHERE id = ?', taskId)];
  });
}

/** Changes one column of a task. `column` always comes from the code below, never from the user. */
function setTaskColumn(orgId, taskId, column, value) {
  return write(orgId, async () => [
    sql(`UPDATE tasks SET ${column} = ?, updated_at = ? WHERE id = ?`, value, u.nowIso(), taskId),
  ]);
}

export const setTitle = (orgId, taskId, title) => setTaskColumn(orgId, taskId, 'title', title);
export const setType = (orgId, taskId, type) => setTaskColumn(orgId, taskId, 'type', type);
export const setPriority = (orgId, taskId, priority) => setTaskColumn(orgId, taskId, 'priority', priority);
export const setEstimate = (orgId, taskId, minutes) => setTaskColumn(orgId, taskId, 'estimate_minutes', minutes);
/** `date` is "YYYY-MM-DD" from a date field, or empty to clear it. Saved as local midnight. */
export const setDueDate = (orgId, taskId, date) =>
  setTaskColumn(orgId, taskId, 'due_date', date ? new Date(`${date}T00:00:00`).toISOString() : null);

/** Changes the task's status (e.g. dragged to another board column) and records it in its history. */
export function setStatus(orgId, taskId, status) {
  const task = taskById(orgId, taskId);
  if (!task || task.status === status) return Promise.resolve(true);
  return write(orgId, async () => statusChange(task, status));
}

export function addLabel(orgId, taskId, label) {
  const clean = label.trim().toLowerCase();
  if (!clean) return Promise.resolve(false);
  return write(orgId, async () => [sql('INSERT OR IGNORE INTO task_labels (task_id, label) VALUES (?, ?)', taskId, clean)]);
}

export function removeLabel(orgId, taskId, label) {
  return write(orgId, async () => [sql('DELETE FROM task_labels WHERE task_id = ? AND label = ?', taskId, label)]);
}

// ======================================================================
// Timer: every start → pause/stop is saved as one time entry
// ======================================================================

/** Starts (or resumes) a task. Several tasks can run at the same time. */
export function start(orgId, taskId) {
  const task = taskById(orgId, taskId);
  if (!task || u.isRunning(task)) return Promise.resolve(true);
  return write(orgId, async () => [
    sql('INSERT INTO time_entries (id, task_id, started_at) VALUES (?, ?, ?)', u.newId(), taskId, u.nowIso()),
    // Starting work moves a To Do (or reopened Done) task to In Progress.
    ...(task.status === 'To Do' || task.status === 'Done' ? statusChange(task, 'In Progress') : []),
  ]);
}

export function pause(orgId, taskId) {
  return write(orgId, async () => [
    sql('UPDATE time_entries SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL', u.nowIso(), taskId),
  ]);
}

/** Stops the timer and moves the task to Done. */
export function stop(orgId, taskId) {
  const task = taskById(orgId, taskId);
  if (!task) return Promise.resolve(false);
  return write(orgId, async () => [
    sql('UPDATE time_entries SET ended_at = ? WHERE task_id = ? AND ended_at IS NULL', u.nowIso(), taskId),
    ...statusChange(task, 'Done'),
  ]);
}

export function resetTime(orgId, taskId) {
  return write(orgId, async () => [sql('DELETE FROM time_entries WHERE task_id = ?', taskId)]);
}

export function deleteTimeEntry(orgId, entryId) {
  return write(orgId, async () => [sql('DELETE FROM time_entries WHERE id = ?', entryId)]);
}

// ======================================================================
// Subtasks (their status never changes the task's status)
// ======================================================================

export function addSubtask(orgId, taskId, title) {
  const clean = title.trim();
  if (!clean) return Promise.resolve(false);
  const position = taskById(orgId, taskId)?.subtasks.length ?? 0;
  return write(orgId, async () => [
    sql('INSERT INTO subtasks (id, task_id, title, status, position) VALUES (?, ?, ?, ?, ?)',
      u.newId(), taskId, clean, 'To Do', position),
  ]);
}

export function setSubtaskStatus(orgId, subtaskId, status) {
  return write(orgId, async () => [sql('UPDATE subtasks SET status = ? WHERE id = ?', status, subtaskId)]);
}

export function renameSubtask(orgId, subtaskId, title) {
  const clean = title.trim();
  if (!clean) return Promise.resolve(false);
  return write(orgId, async () => [sql('UPDATE subtasks SET title = ? WHERE id = ?', clean, subtaskId)]);
}

export function deleteSubtask(orgId, subtaskId) {
  return write(orgId, async () => [sql('DELETE FROM subtasks WHERE id = ?', subtaskId)]);
}

// ======================================================================
// Description, comments and their images
// ======================================================================

export async function saveDescription(orgId, taskId, html) {
  await write(orgId, async (folder) => {
    const saved = await saveImages(folder, taskId, html);
    return [...saved.statements,
      sql('UPDATE tasks SET description_html = ?, updated_at = ? WHERE id = ?', saved.html, u.nowIso(), taskId)];
  });
  await removeUnusedImages(orgId, taskId);
}

export async function addComment(orgId, taskId, html) {
  if (!u.plainText(html) && !html.includes('<img')) return;
  await write(orgId, async (folder) => {
    const saved = await saveImages(folder, taskId, html);
    const now = u.nowIso();
    return [...saved.statements,
      sql('INSERT INTO comments (id, task_id, body_html, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        u.newId(), taskId, saved.html, now, now)];
  });
}

export async function updateComment(orgId, taskId, commentId, html) {
  await write(orgId, async (folder) => {
    const saved = await saveImages(folder, taskId, html);
    return [...saved.statements,
      sql('UPDATE comments SET body_html = ?, updated_at = ? WHERE id = ?', saved.html, u.nowIso(), commentId)];
  });
  await removeUnusedImages(orgId, taskId);
}

export async function deleteComment(orgId, taskId, commentId) {
  await write(orgId, async () => [sql('DELETE FROM comments WHERE id = ?', commentId)]);
  await removeUnusedImages(orgId, taskId);
}

/**
 * Pasted images arrive from the editor as data: URLs. Each one is written to the
 * attachments folder and replaced by an attachment://<file> link.
 */
async function saveImages(folder, taskId, html) {
  const dir = u.attachmentsDir(folder);
  await api.makeDir(dir);
  const statements = [];
  const pattern = /src="data:image\/([a-zA-Z0-9.+-]+);base64,([^"]*)"/;
  let match;
  while ((match = html.match(pattern))) {
    const subtype = match[1].toLowerCase();
    const extension = { jpeg: 'jpg', 'svg+xml': 'svg' }[subtype] ?? subtype;
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const size = await api.writeBase64(u.joinPath(dir, fileName), match[2]);
    statements.push(sql(
      'INSERT INTO attachments (id, task_id, file_name, original_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      u.newId(), taskId, fileName, `pasted-image.${extension}`, `image/${subtype}`, size, u.nowIso()));
    html = html.replace(match[0], () => `src="attachment://${fileName}"`);
  }
  return { html, statements };
}

/** Deletes image files no longer used by the task's description or any of its comments. */
async function removeUnusedImages(orgId, taskId) {
  const folder = findOrg(orgId)?.folderPath;
  if (!folder) return;
  const [task] = await api.query(folder, 'SELECT description_html FROM tasks WHERE id = ?', [taskId]);
  const comments = await api.query(folder, 'SELECT body_html FROM comments WHERE task_id = ?', [taskId]);
  const used = [task?.description_html ?? '', ...comments.map((c) => c.body_html)].join('\n');

  const files = await api.query(folder, 'SELECT id, file_name FROM attachments WHERE task_id = ?', [taskId]);
  const unused = files.filter((f) => !used.includes(f.file_name));
  if (!unused.length) return;
  await deleteFiles(folder, unused.map((f) => f.file_name));
  await api.execute(folder, unused.map((f) => sql('DELETE FROM attachments WHERE id = ?', f.id)));
}

async function deleteFiles(folder, names) {
  for (const name of names) await api.removeFile(u.joinPath(u.attachmentsDir(folder), name));
}

// ======================================================================
// Tray (main window only)
// ======================================================================

const isLinux = navigator.userAgent.includes('Linux') && !navigator.userAgent.includes('Android');

/**
 * Tells the native side what the tray should show: the newest running session (for the
 * menu bar timer) and, on Linux, menu items for each task in progress.
 */
export async function syncTray() {
  const running = runningTasks();
  const newest = running[0]?.task;
  const openEntry = newest?.entries.find((e) => e.endedAt === null);

  const items = [];
  if (isLinux) {
    for (const { org, task } of ongoingTasks()) {
      const isOn = u.isRunning(task);
      items.push({ id: `label:${task.id}`, label: `${isOn ? '▶' : '⏸'}  ${task.key}  ${task.title}`, enabled: false });
      items.push({ id: `${isOn ? 'pause' : 'start'}:${org.id}:${task.id}`, label: isOn ? '      Pause' : '      Resume', enabled: true });
      items.push({ id: `stop:${org.id}:${task.id}`, label: '      Stop (mark Done)', enabled: true });
    }
  }
  await api.setTrayState(openEntry?.startedAt ?? null, running.length, items);
}

/** Handles a click on a Linux tray menu item such as "pause:<org id>:<task id>". */
export function handleTrayAction(id) {
  const [action, orgId, taskId] = id.split(':');
  if (action === 'start') start(orgId, taskId);
  if (action === 'pause') pause(orgId, taskId);
  if (action === 'stop') stop(orgId, taskId);
}

// Small helpers and fixed lists shared by the whole app.

// ---------- Fixed lists ----------

export const STATUSES = ['To Do', 'In Progress', 'In Review', 'Done'];
export const STATUS_COLORS = { 'To Do': 'gray', 'In Progress': 'blue', 'In Review': 'purple', 'Done': 'green' };

export const TYPES = ['Task', 'Bug', 'Story'];
export const TYPE_ICONS = { Task: '☑️', Bug: '🐞', Story: '🔖' };

export const PRIORITIES = ['Lowest', 'Low', 'Medium', 'High', 'Highest'];
export const PRIORITY_ICONS = { Lowest: '⇊', Low: '↓', Medium: '＝', High: '↑', Highest: '⇈' };
export const PRIORITY_COLORS = { Lowest: 'blue', Low: 'blue', Medium: 'orange', High: 'red', Highest: 'red' };

/** Subtasks have their own status, separate from their task's status. */
export const SUBTASK_STATUSES = ['To Do', 'In Progress', 'Done'];
export const SUBTASK_ICONS = { 'To Do': '○', 'In Progress': '◐', 'Done': '●' };
export function nextSubtaskStatus(status) {
  return { 'To Do': 'In Progress', 'In Progress': 'Done', 'Done': 'To Do' }[status] ?? 'To Do';
}

// ---------- Ids, dates, text ----------

/** Row ids are upper-case UUIDs. */
export const newId = () => crypto.randomUUID().toUpperCase();
export const nowIso = () => new Date().toISOString();
export const parseDate = (text) => (text ? Date.parse(text) : null);

/** 3725 seconds → "1:02:05" */
export function formatDuration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 150 → "2h 30m" */
export function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function formatDateTime(ms) {
  return ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function formatDate(ms) {
  return ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
}

/** Turns rich text HTML into one line of plain text for previews. */
export function plainText(html) {
  const element = document.createElement('div');
  element.innerHTML = (html || '').replace(/<\/(p|li|h[1-6]|blockquote)>|<br\s*\/?>/g, ' ');
  return element.textContent.replace(/\s+/g, ' ').trim();
}

/** Project keys: capital letters and digits only, at most 10 characters. */
export function cleanKey(text) {
  return (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

/** Suggests a key from a project name ("Web Site" → "WS", "Marketing" → "MAR"). */
export function suggestKey(name, taken) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  let key = words.length > 1 ? cleanKey(words.map((w) => w[0]).join('')) : cleanKey(name.slice(0, 3));
  if (!key) key = 'PRJ';
  let candidate = key;
  for (let n = 2; taken.includes(candidate); n++) candidate = key + n;
  return candidate;
}

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------- Paths ----------

/** Joins two path parts using the separator the first part already uses (\ on Windows). */
export function joinPath(folder, name) {
  const separator = folder.includes('\\') ? '\\' : '/';
  return folder.replace(/[\\/]+$/, '') + separator + name;
}

export const databasePath = (folder) => joinPath(folder, 'taskjinn.sqlite');
export const attachmentsDir = (folder) => joinPath(folder, 'attachments');

// ---------- Images in rich text ----------
// Saved HTML refers to images as attachment://<file>. The page loads them through the app's
// "attachment" protocol, which needs the folder too, and on Windows has a different address.

const ATTACHMENT_BASE = navigator.userAgent.includes('Windows')
  ? 'http://attachment.localhost/'
  : 'attachment://localhost/';

/** Saved HTML → HTML the page can display. */
export function toDisplayHtml(html, dir) {
  if (!dir) return html;
  return html.replace(/src="attachment:\/\/([^"\/?]+)"/g,
    (_, name) => `src="${ATTACHMENT_BASE}${name}?dir=${encodeURIComponent(dir)}"`);
}

/** HTML from the editor → HTML to save. */
export function toSavedHtml(html) {
  return html.replace(/src="(?:attachment:\/\/localhost\/|http:\/\/attachment\.localhost\/)([^"?]+)\?dir=[^"]*"/g,
    'src="attachment://$1"');
}

// ---------- Task time ----------

export const isRunning = (task) => task.entries.some((e) => e.endedAt === null);

/** Started at least once and not stopped yet (running or paused). */
export const isOngoing = (task) => task.status !== 'Done' && task.entries.length > 0;

export const entryDuration = (entry, now) => Math.max(0, (entry.endedAt ?? now) - entry.startedAt);

export const elapsed = (task, now) => task.entries.reduce((sum, e) => sum + entryDuration(e, now), 0);

/** How long the current session has been running, or null when paused. */
export function sessionTime(task, now) {
  const open = task.entries.find((e) => e.endedAt === null);
  return open ? now - open.startedAt : null;
}

export const lastStartedAt = (task) => Math.max(task.createdAt, ...task.entries.map((e) => e.startedAt));

/** Figures worked out from a task's time entries and status history. */
export function taskStats(task, now) {
  const starts = task.entries.map((e) => e.startedAt);
  const doneChange = [...task.history].reverse().find((h) => h.to === 'Done');
  const completedAt = task.status === 'Done' ? doneChange?.changedAt ?? null : null;

  // Time spent in each status, from one status change to the next.
  const timeInStatus = {};
  task.history.forEach((change, i) => {
    const until = task.history[i + 1]?.changedAt ?? now;
    timeInStatus[change.to] = (timeInStatus[change.to] ?? 0) + Math.max(0, until - change.changedAt);
  });

  return {
    tracked: elapsed(task, now),
    sessions: task.entries.length,
    firstStarted: starts.length ? Math.min(...starts) : null,
    completedAt,
    leadTime: completedAt ? completedAt - task.createdAt : null,
    timeInStatus,
  };
}

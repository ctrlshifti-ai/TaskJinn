// One task's page: title, description, subtasks, comments, status history and time log,
// with a side panel for the timer and details (status, type, priority, labels, dates...).

import * as store from './store.js';
import * as u from './util.js';
import { RichText } from './richtext.js';
import { DropMenu, StatusPill, TimerButtons, TypeIcon } from './components.js';

const SubtaskList = {
  props: ['org', 'task', 'canEdit'],
  data: () => ({ newTitle: '', editingId: null, editText: '' }),
  template: `
    <div class="subtasks">
      <div v-if="task.subtasks.length" class="progress-line">
        <progress :value="done" :max="task.subtasks.length"></progress>
        <span class="muted">{{ done }} done · {{ inProgress }} in progress · {{ u.plural(task.subtasks.length, 'subtask') }}</span>
      </div>
      <div v-for="s in task.subtasks" :key="s.id" class="subtask" :class="'s-' + s.status.replace(' ', '-').toLowerCase()">
        <button class="subtask-status" :disabled="!canEdit"
                :title="s.status + '. Click to mark ' + u.nextSubtaskStatus(s.status) + '.'"
                @click="store.setSubtaskStatus(org.id, s.id, u.nextSubtaskStatus(s.status))">{{ u.SUBTASK_ICONS[s.status] }}</button>
        <input v-if="editingId === s.id" v-model="editText" class="inline-input" ref="editInput"
               @keydown.enter="saveRename(s)" @keydown.esc="editingId = null" @blur="saveRename(s)">
        <span v-else class="subtask-title" @dblclick="startRename(s)">{{ s.title }}</span>
        <select :value="s.status" :disabled="!canEdit" class="mini-select"
                @change="store.setSubtaskStatus(org.id, s.id, $event.target.value)">
          <option v-for="status in u.SUBTASK_STATUSES" :key="status">{{ status }}</option>
        </select>
        <button v-if="canEdit" class="icon-button hover-only" title="Rename" @click="startRename(s)">✎</button>
        <button v-if="canEdit" class="icon-button hover-only danger" title="Delete" @click="store.deleteSubtask(org.id, s.id)">✕</button>
      </div>
      <input v-if="canEdit" v-model="newTitle" class="add-input" placeholder="＋ Add subtask (press Enter)"
             @keydown.enter="add">
    </div>`,
  computed: {
    u: () => u,
    store: () => store,
    done() { return this.task.subtasks.filter((s) => s.status === 'Done').length; },
    inProgress() { return this.task.subtasks.filter((s) => s.status === 'In Progress').length; },
  },
  methods: {
    add() {
      store.addSubtask(this.org.id, this.task.id, this.newTitle);
      this.newTitle = '';
    },
    startRename(s) {
      if (!this.canEdit) return;
      this.editingId = s.id;
      this.editText = s.title;
      this.$nextTick(() => this.$refs.editInput?.[0]?.focus());
    },
    saveRename(s) {
      if (this.editingId !== s.id) return;
      this.editingId = null;
      if (this.editText.trim() && this.editText !== s.title) store.renameSubtask(this.org.id, s.id, this.editText);
    },
  },
};

const CommentItem = {
  components: { RichText, DropMenu },
  props: ['org', 'task', 'comment', 'dir', 'canEdit'],
  data: () => ({ editing: false }),
  template: `
    <div class="comment">
      <div class="comment-head">
        <span class="muted">{{ u.formatDateTime(comment.createdAt) }}
          <span v-if="comment.updatedAt - comment.createdAt > 1000"> · edited</span></span>
        <span class="spacer"></span>
        <template v-if="editing">
          <button @click="editing = false">Cancel</button>
          <button class="primary" @click="save">Save</button>
        </template>
        <DropMenu v-else-if="canEdit" :items="menu" />
      </div>
      <RichText ref="editor" :html="comment.html" :editing="editing" :attachments-dir="dir" />
    </div>`,
  computed: {
    u: () => u,
    menu() {
      return [
        { label: 'Edit', action: () => { this.editing = true; } },
        { label: 'Delete', danger: true, action: () => store.deleteComment(this.org.id, this.task.id, this.comment.id) },
      ];
    },
  },
  methods: {
    async save() {
      await store.updateComment(this.org.id, this.task.id, this.comment.id, this.$refs.editor.getHtml());
      this.editing = false;
    },
  },
};

export const TaskPage = {
  components: { RichText, SubtaskList, CommentItem, DropMenu, StatusPill, TimerButtons, TypeIcon },
  props: ['org', 'project', 'task', 'now'],
  emits: ['back', 'delete'],
  data() {
    return { titleDraft: this.task.title, editingDescription: false, newLabel: '', commentEditorKey: 0 };
  },
  template: `
    <div class="task-page">
      <div class="task-topbar">
        <button class="link-button" @click="$emit('back')">‹ {{ project.name }}</button>
        <span class="spacer"></span>
        <DropMenu v-if="canEdit" :items="menu" />
      </div>

      <div class="task-body">
        <main class="task-main">
          <div class="task-key"><TypeIcon :type="task.type" /> {{ task.key }}</div>
          <textarea v-model="titleDraft" class="title-input" rows="1" :disabled="!canEdit"
                    @keydown.enter.prevent="$event.target.blur()" @blur="saveTitle"></textarea>

          <section>
            <div class="section-head">
              <h3>Description</h3>
              <span class="spacer"></span>
              <template v-if="editingDescription">
                <button @click="editingDescription = false">Cancel</button>
                <button class="primary" @click="saveDescription">Save</button>
              </template>
              <button v-else :disabled="!canEdit" @click="editingDescription = true">✎ Edit</button>
            </div>
            <RichText ref="description" :html="task.descriptionHtml" :editing="editingDescription"
                      :attachments-dir="dir" placeholder="No description yet." />
          </section>

          <section>
            <div class="section-head"><h3>Subtasks</h3></div>
            <SubtaskList :org="org" :task="task" :can-edit="canEdit" />
          </section>

          <section>
            <div class="section-head"><h3>Comments</h3><span class="muted">{{ task.comments.length }}</span></div>
            <CommentItem v-for="c in task.comments" :key="c.id" :org="org" :task="task" :comment="c"
                         :dir="dir" :can-edit="canEdit" />
            <div v-if="canEdit" class="new-comment">
              <RichText ref="newComment" :key="commentEditorKey" :editing="true" :attachments-dir="dir"
                        placeholder="Write a comment…" />
              <div class="right"><button class="primary" @click="addComment">Add Comment</button></div>
            </div>
          </section>

          <section>
            <div class="section-head"><h3>Status history</h3></div>
            <p v-if="!task.history.length" class="muted">No status changes recorded yet.</p>
            <ul class="history">
              <li v-for="h in [...task.history].reverse()" :key="h.id">
                <span v-if="h.from">Moved from <StatusPill :status="h.from" /> to <StatusPill :status="h.to" /></span>
                <span v-else>Created in <StatusPill :status="h.to" /></span>
                <span class="muted">{{ u.formatDateTime(h.changedAt) }}</span>
              </li>
            </ul>
          </section>

          <section>
            <div class="section-head"><h3>Time log</h3><span class="muted">{{ u.plural(task.entries.length, 'session') }}</span></div>
            <p v-if="!task.entries.length" class="muted">No time recorded yet. Press ▶ to start.</p>
            <ul class="history">
              <li v-for="e in [...task.entries].reverse()" :key="e.id">
                <span>{{ u.formatDateTime(e.startedAt) }} → {{ e.endedAt ? u.formatDateTime(e.endedAt) : 'running' }}</span>
                <span class="time" :class="{ green: !e.endedAt }">{{ u.formatDuration(u.entryDuration(e, now)) }}</span>
                <button v-if="canEdit" class="icon-button hover-only danger" title="Delete this session"
                        @click="store.deleteTimeEntry(org.id, e.id)">✕</button>
              </li>
            </ul>
          </section>
        </main>

        <aside class="task-side">
          <div class="timer-box" :class="{ running }">
            <div class="big-time">{{ u.formatDuration(stats.tracked) }}</div>
            <div v-if="task.estimateMinutes" class="estimate">
              <progress :value="Math.min(estimateUsed, 1)" max="1" :class="{ over: estimateUsed > 1 }"></progress>
              <span class="muted">{{ Math.round(estimateUsed * 100) }}% of {{ u.formatMinutes(task.estimateMinutes) }}</span>
            </div>
            <TimerButtons :task="task" large :disabled="!canEdit"
                          @start="store.start(org.id, task.id)" @pause="store.pause(org.id, task.id)"
                          @stop="store.stop(org.id, task.id)" />
          </div>

          <label class="field">Status
            <select :value="task.status" :disabled="!canEdit" @change="store.setStatus(org.id, task.id, $event.target.value)">
              <option v-for="s in u.STATUSES" :key="s">{{ s }}</option>
            </select>
          </label>
          <label class="field">Type
            <select :value="task.type" :disabled="!canEdit" @change="store.setType(org.id, task.id, $event.target.value)">
              <option v-for="t in u.TYPES" :key="t" :value="t">{{ u.TYPE_ICONS[t] }} {{ t }}</option>
            </select>
          </label>
          <label class="field">Priority
            <select :value="task.priority" :disabled="!canEdit" @change="store.setPriority(org.id, task.id, $event.target.value)">
              <option v-for="p in u.PRIORITIES" :key="p" :value="p">{{ u.PRIORITY_ICONS[p] }} {{ p }}</option>
            </select>
          </label>
          <div class="field">Labels
            <div class="labels">
              <span v-for="label in task.labels" :key="label" class="label">{{ label }}
                <button v-if="canEdit" class="label-x" @click="store.removeLabel(org.id, task.id, label)">✕</button></span>
            </div>
            <input v-if="canEdit" v-model="newLabel" placeholder="Add label + Enter" @keydown.enter="addLabel">
          </div>
          <label class="field">Due date
            <input type="date" :value="dueDateValue" :disabled="!canEdit"
                   @change="store.setDueDate(org.id, task.id, $event.target.value)">
          </label>
          <label class="field">Estimate (minutes)
            <input type="number" min="0" step="15" :value="task.estimateMinutes ?? ''" :disabled="!canEdit"
                   @change="setEstimate($event.target.value)">
          </label>

          <div class="stats">
            <div><span>Sessions</span><b>{{ stats.sessions }}</b></div>
            <div><span>First started</span><b>{{ u.formatDateTime(stats.firstStarted) }}</b></div>
            <div><span>Completed</span><b>{{ u.formatDateTime(stats.completedAt) }}</b></div>
            <div v-if="stats.leadTime"><span>Created → done</span><b>{{ u.formatDuration(stats.leadTime) }}</b></div>
            <div v-for="(ms, status) in stats.timeInStatus" :key="status"><span>Time in {{ status }}</span><b>{{ u.formatDuration(ms) }}</b></div>
            <div><span>Created</span><b>{{ u.formatDateTime(task.createdAt) }}</b></div>
            <div><span>Updated</span><b>{{ u.formatDateTime(task.updatedAt) }}</b></div>
          </div>
        </aside>
      </div>
    </div>`,
  computed: {
    u: () => u,
    store: () => store,
    canEdit() { return this.org.storage === 'ready'; },
    dir() { return store.attachmentsDirFor(this.org.id) ?? ''; },
    running() { return u.isRunning(this.task); },
    stats() { return u.taskStats(this.task, this.now); },
    estimateUsed() { return this.stats.tracked / (this.task.estimateMinutes * 60000); },
    dueDateValue() {
      if (!this.task.dueDate) return '';
      const d = new Date(this.task.dueDate);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    menu() {
      return [
        { label: 'Reset time', action: () => store.resetTime(this.org.id, this.task.id) },
        { label: 'Delete task…', danger: true, action: () => this.$emit('delete') },
      ];
    },
  },
  watch: {
    'task.title'(title) { this.titleDraft = title; },
  },
  methods: {
    saveTitle() {
      const title = this.titleDraft.trim();
      if (!title) this.titleDraft = this.task.title;
      else if (title !== this.task.title) store.setTitle(this.org.id, this.task.id, title);
    },
    async saveDescription() {
      await store.saveDescription(this.org.id, this.task.id, this.$refs.description.getHtml());
      this.editingDescription = false;
    },
    async addComment() {
      await store.addComment(this.org.id, this.task.id, this.$refs.newComment.getHtml());
      this.commentEditorKey += 1;   // fresh, empty editor
    },
    addLabel() {
      store.addLabel(this.org.id, this.task.id, this.newLabel);
      this.newLabel = '';
    },
    setEstimate(value) {
      const minutes = parseInt(value, 10);
      store.setEstimate(this.org.id, this.task.id, minutes > 0 ? minutes : null);
    },
  },
};

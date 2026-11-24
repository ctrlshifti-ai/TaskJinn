// A project's tasks as a board: one column per status.
// Dragging a card to another column changes the task's status (and records it in its history).

import * as store from './store.js';
import * as u from './util.js';
import { PriorityIcon, StatusPill, TimerButtons, TypeIcon } from './components.js';

const TaskCard = {
  components: { PriorityIcon, TimerButtons, TypeIcon },
  props: ['task', 'now', 'canEdit'],
  emits: ['start', 'pause', 'stop'],
  template: `
    <article class="card" :class="{ running }">
      <div class="card-top">
        <TypeIcon :type="task.type" />
        <span class="key">{{ task.key }}</span>
        <PriorityIcon :priority="task.priority" />
        <span class="spacer"></span>
        <span v-if="task.dueDate" class="due" :class="{ overdue }">📅 {{ u.formatDate(task.dueDate) }}</span>
      </div>
      <div class="card-title" :class="{ done: task.status === 'Done' }">{{ task.title }}</div>
      <div v-if="hasMeta" class="card-meta">
        <span v-if="task.subtasks.length" title="Subtasks done">☑ {{ subtasksDone }}/{{ task.subtasks.length }}</span>
        <span v-if="task.comments.length" title="Comments">💬 {{ task.comments.length }}</span>
        <span v-for="label in task.labels" :key="label" class="label">{{ label }}</span>
      </div>
      <div class="card-bottom">
        <span class="time" :class="{ green: running }">{{ u.formatDuration(u.elapsed(task, now)) }}</span>
        <TimerButtons :task="task" :disabled="!canEdit"
                      @start="$emit('start')" @pause="$emit('pause')" @stop="$emit('stop')" />
      </div>
    </article>`,
  computed: {
    u: () => u,
    running() { return u.isRunning(this.task); },
    overdue() { return this.task.dueDate < Date.now() && this.task.status !== 'Done'; },
    subtasksDone() { return this.task.subtasks.filter((s) => s.status === 'Done').length; },
    hasMeta() { return this.task.subtasks.length || this.task.comments.length || this.task.labels.length; },
  },
};

export const Board = {
  components: { TaskCard, StatusPill },
  props: ['org', 'project', 'now'],
  emits: ['open', 'new-task'],
  data: () => ({ draggingId: null, overColumn: null }),
  template: `
    <div class="board-page">
      <header class="page-header">
        <div>
          <h1>{{ project.name }}</h1>
          <p class="muted">{{ org.name }} · {{ project.key }} · {{ u.plural(project.tasks.length, 'task') }} ·
            {{ u.formatDuration(total) }} tracked</p>
        </div>
        <button class="primary" :disabled="!canEdit" @click="$emit('new-task')">＋ New Task</button>
      </header>

      <div class="board">
        <section v-for="column in columns" :key="column.status" class="column"
                 :class="{ over: overColumn === column.status }"
                 @dragover.prevent="overColumn = column.status"
                 @dragleave="leaveColumn(column.status, $event)"
                 @drop.prevent="drop(column.status)">
          <h2><StatusPill :status="column.status" /> <span class="count">{{ column.tasks.length }}</span></h2>
          <div class="cards">
            <TaskCard v-for="task in column.tasks" :key="task.id" :task="task" :now="now" :can-edit="canEdit"
                      :draggable="canEdit" :class="{ dragging: draggingId === task.id }"
                      @dragstart="dragStart(task, $event)" @dragend="dragEnd"
                      @click="$emit('open', task.id)"
                      @start="store.start(org.id, task.id)"
                      @pause="store.pause(org.id, task.id)"
                      @stop="store.stop(org.id, task.id)" />
            <p v-if="!column.tasks.length" class="empty-column">{{ canEdit ? 'Drag tasks here' : 'No tasks' }}</p>
          </div>
        </section>
      </div>
    </div>`,
  computed: {
    u: () => u,
    store: () => store,
    canEdit() { return this.org.storage === 'ready'; },
    total() { return this.project.tasks.reduce((sum, t) => sum + u.elapsed(t, this.now), 0); },
    columns() {
      return u.STATUSES.map((status) => ({
        status,
        tasks: this.project.tasks.filter((t) => t.status === status),
      }));
    },
  },
  methods: {
    dragStart(task, event) {
      this.draggingId = task.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', task.id);
    },
    dragEnd() {
      this.draggingId = null;
      this.overColumn = null;
    },
    leaveColumn(status, event) {
      // Ignore "leaving" into one of the column's own cards.
      if (!event.currentTarget.contains(event.relatedTarget) && this.overColumn === status) this.overColumn = null;
    },
    drop(status) {
      if (this.draggingId) store.setStatus(this.org.id, this.draggingId, status);
      this.dragEnd();
    },
  },
};

// Small pieces used in several places.

import * as u from './util.js';

export const StatusPill = {
  props: ['status'],
  template: `<span class="pill" :class="'c-' + color">{{ status }}</span>`,
  computed: {
    color() { return u.STATUS_COLORS[this.status] ?? 'gray'; },
  },
};

export const TypeIcon = {
  props: ['type'],
  template: `<span class="type-icon" :title="type">{{ icon }}</span>`,
  computed: {
    icon() { return u.TYPE_ICONS[this.type] ?? u.TYPE_ICONS.Task; },
  },
};

export const PriorityIcon = {
  props: ['priority'],
  template: `<span class="priority" :class="'c-' + color" :title="priority + ' priority'">{{ icon }}</span>`,
  computed: {
    icon() { return u.PRIORITY_ICONS[this.priority] ?? '＝'; },
    color() { return u.PRIORITY_COLORS[this.priority] ?? 'orange'; },
  },
};

/** ▶ or ❚❚ (depending on whether the task runs), then ■. */
export const TimerButtons = {
  props: { task: Object, large: Boolean, disabled: Boolean },
  emits: ['start', 'pause', 'stop'],
  template: `
    <span class="timer-buttons" :class="{ large }">
      <button v-if="running" class="round orange" title="Pause" :disabled="disabled" @click.stop="$emit('pause')">❚❚</button>
      <button v-else class="round green" :title="startLabel" :disabled="disabled" @click.stop="$emit('start')">▶</button>
      <button class="round red" title="Stop (mark Done)" :disabled="disabled || (task.status === 'Done' && !running)"
              @click.stop="$emit('stop')">■</button>
    </span>`,
  computed: {
    running() { return u.isRunning(this.task); },
    startLabel() {
      if (this.task.status === 'Done') return 'Reopen and start';
      return this.task.entries.length ? 'Resume' : 'Start';
    },
  },
};

/** A dialog box over the page. Closes on Escape or a click outside. */
export const Modal = {
  props: ['title', 'wide'],
  emits: ['close'],
  template: `
    <div class="modal-backdrop" @mousedown.self="$emit('close')" @keydown.esc="$emit('close')">
      <div class="modal" :class="{ wide }">
        <h3>{{ title }}</h3>
        <slot></slot>
      </div>
    </div>`,
};

/** "⋯" button that opens a small menu. Items: [{ label, action, danger }] */
export const DropMenu = {
  props: ['items'],
  data: () => ({ open: false }),
  template: `
    <span class="dropmenu" @click.stop>
      <button class="icon-button" title="More" @click="open = !open">⋯</button>
      <div v-if="open" class="dropmenu-list">
        <button v-for="item in items" :key="item.label" :class="{ danger: item.danger }"
                @click="open = false; item.action()">{{ item.label }}</button>
      </div>
    </span>`,
  mounted() {
    this.close = () => { this.open = false; };
    document.addEventListener('click', this.close);
  },
  unmounted() {
    document.removeEventListener('click', this.close);
  },
};

/** Shown when an organization has no folder yet, or its folder can't be found. */
export const StorageNotice = {
  props: ['org'],
  emits: ['choose'],
  template: `
    <div class="notice">
      <strong>⚠️ {{ missing ? 'Storage folder not found' : 'No storage folder' }}</strong>
      <p v-if="missing">Can't find {{ org.folderPath }}. Locate it to keep working. Until then “{{ org.name }}” is read-only.</p>
      <p v-else>Choose a folder to store “{{ org.name }}”. Projects and tasks can't be added until a folder is chosen.</p>
      <button class="primary" @click="$emit('choose')">{{ missing ? 'Locate Folder…' : 'Choose Folder…' }}</button>
    </div>`,
  computed: {
    missing() { return this.org.storage === 'missing'; },
  },
};

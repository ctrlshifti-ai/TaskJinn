// The tray popup (macOS and Windows): tasks in progress with their timers, and New Task.
// Everything else happens in the main window.

import { api, emit, on } from './api.js';
import * as store from './store.js';
import * as u from './util.js';
import { TimerButtons } from './components.js';

const OngoingCard = {
  components: { TimerButtons },
  props: ['item', 'now'],
  template: `
    <div class="ongoing" :class="{ running }" @click="$emit('open')" title="Open in the main window">
      <div class="ongoing-top">
        <span class="dot"></span>
        <span class="muted">{{ item.task.key }} · {{ item.project.name }}</span>
        <span class="spacer"></span>
        <b class="state">{{ running ? 'RUNNING' : 'PAUSED' }}</b>
      </div>
      <div class="ongoing-title">{{ item.task.title }}</div>
      <div class="ongoing-bottom">
        <div>
          <div class="ongoing-time">{{ u.formatDuration(u.sessionTime(item.task, now) ?? u.elapsed(item.task, now)) }}</div>
          <div class="muted small">{{ running ? 'this session · ' + u.formatDuration(u.elapsed(item.task, now)) + ' total' : 'total time' }}</div>
        </div>
        <TimerButtons :task="item.task" large
                      @start="store.start(item.org.id, item.task.id)"
                      @pause="store.pause(item.org.id, item.task.id)"
                      @stop="store.stop(item.org.id, item.task.id)" />
      </div>
    </div>`,
  emits: ['open'],
  computed: {
    u: () => u,
    store: () => store,
    running() { return u.isRunning(this.item.task); },
  },
};

const Popup = {
  components: { OngoingCard },
  data: () => ({ state: store.state }),
  template: `
    <div class="popup-box">
      <header class="popup-header">
        <b>In Progress</b>
        <span class="spacer"></span>
        <span v-if="ongoing.length" class="muted small">{{ running }} running · {{ ongoing.length - running }} paused</span>
      </header>
      <div v-if="!ongoing.length" class="popup-empty">
        <div class="placeholder-icon">⌛</div>
        <p class="muted">No task in progress</p>
      </div>
      <div v-else class="popup-list">
        <OngoingCard v-for="item in ongoing" :key="item.task.id" :item="item" :now="state.now" @open="openTask(item)" />
      </div>
      <button class="primary wide" @click="newTask">＋ New Task</button>
      <footer class="popup-footer">
        <button class="link-button" @click="api.showMain()">Open TaskJinn</button>
        <span class="spacer"></span>
        <button class="link-button" @click="api.quit()">Quit</button>
      </footer>
    </div>`,
  computed: {
    api: () => api,
    ongoing() { return store.ongoingTasks(); },
    running() { return this.ongoing.filter((item) => u.isRunning(item.task)).length; },
  },
  async mounted() {
    await store.init();
    on('popup-shown', () => store.reloadAll());
    // Keep the window exactly as tall as its content.
    new ResizeObserver(() => api.resizePopup(document.body.scrollHeight)).observe(document.body);
  },
  methods: {
    openTask(item) {
      emit('open-task', { orgId: item.org.id, projectId: item.project.id, taskId: item.task.id });
      api.showMain();
    },
    newTask() {
      emit('new-task');
      api.showMain();
    },
  },
};

Vue.createApp(Popup).mount('#app');

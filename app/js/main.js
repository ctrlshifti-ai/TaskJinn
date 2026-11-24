// The main window: Organizations | Projects | Board (or one task's page).

import { api, on } from './api.js';
import * as store from './store.js';
import * as u from './util.js';
import { Board } from './board.js';
import { TaskPage } from './taskpage.js';
import { DropMenu, Modal, StorageNotice } from './components.js';

const App = {
  components: { Board, TaskPage, DropMenu, Modal, StorageNotice },
  data: () => ({
    state: store.state,
    orgId: null,
    projectId: null,
    taskId: null,
    editor: null,    // add/rename dialog: { kind, targetId, orgId, projectId, name, key }
    question: null,  // yes/no dialog: { title, message, button, answer(bool) }
  }),
  template: `
    <div class="layout" v-if="state.loaded">
      <!-- Organizations -->
      <nav class="column-orgs">
        <h4>Organizations</h4>
        <div v-for="org in state.orgs" :key="org.id" class="nav-row" :class="{ selected: org.id === orgId }"
             @click="selectOrg(org.id)">
          <span class="nav-icon">{{ org.storage === 'ready' ? '🏢' : '⚠️' }}</span>
          <span class="nav-text">
            <span>{{ org.name }}</span>
            <small :class="{ warn: org.storage !== 'ready' }">{{ orgSubtitle(org) }}</small>
          </span>
          <DropMenu :items="orgMenu(org)" />
        </div>
        <p v-if="!state.orgs.length" class="muted small">No organizations yet.</p>
        <div class="nav-footer">
          <button class="link-button" @click="openEditor('org')">＋ New Organization</button>
          <button class="link-button" @click="openExisting">📂 Open Existing…</button>
        </div>
      </nav>

      <!-- Projects -->
      <nav class="column-projects">
        <template v-if="org">
          <h4>Projects in {{ org.name }}</h4>
          <StorageNotice v-if="org.storage !== 'ready'" :org="org" @choose="pickFolder(org)" />
          <div v-for="p in org.projects" :key="p.id" class="nav-row" :class="{ selected: p.id === projectId }"
               @click="selectProject(p.id)">
            <span class="nav-icon">📁</span>
            <span class="nav-text">
              <span>{{ p.name }}</span>
              <small>{{ p.key }} · {{ u.plural(p.tasks.length, 'task') }}</small>
            </span>
            <DropMenu v-if="org.storage === 'ready'" :items="projectMenu(p)" />
          </div>
          <p v-if="org.storage === 'ready' && !org.projects.length" class="muted small">No projects yet.</p>
          <div class="nav-footer">
            <button class="link-button" :disabled="org.storage !== 'ready'" @click="openEditor('project')">＋ New Project</button>
          </div>
        </template>
        <p v-else class="muted small">Select an organization.</p>
      </nav>

      <!-- Board or task page -->
      <main class="content">
        <TaskPage v-if="task" :key="task.id" :org="org" :project="project" :task="task" :now="state.now"
                  @back="taskId = null" @delete="askDeleteTask(task)" />
        <Board v-else-if="project" :org="org" :project="project" :now="state.now"
               @open="taskId = $event" @new-task="openEditor('task')" />
        <div v-else class="placeholder">
          <div class="placeholder-icon">⌛</div>
          <p>Select a project to see its board.</p>
        </div>
      </main>
    </div>

    <!-- Add / rename dialog -->
    <Modal v-if="editor" :title="editorTitle" @close="editor = null">
      <form @submit.prevent="saveEditor">
        <template v-if="editor.kind === 'task' && !editor.targetId">
          <label class="field">Organization
            <select v-model="editor.orgId" @change="editor.projectId = readyProjects(editor.orgId)[0]?.id ?? null">
              <option v-for="o in readyOrgs" :key="o.id" :value="o.id">{{ o.name }}</option>
            </select>
          </label>
          <label class="field">Project
            <select v-model="editor.projectId">
              <option v-for="p in readyProjects(editor.orgId)" :key="p.id" :value="p.id">{{ p.name }} ({{ p.key }})</option>
            </select>
          </label>
        </template>
        <label class="field">{{ editor.kind === 'task' ? 'Title' : 'Name' }}
          <input v-model="editor.name" ref="nameInput" required>
        </label>
        <label v-if="editor.kind === 'project'" class="field">Key (used in task numbers, e.g. WEB-12)
          <input v-model="editor.key" placeholder="Leave empty to make one from the name"
                 @input="editor.key = u.cleanKey(editor.key)">
        </label>
        <div class="modal-buttons">
          <button type="button" @click="editor = null">Cancel</button>
          <button type="submit" class="primary" :disabled="!editor.name.trim() || (editor.kind === 'task' && !editor.projectId)">
            {{ editor.targetId ? 'Save' : 'Add' }}</button>
        </div>
      </form>
    </Modal>

    <!-- Yes / no dialog -->
    <Modal v-if="question" :title="question.title" @close="answer(false)">
      <p>{{ question.message }}</p>
      <div class="modal-buttons">
        <button @click="answer(false)">Cancel</button>
        <button class="primary danger-bg" @click="answer(true)">{{ question.button }}</button>
      </div>
    </Modal>

    <!-- Errors -->
    <Modal v-if="state.error" title="Something went wrong" @close="state.error = null">
      <p>{{ state.error }}</p>
      <div class="modal-buttons"><button class="primary" @click="state.error = null">OK</button></div>
    </Modal>`,

  computed: {
    u: () => u,
    org() { return store.findOrg(this.orgId); },
    project() { return this.org && store.findProject(this.orgId, this.projectId); },
    task() { return this.project && store.findTask(this.orgId, this.projectId, this.taskId); },
    readyOrgs() { return this.state.orgs.filter((o) => o.storage === 'ready'); },
    editorTitle() {
      const noun = { org: 'Organization', project: 'Project', task: 'Task' }[this.editor.kind];
      return `${this.editor.targetId ? 'Edit' : 'New'} ${noun}`;
    },
  },

  watch: {
    // After every reload: tell the tray, and drop selections that no longer exist.
    'state.orgs'() {
      store.syncTray();
      if (this.orgId && !this.org) this.orgId = this.state.orgs[0]?.id ?? null;
      if (this.projectId && !this.project) this.projectId = null;
      if (this.taskId && !this.task) this.taskId = null;
    },
  },

  async mounted() {
    store.setAskUser((title, message, button) => this.ask(title, message, button));
    await store.init();
    this.orgId = this.state.orgs[0]?.id ?? null;
    store.syncTray();

    // From the tray popup / tray menu.
    on('open-task', ({ orgId, projectId, taskId }) => {
      this.orgId = orgId;
      this.projectId = projectId;
      this.taskId = taskId;
    });
    on('new-task', () => this.openEditor('task'));
    on('tray-action', (id) => store.handleTrayAction(typeof id === 'string' ? id : id.id));

    // Ctrl/Cmd + N: new task.
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n' && this.project) {
        event.preventDefault();
        this.openEditor('task');
      }
    });
  },

  methods: {
    selectOrg(id) {
      this.orgId = id;
      this.projectId = null;
      this.taskId = null;
    },
    selectProject(id) {
      this.projectId = id;
      this.taskId = null;
    },
    readyProjects(orgId) {
      return store.findOrg(orgId)?.projects ?? [];
    },
    orgSubtitle(org) {
      if (org.storage === 'noFolder') return 'No storage folder';
      if (org.storage === 'missing') return 'Folder not found';
      return u.plural(org.projects.length, 'project');
    },

    // ----- Menus -----
    orgMenu(org) {
      const folderLabel = { noFolder: 'Choose Folder…', missing: 'Locate Folder…', ready: 'Change Folder…' }[org.storage];
      const items = [
        { label: 'Rename…', action: () => this.openEditor('org', org) },
        { label: folderLabel, action: () => this.pickFolder(org) },
      ];
      if (org.storage === 'ready') items.push({ label: 'Show Folder', action: () => api.revealFolder(org.folderPath) });
      items.push({ label: 'Remove from App…', danger: true, action: () => this.askRemoveOrg(org) });
      return items;
    },
    projectMenu(project) {
      return [
        { label: 'Edit…', action: () => this.openEditor('project', project) },
        { label: 'Delete…', danger: true, action: () => this.askDeleteProject(project) },
      ];
    },

    // ----- Add / rename dialog -----
    openEditor(kind, target = null) {
      if (kind === 'task' && !target) {
        // New task: default to the selected project, or the first one available.
        const orgId = this.org?.storage === 'ready' ? this.orgId : this.readyOrgs[0]?.id;
        if (!orgId) {
          this.state.error = 'Create an organization with a storage folder and a project first.';
          return;
        }
        const projectId = this.project && orgId === this.orgId ? this.projectId : this.readyProjects(orgId)[0]?.id;
        this.editor = { kind, targetId: null, orgId, projectId: projectId ?? null, name: '', key: '' };
      } else {
        this.editor = { kind, targetId: target?.id ?? null, orgId: this.orgId, projectId: this.projectId,
                        name: target?.name ?? '', key: target?.key ?? '' };
      }
      this.$nextTick(() => this.$refs.nameInput?.focus());
    },

    async saveEditor() {
      const e = this.editor;
      const name = e.name.trim();
      this.editor = null;
      if (e.kind === 'org') {
        if (e.targetId) return store.renameOrganization(e.targetId, name);
        const id = await store.addOrganization(name);
        this.selectOrg(id);
        this.pickFolder(store.findOrg(id));   // ask for the storage folder straight away
      } else if (e.kind === 'project') {
        if (e.targetId) return store.updateProject(this.orgId, e.targetId, name, e.key);
        store.addProject(this.orgId, name, e.key);
      } else {
        const id = await store.addTask(e.orgId, e.projectId, name);
        if (id) {
          this.orgId = e.orgId;
          this.projectId = e.projectId;
          this.taskId = id;   // open the new task's page
        }
      }
    },

    // ----- Folders -----
    async pickFolder(org) {
      const titles = {
        noFolder: `Choose a folder to store “${org.name}”`,
        missing: `Find the folder that contains “${org.name}” (it has a taskjinn.sqlite file)`,
        ready: `Choose a new folder for “${org.name}” (its data will be moved there)`,
      };
      const folder = await api.pickFolder(titles[org.storage]);
      if (!folder) return;
      if (org.storage === 'noFolder') await store.attachFolder(org.id, folder);
      if (org.storage === 'missing') await store.locateFolder(org.id, folder);
      if (org.storage === 'ready') await store.changeFolder(org.id, folder);
    },
    async openExisting() {
      const folder = await api.pickFolder('Choose an organization folder (it contains taskjinn.sqlite)');
      if (folder) await store.openExistingOrganization(folder);
    },

    // ----- Yes / no questions -----
    ask(title, message, button) {
      return new Promise((resolve) => { this.question = { title, message, button, resolve }; });
    },
    answer(yes) {
      this.question?.resolve(yes);
      this.question = null;
    },
    async askRemoveOrg(org) {
      const message = org.folderPath
        ? 'Its folder and data stay on disk. You can add it back with “Open Existing…”.'
        : 'It has no storage folder, so nothing of it is kept.';
      if (await this.ask(`Remove “${org.name}” from the app?`, message, 'Remove')) store.removeOrganization(org.id);
    },
    async askDeleteProject(project) {
      const message = `This deletes its ${u.plural(project.tasks.length, 'task')} with their time, comments and images. It can't be undone.`;
      if (await this.ask(`Delete “${project.name}”?`, message, 'Delete')) store.deleteProject(this.orgId, project.id);
    },
    async askDeleteTask(task) {
      const message = 'This deletes its description, comments, images, subtasks, history and time. It can\'t be undone.';
      if (await this.ask(`Delete ${task.key} “${task.title}”?`, message, 'Delete')) {
        await store.deleteTask(this.orgId, task.id);
        this.taskId = null;
      }
    },
  },
};

Vue.createApp(App).mount('#app');

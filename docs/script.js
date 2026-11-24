// ---------- Screenshot slideshow (moves on by itself every few seconds) ----------

const SCREENSHOTS = [
  { file: '1_Tasks_Dashboard.jpg', title: 'Tasks Dashboard',
    text: 'See every task of a project on one board: To Do, In Progress, In Review and Done. Drag a card to change its status, and start its timer right from the card.' },
  { file: '2_Task_Details.jpg', title: 'Task Details',
    text: 'Each task has a rich-text description, subtasks, comments, a full status history and a log of every work session, plus type, priority, labels, due date and estimate.' },
  { file: '3_Ongoing_tasks_Quick_menubar_access.jpg', title: 'Ongoing Tasks, Quick Menu Bar Access',
    text: 'Your tasks in progress are always one click away in the menu bar. Pause, resume or stop them, and see how long you have been working.' },
  { file: '4_Configure_timesheets_invoices.jpg', title: 'Configure Timesheets & Invoices',
    text: 'Enter your details, your client, your hourly rate, tax and signature once. Choose weekly, bi-weekly or monthly pay periods.' },
  { file: '5_Generate_Timesheets.jpg', title: 'Generate Timesheets',
    text: 'Turn your tracked time into a signed timesheet for any pay period, with the hours for every day, ready to send to your client.' },
  { file: '6_Generate_Invoices.jpg', title: 'Generate Invoices',
    text: 'Create a professional invoice from the same hours: rate, tax and totals worked out for you, with automatic invoice numbers.' },
];

const slidesBox = document.getElementById('slides');
const dotsBox = document.getElementById('dots');
let current = 0;
let autoplay;

SCREENSHOTS.forEach((shot, i) => {
  const slide = document.createElement('figure');
  slide.className = 'slide';
  slide.innerHTML = `
    <h3>${shot.title}</h3>
    <img src="screenshots/${shot.file}" alt="${shot.title}">
    <p>${shot.text}</p>`;
  slidesBox.appendChild(slide);

  const dot = document.createElement('button');
  dot.setAttribute('aria-label', `Show ${shot.title}`);
  dot.addEventListener('click', () => { showSlide(i); restartAutoplay(); });
  dotsBox.appendChild(dot);
});

function showSlide(index) {
  current = (index + SCREENSHOTS.length) % SCREENSHOTS.length;
  slidesBox.querySelectorAll('.slide').forEach((s, i) => s.classList.toggle('active', i === current));
  dotsBox.querySelectorAll('button').forEach((d, i) => d.classList.toggle('active', i === current));
}

function restartAutoplay() {
  clearInterval(autoplay);
  autoplay = setInterval(() => showSlide(current + 1), 3000);
}

slidesBox.addEventListener('mouseenter', () => clearInterval(autoplay));   // pause while looking
slidesBox.addEventListener('mouseleave', restartAutoplay);

showSlide(0);
restartAutoplay();

// ---------- A small interactive copy of the TaskJinn board: drag cards and run timers ----------

const COLUMNS = [
  { status: 'To Do', className: 'c-todo' },
  { status: 'In Progress', className: 'c-progress' },
  { status: 'In Review', className: 'c-review' },
  { status: 'Done', className: 'c-done' },
];

const tasks = [
  { key: 'WEB-1', title: 'Set up project repository', status: 'Done', seconds: 52 * 3600, startedAt: null },
  { key: 'WEB-2', title: 'Design login screen', status: 'In Review', seconds: 31 * 3600 + 1200, startedAt: null },
  { key: 'WEB-3', title: 'Fix crash on empty form', status: 'In Progress', seconds: 5400, startedAt: Date.now() },
  { key: 'WEB-4', title: 'Add dark mode', status: 'In Progress', seconds: 7200, startedAt: null },
  { key: 'WEB-5', title: 'Write API documentation', status: 'To Do', seconds: 0, startedAt: null },
  { key: 'WEB-6', title: 'Update dependencies', status: 'To Do', seconds: 0, startedAt: null },
];

const board = document.getElementById('board');

function elapsed(task) {
  const running = task.startedAt ? (Date.now() - task.startedAt) / 1000 : 0;
  return Math.floor(task.seconds + running);
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = String(seconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function toggleTimer(task) {
  if (task.startedAt) {
    task.seconds = elapsed(task);
    task.startedAt = null;
  } else {
    task.startedAt = Date.now();
    if (task.status === 'To Do' || task.status === 'Done') task.status = 'In Progress';
  }
  render();
}

function render() {
  board.innerHTML = '';
  for (const column of COLUMNS) {
    const list = tasks.filter((t) => t.status === column.status);
    const section = document.createElement('div');
    section.className = 'column';
    section.innerHTML = `<h4 class="${column.className}">${column.status} <span class="count">${list.length}</span></h4>`;

    section.addEventListener('dragover', (event) => { event.preventDefault(); section.classList.add('over'); });
    section.addEventListener('dragleave', () => section.classList.remove('over'));
    section.addEventListener('drop', (event) => {
      event.preventDefault();
      const task = tasks.find((t) => t.key === event.dataTransfer.getData('text/plain'));
      if (task) task.status = column.status;
      render();
    });

    for (const task of list) {
      const card = document.createElement('div');
      card.className = 'card' + (task.startedAt ? ' running' : '');
      card.draggable = true;
      card.innerHTML = `
        <div class="key">${task.key}</div>
        <div class="title">${task.title}</div>
        <div class="bottom">
          <span class="time" data-key="${task.key}">${formatTime(elapsed(task))}</span>
          <button class="round ${task.startedAt ? 'pause' : 'play'}" title="${task.startedAt ? 'Pause' : 'Start'}">${task.startedAt ? '❚❚' : '▶'}</button>
        </div>`;
      card.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', task.key));
      card.querySelector('button').addEventListener('click', () => toggleTimer(task));
      section.appendChild(card);
    }
    board.appendChild(section);
  }
}

// Update running timers every second.
setInterval(() => {
  for (const task of tasks) {
    if (!task.startedAt) continue;
    const label = board.querySelector(`.time[data-key="${task.key}"]`);
    if (label) label.textContent = formatTime(elapsed(task));
  }
}, 1000);

render();

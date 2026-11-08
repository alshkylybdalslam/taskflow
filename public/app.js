'use strict';

/* ============================================================
   TaskFlow — frontend SPA
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const STATUS_LABEL = { todo: 'To do', in_progress: 'In progress', done: 'Done' };
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' };

const ICONS = {
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
};

const state = {
  user: null,
  projects: [],
  tasks: [],
  route: { name: 'dashboard', id: null },
  filters: { project: 'all', status: 'all', priority: 'all', due: 'all', label: 'all', q: '' },
  color: '#4f46e5',
  boardView: (() => {
    try { return localStorage.getItem('tf-view') === 'board'; } catch { return false; }
  })(),
  labelsByProject: {}, // { projectId: [labels] } — lazily fetched, invalidated on change
  allLabels: null,     // flat list for the tasks-page filter
  labelFormOpen: false,
  labelColor: '#6366f1',
};

const LABEL_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

/* ---------------- label data ---------------- */

async function getProjectLabels(pid) {
  if (!state.labelsByProject[pid]) {
    const { labels } = await api(`/projects/${pid}/labels`);
    state.labelsByProject[pid] = labels;
  }
  return state.labelsByProject[pid];
}

function invalidateLabels(pid) {
  if (pid) delete state.labelsByProject[pid];
  state.allLabels = null;
}

async function getAllLabels() {
  if (!state.allLabels) {
    const { labels } = await api('/labels');
    state.allLabels = labels;
  }
  return state.allLabels;
}

function labelChipHTML(l) {
  return `<span class="label-chip" style="--lc:${esc(l.color)}">${esc(l.name)}</span>`;
}

/* ---------------- API helper ---------------- */

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('Network error — is the server running?');
  }

  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }

  if (res.status === 401 && state.user) {
    showAuth('Your session expired — please sign in again.');
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error((data && data.error) || 'Request failed');
  return data;
}

/* ---------------- toasts ---------------- */

function toast(message, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 260);
  }, 2800);
}

/* ---------------- dates ---------------- */

function todayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayDiff(due) {
  const [y, m, d] = due.split('-').map(Number);
  const [ty, tm, td] = todayStr().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

function fmtDue(due) {
  if (!due) return { text: '', cls: '' };
  const diff = dayDiff(due);
  if (diff < 0) return { text: `${-diff}d overdue`, cls: 'late' };
  if (diff === 0) return { text: 'Due today', cls: 'today' };
  if (diff === 1) return { text: 'Tomorrow', cls: '' };
  const date = new Date(`${due}T00:00:00`);
  return { text: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), cls: '' };
}

function relTime(sqlDateTime) {
  const t = Date.parse(`${sqlDateTime.replace(' ', 'T')}Z`);
  if (Number.isNaN(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/* ============================================================
   AUTH
   ============================================================ */

function showAuth(message) {
  state.user = null;
  $('#app').hidden = true;
  $('#authScreen').hidden = false;
  const err = $('#loginForm [data-error]');
  if (message) {
    err.textContent = message;
    err.hidden = false;
  } else {
    err.hidden = true;
  }
}

async function enterApp(user) {
  state.user = user;
  $('#authScreen').hidden = true;
  $('#app').hidden = false;
  $('#userName').textContent = user.name;
  $('#userEmail').textContent = user.email;
  $('#userAvatar').textContent = user.name
    .split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  $('#navAdmin').hidden = user.role !== 'admin';

  if (!location.hash || location.hash === '#') {
    history.replaceState(null, '', '#/dashboard');
  }
  await loadProjects();
  await renderRoute();
}

function authError(form, message) {
  const el = form.querySelector('[data-error]');
  el.textContent = message;
  el.hidden = false;
}

$('#tabLogin').addEventListener('click', () => {
  $('#tabLogin').classList.add('active');
  $('#tabRegister').classList.remove('active');
  $('#loginForm').hidden = false;
  $('#registerForm').hidden = true;
  $('#loginForm [data-error]').hidden = true;
});

$('#tabRegister').addEventListener('click', () => {
  $('#tabRegister').classList.add('active');
  $('#tabLogin').classList.remove('active');
  $('#registerForm').hidden = false;
  $('#loginForm').hidden = true;
  $('#registerForm [data-error]').hidden = true;
});

$('#fillDemo').addEventListener('click', () => {
  $('#loginForm').elements.email.value = 'demo@taskflow.dev';
  $('#loginForm').elements.password.value = 'demo1234';
  $('#loginForm').elements.password.focus();
});

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const { user } = await api('/auth/login', {
      method: 'POST',
      body: { email: form.elements.email.value, password: form.elements.password.value },
    });
    form.reset();
    toast(`Welcome back, ${user.name.split(' ')[0]}!`);
    await enterApp(user);
  } catch (err) {
    authError(form, err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const { user } = await api('/auth/register', {
      method: 'POST',
      body: {
        name: form.elements.name.value,
        email: form.elements.email.value,
        password: form.elements.password.value,
      },
    });
    form.reset();
    toast(`Account created — welcome, ${user.name.split(' ')[0]}!`);
    await enterApp(user);
  } catch (err) {
    authError(form, err.message);
  } finally {
    btn.disabled = false;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
  history.replaceState(null, '', '#');
  showAuth();
  toast('Signed out. See you soon!');
});

/* ============================================================
   ROUTER & DATA
   ============================================================ */

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'projects' && parts[1]) return { name: 'project', id: Number(parts[1]) };
  if (parts[0] === 'projects') return { name: 'projects', id: null };
  if (parts[0] === 'tasks') return { name: 'tasks', id: null };
  if (parts[0] === 'admin') return { name: 'admin', id: null };
  return { name: 'dashboard', id: null };
}

function navKey(route) {
  return route.name === 'project' ? 'projects' : route.name;
}

async function loadProjects() {
  const { projects } = await api('/projects');
  state.projects = projects;
  renderSideProjects();
}

function renderSideProjects() {
  const box = $('#sideProjects');
  if (!state.projects.length) {
    box.innerHTML = '<p class="side-empty">No projects yet — hit + to create one.</p>';
    return;
  }
  box.innerHTML = state.projects
    .map(
      (p) => `
      <a class="side-project" href="#/projects/${p.id}" data-project-link="${p.id}">
        <span class="dot" style="background:${p.color}"></span>
        <span>${esc(p.name)}</span>
        <span class="count">${p.total_tasks}</span>
      </a>`
    )
    .join('');
}

function skeleton() {
  return '<div class="grid grid-3"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>';
}

function setTitle(title, subtitle = '') {
  $('#pageTitle').textContent = title;
  $('#pageSubtitle').textContent = subtitle;
}

async function renderRoute({ silent = false } = {}) {
  if (!state.user) return;
  state.route = parseRoute();

  const key = navKey(state.route);
  $$('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  $$('.side-project').forEach((a) =>
    a.classList.toggle('active', Number(a.dataset.projectLink) === state.route.id)
  );
  $('#sidebar').classList.remove('open');

  const view = $('#view');
  if (!silent) view.innerHTML = skeleton();

  try {
    if (state.route.name === 'dashboard') {
      setTitle('Dashboard', new Date().toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      }));
      await renderDashboard();
    } else if (state.route.name === 'tasks') {
      setTitle('My Tasks', 'Everything on your plate — open work first, deadlines first');
      await renderTasks();
    } else if (state.route.name === 'projects') {
      setTitle('Projects', `${state.projects.length} project${state.projects.length === 1 ? '' : 's'}`);
      renderProjects();
    } else if (state.route.name === 'admin') {
      setTitle('Admin', 'Platform overview & user management');
      await renderAdmin();
    } else {
      await renderProjectDetail();
    }
  } catch (err) {
    view.innerHTML = `<div class="empty"><span class="emoji">⚠️</span><h3>Could not load this page</h3><p>${esc(err.message)}</p></div>`;
  }
}

window.addEventListener('hashchange', () => renderRoute());

/* ============================================================
   DASHBOARD
   ============================================================ */

function donutHTML(summary) {
  const C = 2 * Math.PI * 60;
  const total = summary.total || 0;
  const parts = [
    ['done', summary.done, '#10b981'],
    ['in_progress', summary.in_progress, '#f59e0b'],
    ['todo', summary.todo, '#818cf8'],
  ];

  let used = 0;
  const segments = parts
    .filter(([, v]) => v > 0)
    .map(([key, v, color]) => {
      const len = (v / total) * C;
      const seg = `<circle class="seg" cx="75" cy="75" r="60" stroke="${color}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-used).toFixed(2)}"/>`;
      used += len;
      return seg;
    })
    .join('');

  const legend = parts
    .map(
      ([key, v, color]) => `
        <div class="legend-row">
          <i style="background:${color}"></i>
          ${STATUS_LABEL[key]}
          <span class="n">${v}</span>
        </div>`
    )
    .join('');

  return `
    <div class="donut-wrap">
      <div class="donut">
        <svg width="150" height="150" viewBox="0 0 150 150">
          <circle class="track" cx="75" cy="75" r="60"/>
          ${segments}
        </svg>
        <div class="donut-center">
          <strong>${summary.completion_rate}%</strong>
          <span>complete</span>
        </div>
      </div>
      <div class="legend">${legend}</div>
    </div>`;
}

function weeklyBarsHTML(weekly) {
  const max = Math.max(1, ...weekly.map((w) => w.count));
  const bars = weekly
    .map((w) => {
      const h = w.count === 0 ? 5 : Math.max(12, Math.round((w.count / max) * 100));
      const label = new Date(`${w.day}T00:00:00`)
        .toLocaleDateString(undefined, { weekday: 'short' })
        .slice(0, 3);
      return `
        <div class="bar-col">
          <div class="bar ${w.count ? '' : 'zero'}" style="height:${h}%">
            ${w.count ? `<span class="tip">${w.count}</span>` : ''}
          </div>
          <small>${label}</small>
        </div>`;
    })
    .join('');
  return `<div class="bars">${bars}</div>`;
}

async function renderDashboard() {
  const data = await api('/dashboard');
  const s = data.summary;
  const view = $('#view');

  if (!state.projects.length) {
    view.innerHTML = `
      <div class="empty">
        <span class="emoji">🚀</span>
        <h3>Welcome to TaskFlow!</h3>
        <p>Create your first project, add tasks to it, and this dashboard will come alive with stats.</p>
        <button class="btn btn-primary" data-action="new-project">+ Create your first project</button>
      </div>`;
    return;
  }

  const projectProgress = data.projects
    .map((p) => {
      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      return `
        <div style="margin-bottom:.8rem">
          <div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:.32rem">
            <span style="font-weight:600"><span style="color:${p.color}">●</span> ${esc(p.name)}</span>
            <span style="color:var(--muted)">${p.done}/${p.total} done</span>
          </div>
          <div class="progress" style="--pc:${p.color}"><i style="width:${pct}%"></i></div>
        </div>`;
    })
    .join('');

  const upcoming = data.upcoming.length
    ? data.upcoming
        .map((t) => {
          const due = fmtDue(t.due_date);
          return `
            <div class="mini-item" data-action="go-tasks" title="Open My Tasks">
              <span class="check-ghost"></span>
              <span class="title">${esc(t.title)}</span>
              <span class="meta ${due.cls}">${due.text}</span>
            </div>`;
        })
        .join('')
    : '<p style="color:var(--muted);font-size:.9rem">Nothing due soon — enjoy the calm. ☕</p>';

  const recent = data.recentCompleted.length
    ? data.recentCompleted
        .map(
          (t) => `
            <div class="mini-item" data-action="go-tasks" title="Open My Tasks">
              <span class="check-ghost done"></span>
              <span class="title">${esc(t.title)}</span>
              <span class="meta">${relTime(t.completed_at)}</span>
            </div>`
        )
        .join('')
    : '<p style="color:var(--muted);font-size:.9rem">Complete a task and it will show up here.</p>';

  view.innerHTML = `
    <div class="grid grid-4 section-gap">
      <div class="stat-card">
        <div class="stat-icon blue"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M8 9h8M8 13h5"/></svg></div>
        <div class="stat-body"><strong>${s.total}</strong><span>Total tasks</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon amber"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
        <div class="stat-body"><strong>${s.in_progress}</strong><span>In progress</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon green"><svg viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg></div>
        <div class="stat-body"><strong>${s.done}</strong><span>Completed</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon red"><svg viewBox="0 0 24 24"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg></div>
        <div class="stat-body"><strong>${s.overdue}</strong><span>Overdue ${s.due_today ? `· ${s.due_today} today` : ''}</span></div>
      </div>
    </div>

    <div class="grid grid-2 section-gap">
      <section class="card">
        <h2>Status breakdown</h2>
        ${donutHTML(s)}
      </section>
      <section class="card">
        <h2>Completed this week <span class="sub">last 7 days</span></h2>
        ${weeklyBarsHTML(data.weekly)}
      </section>
    </div>

    <div class="grid grid-2">
      <section class="card">
        <h2>Project progress</h2>
        ${projectProgress || '<p style="color:var(--muted)">No projects yet.</p>'}
      </section>
      <div class="grid" style="gap:1.1rem">
        <section class="card">
          <h2>Upcoming deadlines</h2>
          <div class="mini-list">${upcoming}</div>
        </section>
        <section class="card">
          <h2>Recently completed</h2>
          <div class="mini-list">${recent}</div>
        </section>
      </div>
    </div>`;
}

/* ============================================================
   TASKS
   ============================================================ */

function taskRowHTML(t) {
  const due = fmtDue(t.due_date);
  const done = t.status === 'done';
  const labelChips = (t.labels || []).map(labelChipHTML).join('');
  return `
    <div class="task-row ${done ? 'done' : ''}" data-task="${t.id}">
      <button class="task-check ${done ? 'checked' : ''}" data-toggle="${t.id}" title="${done ? 'Mark as not done' : 'Mark as done'}">✓</button>
      <div class="task-main">
        <div class="task-title">${esc(t.title)}</div>
        <div class="task-sub">
          <span class="project-tag"><i style="background:${t.project_color}"></i>${esc(t.project_name)}</span>
          <span>·</span>
          <span class="prio-dot ${t.priority}"></span> ${PRIORITY_LABEL[t.priority]}
          ${labelChips}
          ${t.description ? `<span>· ${esc(t.description.slice(0, 60))}${t.description.length > 60 ? '…' : ''}</span>` : ''}
        </div>
      </div>
      ${due.text ? `<span class="task-due ${due.cls}">${due.text}</span>` : ''}
      <span class="badge badge-${t.status}">${STATUS_LABEL[t.status]}</span>
      <div class="task-actions">
        <button class="icon-btn" data-edit="${t.id}" title="Edit">${ICONS.edit}</button>
        <button class="icon-btn" data-del="${t.id}" title="Delete">${ICONS.trash}</button>
      </div>
    </div>`;
}

async function renderTasks() {
  const f = state.filters;
  const allLabels = await getAllLabels();
  const query = new URLSearchParams();
  if (f.project !== 'all') query.set('project_id', f.project);
  if (f.status !== 'all') query.set('status', f.status);
  if (f.priority !== 'all') query.set('priority', f.priority);
  if (f.due !== 'all') query.set('due', f.due);
  if (f.label !== 'all') query.set('label_id', f.label);
  if (f.q) query.set('q', f.q);

  const { tasks } = await api(`/tasks${query.toString() ? `?${query}` : ''}`);
  state.tasks = tasks;

  const projectOptions = state.projects
    .map((p) => `<option value="${p.id}" ${f.project === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`)
    .join('');

  const labelOptions = allLabels
    .map(
      (l) =>
        `<option value="${l.id}" ${f.label === String(l.id) ? 'selected' : ''}>${esc(l.project_name)} · ${esc(l.name)}</option>`
    )
    .join('');

  const active =
    f.project !== 'all' || f.status !== 'all' || f.priority !== 'all' ||
    f.due !== 'all' || f.label !== 'all' || f.q;

  $('#view').innerHTML = `
    <div class="filters">
      <select data-filter="project">
        <option value="all">All projects</option>
        ${projectOptions}
      </select>
      <select data-filter="status">
        <option value="all">Any status</option>
        <option value="todo" ${f.status === 'todo' ? 'selected' : ''}>To do</option>
        <option value="in_progress" ${f.status === 'in_progress' ? 'selected' : ''}>In progress</option>
        <option value="done" ${f.status === 'done' ? 'selected' : ''}>Done</option>
      </select>
      <select data-filter="priority">
        <option value="all">Any priority</option>
        <option value="high" ${f.priority === 'high' ? 'selected' : ''}>High</option>
        <option value="medium" ${f.priority === 'medium' ? 'selected' : ''}>Medium</option>
        <option value="low" ${f.priority === 'low' ? 'selected' : ''}>Low</option>
      </select>
      <select data-filter="due">
        <option value="all">Any deadline</option>
        <option value="overdue" ${f.due === 'overdue' ? 'selected' : ''}>⚠ Overdue</option>
        <option value="today" ${f.due === 'today' ? 'selected' : ''}>Due today</option>
        <option value="none" ${f.due === 'none' ? 'selected' : ''}>No due date</option>
      </select>
      <select data-filter="label">
        <option value="all">Any label</option>
        ${labelOptions}
      </select>
      ${active ? '<button class="btn" data-action="clear-filters">Clear</button>' : ''}
      <span class="spacer"></span>
      <span class="count">${tasks.length} task${tasks.length === 1 ? '' : 's'}</span>
    </div>

    ${
      tasks.length
        ? `<div class="task-list">${tasks.map(taskRowHTML).join('')}</div>`
        : state.projects.length
          ? `<div class="empty">
               <span class="emoji">🎯</span>
               <h3>${active ? 'No tasks match those filters' : 'All clear!'}</h3>
               <p>${active ? 'Try different filters, or clear them to see everything.' : 'You have no tasks yet. Add one and get moving.'}</p>
               <button class="btn btn-primary" data-action="${active ? 'clear-filters' : 'new-task'}">
                 ${active ? 'Clear filters' : '+ Add your first task'}
               </button>
             </div>`
          : `<div class="empty">
               <span class="emoji">📁</span>
               <h3>Create a project first</h3>
               <p>Tasks live inside projects. Create one, then start adding work.</p>
               <button class="btn btn-primary" data-action="new-project">+ New project</button>
             </div>`
    }`;
}

/* ============================================================
   PROJECTS
   ============================================================ */

function renderProjects() {
  const cards = state.projects
    .map((p) => {
      const pct = p.total_tasks ? Math.round((p.done_tasks / p.total_tasks) * 100) : 0;
      return `
        <article class="project-card" data-open-project="${p.id}" style="--pc:${p.color}">
          <h3><span class="dot"></span>${esc(p.name)}</h3>
          <p class="desc">${esc(p.description || 'No description yet.')}</p>
          <div class="project-meta">
            <span class="meta-pill">${p.total_tasks} task${p.total_tasks === 1 ? '' : 's'}</span>
            <span class="meta-pill">${p.done_tasks} done</span>
            <span class="meta-pill">${p.in_progress_tasks} in progress</span>
            ${p.overdue_tasks ? `<span class="meta-pill warn">${p.overdue_tasks} overdue</span>` : ''}
          </div>
          <div class="progress-row">
            <div class="progress"><i style="width:${pct}%"></i></div>
            <span class="pct">${pct}%</span>
          </div>
        </article>`;
    })
    .join('');

  $('#view').innerHTML = `
    <div class="project-grid">
      ${cards}
      <button class="new-project-card" data-action="new-project">
        <span class="plus">+</span>
        <strong>New project</strong>
        <span style="font-size:.82rem">Group related tasks together</span>
      </button>
    </div>`;
}

/* ============================================================
   KANBAN BOARD (project detail — list/board toggle, HTML5 DnD)
   ============================================================ */

const BOARD_COLS = [
  ['todo', 'To do'],
  ['in_progress', 'In progress'],
  ['done', 'Done'],
];

function kcardHTML(t) {
  const due = fmtDue(t.due_date);
  return `
    <article class="kcard ${t.status === 'done' ? 'done' : ''}" draggable="true" data-task="${t.id}">
      <div class="kcard-title">${esc(t.title)}</div>
      <div class="kcard-meta">
        <span class="prio-dot ${t.priority}" title="${PRIORITY_LABEL[t.priority]} priority"></span>
        ${due.text ? `<span class="task-due ${due.cls}">${due.text}</span>` : ''}
      </div>
      ${t.labels && t.labels.length
        ? `<div class="kcard-labels">${t.labels.map(labelChipHTML).join('')}</div>`
        : ''}
    </article>`;
}

function boardHTML(tasks) {
  return `
    <div class="board">
      ${BOARD_COLS.map(([key, name]) => {
        const items = tasks.filter((t) => t.status === key);
        return `
          <section class="board-col">
            <header>
              <span class="col-dot ${key}"></span>
              ${name}
              <span class="count">${items.length}</span>
            </header>
            <div class="col-body" data-drop="${key}">
              ${items.map(kcardHTML).join('') || '<p class="col-empty">Drag a task here</p>'}
            </div>
          </section>`;
      }).join('')}
    </div>`;
}

async function renderProjectDetail() {
  const id = state.route.id;
  const [{ project }, { tasks }, { labels }] = await Promise.all([
    api(`/projects/${id}`),
    api(`/tasks?project_id=${id}`),
    api(`/projects/${id}/labels`),
  ]);

  if (!project) {
    $('#view').innerHTML = `
      <div class="empty">
        <span class="emoji">🔍</span>
        <h3>Project not found</h3>
        <p>It may have been deleted.</p>
        <a class="btn btn-primary" href="#/projects">Back to projects</a>
      </div>`;
    return;
  }

  state.tasks = tasks;
  state.labelsByProject[id] = labels;
  setTitle(project.name, project.description || 'Project detail');

  const pct = project.total_tasks
    ? Math.round((project.done_tasks / project.total_tasks) * 100)
    : 0;

  const viewToggle = tasks.length
    ? `<div class="view-toggle" role="group" aria-label="View mode">
         <button type="button" data-action="view-list" class="${state.boardView ? '' : 'active'}" title="List view">☰ List</button>
         <button type="button" data-action="view-board" class="${state.boardView ? 'active' : ''}" title="Board view">▦ Board</button>
       </div>`
    : '';

  const labelStrip = `
    <div class="label-strip">
      ${labels
        .map(
          (l) => `
        <span class="label-chip has-x" style="--lc:${esc(l.color)}">
          ${esc(l.name)}
          <button type="button" data-del-label="${l.id}" title="Delete label">×</button>
        </span>`
        )
        .join('')}
      <button type="button" class="label-add-btn" data-action="toggle-label-form">
        ${state.labelFormOpen ? '× Cancel' : '+ Label'}
      </button>
      ${
        state.labelFormOpen
          ? `<form class="label-form" id="labelForm" data-project="${id}">
               <input name="name" placeholder="Label name…" maxlength="30" autocomplete="off" required>
               <div class="label-colors">
                 ${LABEL_COLORS.map(
                   (c) =>
                     `<button type="button" class="lswatch ${state.labelColor === c ? 'active' : ''}" data-lcolor="${c}" style="--c:${c}" title="${c}"></button>`
                 ).join('')}
               </div>
               <button class="btn btn-primary btn-sm" type="submit">Add label</button>
             </form>`
          : ''
      }
    </div>`;

  let content;
  if (tasks.length && state.boardView) {
    content = boardHTML(tasks);
  } else if (tasks.length) {
    content = `<div class="task-list">${tasks.map(taskRowHTML).join('')}</div>`;
  } else {
    content = `<div class="empty">
                 <span class="emoji">✨</span>
                 <h3>No tasks in this project</h3>
                 <p>Add the first task and start making progress.</p>
                 <button class="btn btn-primary" data-action="new-task" data-project="${project.id}">+ Add a task</button>
               </div>`;
  }

  $('#view').innerHTML = `
    <a class="back-link" href="#/projects">← All projects</a>
    <div class="detail-head">
      <div class="grow">
        <h2><span class="dot" style="background:${project.color}"></span>${esc(project.name)}</h2>
        <p class="desc">${esc(project.description || '')}</p>
        <div class="detail-stats">
          <span class="meta-pill">${project.total_tasks} tasks</span>
          <span class="meta-pill">${project.done_tasks} done</span>
          <span class="meta-pill">${project.in_progress_tasks} in progress</span>
          ${project.overdue_tasks ? `<span class="meta-pill warn">${project.overdue_tasks} overdue</span>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
        <div style="width:130px">
          <div class="progress-row">
            <div class="progress" style="--pc:${project.color}"><i style="width:${pct}%"></i></div>
            <span class="pct">${pct}%</span>
          </div>
        </div>
        ${viewToggle}
        <button class="btn" data-action="edit-project" data-id="${project.id}">Edit</button>
        <button class="btn btn-primary" data-action="new-task" data-project="${project.id}">+ Task</button>
      </div>
    </div>
    ${labelStrip}
    ${content}`;
}

/* ============================================================
   TASK MODAL
   ============================================================ */

function openModal(id) {
  $(`#${id}`).hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  $(`#${id}`).hidden = true;
  document.body.style.overflow = '';
}

/** Render the label checkboxes inside the task modal for a given project. */
async function renderLabelPicker(projectId, task = null) {
  const box = $('#taskLabelPicker');
  if (!box) return;
  let labels = [];
  try {
    labels = projectId ? await getProjectLabels(projectId) : [];
  } catch {
    labels = [];
  }

  if (!labels.length) {
    box.innerHTML =
      '<p class="label-empty">No labels in this project yet — add some from the project page.</p>';
    return;
  }
  const chosen = new Set((task && task.labels ? task.labels : []).map((l) => l.id));
  box.innerHTML = labels
    .map(
      (l) => `
      <label class="lpick">
        <input type="checkbox" name="label_ids" value="${l.id}" ${chosen.has(l.id) ? 'checked' : ''}>
        ${labelChipHTML(l)}
      </label>`
    )
    .join('');
}

async function openTaskModal(task = null, defaultProjectId = null) {
  if (!state.projects.length) {
    toast('Create a project first — tasks live inside projects.', 'err');
    openProjectModal();
    return;
  }

  const form = $('#taskForm');
  form.reset();
  form.querySelector('[data-error]').hidden = true;

  form.elements.project_id.innerHTML = state.projects
    .map((p) => `<option value="${p.id}">${esc(p.name)}</option>`)
    .join('');

  $('#taskModalTitle').textContent = task ? 'Edit task' : 'New task';
  form.elements.id.value = task ? task.id : '';
  form.elements.title.value = task ? task.title : '';
  form.elements.description.value = task ? task.description || '' : '';
  form.elements.project_id.value = String(
    task ? task.project_id : defaultProjectId || state.projects[0].id
  );
  form.elements.status.value = task ? task.status : 'todo';
  form.elements.priority.value = task ? task.priority : 'medium';
  form.elements.due_date.value = task && task.due_date ? task.due_date : '';

  await renderLabelPicker(Number(form.elements.project_id.value), task);

  $('#deleteTaskBtn').hidden = !task;

  openModal('taskModal');
  form.elements.title.focus();
}

/* Re-render the label picker when the project changes. */
$('#taskForm').addEventListener('change', (e) => {
  if (e.target.name === 'project_id') {
    renderLabelPicker(Number(e.target.value), null);
  }
});

$('#taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const errBox = form.querySelector('[data-error]');
  const btn = form.querySelector('[type=submit]');
  const id = form.elements.id.value;

  const payload = {
    title: form.elements.title.value,
    description: form.elements.description.value,
    project_id: Number(form.elements.project_id.value),
    status: form.elements.status.value,
    priority: form.elements.priority.value,
    due_date: form.elements.due_date.value || null,
    label_ids: $$('#taskLabelPicker input:checked').map((i) => Number(i.value)),
  };

  btn.disabled = true;
  try {
    if (id) await api(`/tasks/${id}`, { method: 'PUT', body: payload });
    else await api('/tasks', { method: 'POST', body: payload });
    closeModal('taskModal');
    toast(id ? 'Task updated' : 'Task created');
    await refresh();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('#deleteTaskBtn').addEventListener('click', async () => {
  const id = $('#taskForm').elements.id.value;
  if (!id) return;
  if (!confirm('Delete this task?')) return;
  try {
    await api(`/tasks/${id}`, { method: 'DELETE' });
    closeModal('taskModal');
    toast('Task deleted');
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
});

/* ============================================================
   PROJECT MODAL
   ============================================================ */

function openProjectModal(project = null) {
  const form = $('#projectForm');
  form.reset();
  form.querySelector('[data-error]').hidden = true;

  $('#projectModalTitle').textContent = project ? 'Edit project' : 'New project';
  form.elements.id.value = project ? project.id : '';
  form.elements.name.value = project ? project.name : '';
  form.elements.description.value = project ? project.description || '' : '';

  state.color = project ? project.color : '#4f46e5';
  $$('#colorPicker .swatch').forEach((s) =>
    s.classList.toggle('active', s.dataset.color === state.color)
  );

  $('#deleteProjectBtn').hidden = !project;
  openModal('projectModal');
  form.elements.name.focus();
}

$('#colorPicker').addEventListener('click', (e) => {
  const swatch = e.target.closest('.swatch');
  if (!swatch) return;
  state.color = swatch.dataset.color;
  $$('#colorPicker .swatch').forEach((s) => s.classList.toggle('active', s === swatch));
});

$('#projectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const errBox = form.querySelector('[data-error]');
  const btn = form.querySelector('[type=submit]');
  const id = form.elements.id.value;

  const payload = {
    name: form.elements.name.value,
    description: form.elements.description.value,
    color: state.color,
  };

  btn.disabled = true;
  try {
    if (id) await api(`/projects/${id}`, { method: 'PUT', body: payload });
    else await api('/projects', { method: 'POST', body: payload });
    closeModal('projectModal');
    toast(id ? 'Project updated' : 'Project created');
    await refresh();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.hidden = false;
  } finally {
    btn.disabled = false;
  }
});

$('#deleteProjectBtn').addEventListener('click', async () => {
  const id = $('#projectForm').elements.id.value;
  if (!id) return;
  if (!confirm('Delete this project and ALL of its tasks? This cannot be undone.')) return;
  try {
    await api(`/projects/${id}`, { method: 'DELETE' });
    invalidateLabels(Number(id));
    closeModal('projectModal');
    toast('Project deleted');
    if (state.route.name === 'project' && state.route.id === Number(id)) {
      location.hash = '#/projects';
    }
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
});

/* ============================================================
   INTERACTIONS
   ============================================================ */

async function refresh() {
  await loadProjects();
  await renderRoute({ silent: true });
}

async function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === Number(id));
  if (!task) return;
  const next = task.status === 'done' ? 'todo' : 'done';
  try {
    await api(`/tasks/${id}`, { method: 'PUT', body: { status: next } });
    if (next === 'done') toast('Nice — one less thing to worry about!');
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await api(`/tasks/${id}`, { method: 'DELETE' });
    toast('Task deleted');
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
}

$('#view').addEventListener('click', async (e) => {
  const toggle = e.target.closest('[data-toggle]');
  if (toggle) { e.stopPropagation(); toggleTask(toggle.dataset.toggle); return; }

  const edit = e.target.closest('[data-edit]');
  if (edit) {
    e.stopPropagation();
    const task = state.tasks.find((t) => t.id === Number(edit.dataset.edit));
    if (task) openTaskModal(task);
    return;
  }

  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); deleteTask(del.dataset.del); return; }

  const delLabel = e.target.closest('[data-del-label]');
  if (delLabel) {
    e.stopPropagation();
    if (!confirm('Delete this label? It will be removed from every task in the project.')) return;
    const pid = state.route.id;
    try {
      await api(`/labels/${delLabel.dataset.delLabel}`, { method: 'DELETE' });
      invalidateLabels(pid);
      toast('Label deleted');
      await refresh();
    } catch (err) {
      toast(err.message, 'err');
    }
    return;
  }

  const lcolor = e.target.closest('[data-lcolor]');
  if (lcolor) {
    e.stopPropagation();
    state.labelColor = lcolor.dataset.lcolor;
    $$('#labelForm .lswatch').forEach((s) => s.classList.toggle('active', s === lcolor));
    return;
  }

  const openProject = e.target.closest('[data-open-project]');
  if (openProject) { location.hash = `#/projects/${openProject.dataset.openProject}`; return; }

  const action = e.target.closest('[data-action]');
  if (action) {
    const kind = action.dataset.action;
    if (kind === 'new-project') openProjectModal();
    else if (kind === 'new-task') openTaskModal(null, action.dataset.project || null);
    else if (kind === 'edit-project') {
      const p = state.projects.find((x) => x.id === Number(action.dataset.id));
      if (p) openProjectModal(p);
    } else if (kind === 'view-list' || kind === 'view-board') {
      state.boardView = kind === 'view-board';
      try { localStorage.setItem('tf-view', state.boardView ? 'board' : 'list'); } catch { /* ignore */ }
      renderRoute({ silent: true });
    } else if (kind === 'toggle-label-form') {
      state.labelFormOpen = !state.labelFormOpen;
      state.labelColor = '#6366f1';
      renderRoute({ silent: true });
      if (state.labelFormOpen) setTimeout(() => $('#labelForm input')?.focus(), 0);
    } else if (kind === 'clear-filters') {
      state.filters = { project: 'all', status: 'all', priority: 'all', due: 'all', label: 'all', q: '' };
      $('#globalSearch').value = '';
      renderRoute({ silent: true });
    } else if (kind === 'go-tasks') {
      location.hash = '#/tasks';
    }
    return;
  }

  const row = e.target.closest('.task-row, .kcard');
  if (row) {
    const task = state.tasks.find((t) => t.id === Number(row.dataset.task));
    if (task) openTaskModal(task);
  }
});

/* Inline "add label" form on the project page */
$('#view').addEventListener('submit', async (e) => {
  const form = e.target.closest('#labelForm');
  if (!form) return;
  e.preventDefault();
  const pid = Number(form.dataset.project);
  try {
    await api(`/projects/${pid}/labels`, {
      method: 'POST',
      body: { name: form.elements.name.value, color: state.labelColor },
    });
    invalidateLabels(pid);
    state.labelFormOpen = false;
    state.labelColor = '#6366f1';
    toast('Label created');
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
});

/* ============================================================
   KANBAN DRAG & DROP (native HTML5 — no libraries)
   ============================================================ */

let dragTaskId = null;

$('#view').addEventListener('dragstart', (e) => {
  const card = e.target.closest('.kcard');
  if (!card) return;
  dragTaskId = Number(card.dataset.task);
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', card.dataset.task);
});

$('#view').addEventListener('dragend', (e) => {
  const card = e.target.closest('.kcard');
  if (card) card.classList.remove('dragging');
  $$('.col-body').forEach((b) => b.classList.remove('drop-hot'));
  dragTaskId = null;
});

$('#view').addEventListener('dragover', (e) => {
  const body = e.target.closest('[data-drop]');
  if (!body || dragTaskId === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  $$('.col-body').forEach((b) => b.classList.toggle('drop-hot', b === body));
});

$('#view').addEventListener('drop', async (e) => {
  const body = e.target.closest('[data-drop]');
  if (!body) return;
  e.preventDefault();
  const id = Number(e.dataTransfer.getData('text/plain')) || dragTaskId;
  const status = body.dataset.drop;
  $$('.col-body').forEach((b) => b.classList.remove('drop-hot'));
  dragTaskId = null;

  const task = state.tasks.find((t) => t.id === id);
  if (!task || task.status === status) return;
  try {
    await api(`/tasks/${id}`, { method: 'PUT', body: { status } });
    toast(status === 'done' ? 'Nice — one less thing to worry about!' : `Moved to ${STATUS_LABEL[status]}`);
    await refresh();
  } catch (err) {
    toast(err.message, 'err');
  }
});

$('#view').addEventListener('change', (e) => {
  const filter = e.target.closest('[data-filter]');
  if (!filter) return;
  state.filters[filter.dataset.filter] = filter.value;
  renderRoute({ silent: true });
});

$('#newTaskBtn').addEventListener('click', () =>
  openTaskModal(null, state.route.name === 'project' ? state.route.id : null)
);

$('#sideNewProject').addEventListener('click', () => openProjectModal());

$('#menuBtn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

/* Light / dark theme toggle — preference persists across visits */
const themeBtn = $('#themeBtn');
function syncThemeLabel() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}
syncThemeLabel();
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('tf-theme', next); } catch { /* storage blocked */ }
  syncThemeLabel();
});

/* Global search → jumps to the tasks view */
let searchTimer;
$('#globalSearch').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const value = e.target.value;
  searchTimer = setTimeout(() => {
    state.filters.q = value.trim();
    if (state.route.name !== 'tasks') location.hash = '#/tasks';
    else renderRoute({ silent: true });
  }, 250);
});

/* Modal plumbing */
$$('[data-close]').forEach((btn) =>
  btn.addEventListener('click', () => closeModal(btn.dataset.close))
);
$$('.modal-backdrop').forEach((backdrop) =>
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal(backdrop.id);
  })
);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  $$('.modal-backdrop:not([hidden])').forEach((m) => closeModal(m.id));
});

/* ============================================================
   ADMIN (admins only — the nav link is hidden for everyone else)
   ============================================================ */

async function renderAdmin() {
  const view = $('#view');
  if (state.user.role !== 'admin') {
    view.innerHTML =
      '<div class="empty"><span class="emoji">🔒</span><h3>Admins only</h3><p>Ask an admin to grant you access.</p></div>';
    return;
  }

  const [{ stats }, { users }] = await Promise.all([
    api('/admin/stats'),
    api('/admin/users'),
  ]);

  const cards = [
    ['Users', stats.users, 'blue', '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 19c.7-3.2 3.3-5 6.5-5s5.8 1.8 6.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.5c2.6.2 4.6 1.7 5.2 4.5"/>'],
    ['Admins', stats.admins, 'green', '<path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6z"/><path d="M9.2 11.8l2 2 3.6-3.6"/>'],
    ['Projects', stats.projects, 'amber', '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'],
    ['Tasks', stats.tasks, 'red', '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M8 9h8M8 13h5"/>'],
  ]
    .map(
      ([label, n, color, path]) => `
      <div class="stat-card">
        <div class="stat-icon ${color}"><svg viewBox="0 0 24 24">${path}</svg></div>
        <div class="stat-body"><strong>${n}</strong><span>${label}</span></div>
      </div>`
    )
    .join('');

  const rows = users
    .map((u) => {
      const isSelf = u.id === state.user.id;
      return `
      <tr data-user-id="${u.id}" data-user-name="${esc(u.name)}" data-user-role="${u.role}">
        <td>
          <strong>${esc(u.name)}</strong>
          ${isSelf ? '<span class="badge badge-self">you</span>' : ''}
          <br><small class="muted">${esc(u.email)}</small>
        </td>
        <td><span class="badge ${u.role === 'admin' ? 'badge-admin' : ''}">${u.role}</span></td>
        <td>${u.projects} project${u.projects === 1 ? '' : 's'} · ${u.tasks} task${u.tasks === 1 ? '' : 's'}</td>
        <td><small>${relTime(u.created_at)}</small></td>
        <td class="admin-actions">
          <button type="button" class="btn btn-sm" data-admin-action="role" ${isSelf ? 'disabled title="You cannot change your own role"' : ''}>
            ${u.role === 'admin' ? 'Demote' : 'Promote'}
          </button>
          <button type="button" class="btn btn-sm btn-danger" data-admin-action="delete" ${isSelf ? 'disabled title="You cannot delete yourself"' : ''}>
            Delete
          </button>
        </td>
      </tr>`;
    })
    .join('');

  view.innerHTML = `
    <div class="grid grid-4 section-gap">${cards}</div>

    <section class="card section-gap">
      <h2>All users (${users.length})</h2>
      <p class="muted admin-note">Promote teammates to admin, or remove accounts entirely — projects, tasks and tokens cascade away with them.</p>
      <div class="table-wrap">
        <table class="admin-table">
          <thead>
            <tr><th>User</th><th>Role</th><th>Activity</th><th>Joined</th><th></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;

  $$('[data-admin-action]', view).forEach((btn) =>
    btn.addEventListener('click', onAdminAction)
  );
}

async function onAdminAction(e) {
  const btn = e.currentTarget;
  const row = btn.closest('tr');
  const id = Number(row.dataset.userId);
  const name = row.dataset.userName;
  const isAdmin = row.dataset.userRole === 'admin';

  try {
    if (btn.dataset.adminAction === 'role') {
      const next = isAdmin ? 'user' : 'admin';
      if (!confirm(`${next === 'admin' ? 'Promote' : 'Demote'} ${name} to "${next}"?`)) return;
      await api(`/admin/users/${id}`, { method: 'PUT', body: { role: next } });
      toast(`${name} is now ${next === 'admin' ? 'an admin' : 'a regular user'}.`);
    } else {
      if (!confirm(`Delete ${name}? All of their projects, tasks and tokens will be removed.`)) return;
      await api(`/admin/users/${id}`, { method: 'DELETE' });
      toast(`${name} was deleted.`);
    }
    await renderRoute({ silent: true });
  } catch (err) {
    toast(err.message, 'err');
  }
}

/* ============================================================
   BOOT
   ============================================================ */

(async function boot() {
  try {
    const { user } = await api('/auth/me');
    await enterApp(user);
  } catch {
    showAuth();
  }
})();

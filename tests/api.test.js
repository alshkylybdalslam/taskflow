'use strict';

/**
 * API integration tests — no test framework needed, Node's built-in
 * test runner (node:test) plus global fetch does the job.
 * Run with:  npm test
 */

process.env.DB_PATH = ':memory:';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../server/index');

let server;
let base;
let cookieA; // main test user session
let cookieB; // second user, for ownership tests
let projectId;
let taskId;

function extractCookie(res) {
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
}

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data, cookie: extractCookie(res) };
}

before(async () => {
  server = await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  console.error('[after] begin');
  // fetch() keeps connections alive; destroy them so the process can exit.
  if (server.closeAllConnections) {
    console.error('[after] closing connections');
    server.closeAllConnections();
  }
  await new Promise((resolve) => server.close(resolve));
  console.error('[after] server closed');
});

process.on('exit', () => {
  process.stderr.write('[exit] process leaving\n');
});

/* ---------------- auth ---------------- */

test('unknown API endpoints return JSON 404', async () => {
  const { status, data } = await req('/api/does-not-exist');
  assert.equal(status, 404);
  assert.ok(data.error);
});

test('protected routes reject unauthenticated requests', async () => {
  const { status } = await req('/api/projects');
  assert.equal(status, 401);
});

test('registration validates input', async () => {
  const bad = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'X', email: 'not-an-email', password: 'short' },
  });
  assert.equal(bad.status, 400);
});

test('registers a new user and starts a session', async () => {
  const { status, data, cookie } = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Ada Lovelace', email: 'ada@example.com', password: 'supersecret1' },
  });
  assert.equal(status, 201);
  assert.equal(data.user.email, 'ada@example.com');
  assert.ok(cookie, 'expected a session cookie');
  cookieA = cookie;
});

test('duplicate registration is rejected with 409', async () => {
  const { status } = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Ada Again', email: 'ADA@example.com', password: 'supersecret1' },
  });
  assert.equal(status, 409);
});

test('GET /api/auth/me returns the signed-in user', async () => {
  const { status, data } = await req('/api/auth/me', { cookie: cookieA });
  assert.equal(status, 200);
  assert.equal(data.user.name, 'Ada Lovelace');
});

test('login fails with the wrong password', async () => {
  const { status } = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'ada@example.com', password: 'wrong-password' },
  });
  assert.equal(status, 401);
});

test('login succeeds with the right password', async () => {
  const { status, data, cookie } = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'ada@example.com', password: 'supersecret1' },
  });
  assert.equal(status, 200);
  assert.equal(data.user.name, 'Ada Lovelace');
  cookieA = cookie || cookieA;
});

/* ---------------- projects ---------------- */

test('creates a project', async () => {
  const { status, data } = await req('/api/projects', {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'Portfolio Site', description: 'Ship the new portfolio', color: '#10b981' },
  });
  assert.equal(status, 201);
  assert.equal(data.project.name, 'Portfolio Site');
  assert.equal(data.project.total_tasks, 0);
  projectId = data.project.id;
});

test('project name is required', async () => {
  const { status } = await req('/api/projects', {
    method: 'POST',
    cookie: cookieA,
    body: { name: '' },
  });
  assert.equal(status, 400);
});

/* ---------------- tasks ---------------- */

test('creates a task in the project', async () => {
  const { status, data } = await req('/api/tasks', {
    method: 'POST',
    cookie: cookieA,
    body: {
      project_id: projectId,
      title: 'Design the landing page',
      status: 'in_progress',
      priority: 'high',
      due_date: '2099-12-31',
    },
  });
  assert.equal(status, 201);
  assert.equal(data.task.status, 'in_progress');
  assert.equal(data.task.project_name, 'Portfolio Site');
  taskId = data.task.id;
});

test('rejects an invalid status value', async () => {
  const { status } = await req('/api/tasks', {
    method: 'POST',
    cookie: cookieA,
    body: { project_id: projectId, title: 'Nope', status: 'banana' },
  });
  assert.equal(status, 400);
});

test('filtering by status returns only matching tasks', async () => {
  await req('/api/tasks', {
    method: 'POST',
    cookie: cookieA,
    body: { project_id: projectId, title: 'Write the README', status: 'todo' },
  });

  const done = await req('/api/tasks?status=done', { cookie: cookieA });
  assert.equal(done.data.tasks.length, 0);

  const inProgress = await req('/api/tasks?status=in_progress', { cookie: cookieA });
  assert.equal(inProgress.data.tasks.length, 1);
  assert.equal(inProgress.data.tasks[0].title, 'Design the landing page');
});

test('search matches task titles', async () => {
  const { data } = await req('/api/tasks?q=README', { cookie: cookieA });
  assert.equal(data.tasks.length, 1);
  assert.equal(data.tasks[0].title, 'Write the README');
});

test('completing a task stamps completed_at', async () => {
  const { data } = await req(`/api/tasks/${taskId}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { status: 'done' },
  });
  assert.equal(data.task.status, 'done');
  assert.ok(data.task.completed_at, 'completed_at should be set');

  const reopened = await req(`/api/tasks/${taskId}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { status: 'todo' },
  });
  assert.equal(reopened.data.task.completed_at, null);
});

/* ---------------- ownership ---------------- */

test("another user cannot see or modify someone else's project", async () => {
  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Mallory', email: 'mallory@example.com', password: 'anothersecret' },
  });
  cookieB = reg.cookie;

  const read = await req(`/api/projects/${projectId}`, { cookie: cookieB });
  assert.equal(read.status, 404);

  const write = await req('/api/tasks', {
    method: 'POST',
    cookie: cookieB,
    body: { project_id: projectId, title: 'Sneaky task' },
  });
  assert.equal(write.status, 400);
});

/* ---------------- dashboard ---------------- */

test('dashboard returns summary, projects and a 7-day series', async () => {
  const { status, data } = await req('/api/dashboard', { cookie: cookieA });
  assert.equal(status, 200);
  assert.ok(data.summary.total >= 2);
  assert.equal(data.weekly.length, 7);
  assert.ok(data.projects.some((p) => p.id === projectId));
});

/* ---------------- logout & cascade ---------------- */

test('deleting a project cascades to its tasks', async () => {
  const del = await req(`/api/projects/${projectId}`, { method: 'DELETE', cookie: cookieA });
  assert.equal(del.status, 200);
  const tasks = await req('/api/tasks', { cookie: cookieA });
  assert.ok(!tasks.data.tasks.some((t) => t.project_id === projectId));
});

test('logout destroys the session', async () => {
  const out = await req('/api/auth/logout', { method: 'POST', cookie: cookieA });
  assert.equal(out.status, 200);
  const me = await req('/api/auth/me', { cookie: cookieA });
  assert.equal(me.status, 401);
});

'use strict';

/**
 * API integration tests — no test framework needed, Node's built-in
 * test runner (node:test) plus global fetch does the job.
 * Run with:  npm test
 */

process.env.DB_PATH = ':memory:';
// Low auth rate limit so the brute-force test can trip it quickly.
process.env.AUTH_RATE_LIMIT_MAX = '10';

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

/** Local YYYY-MM-DD, offset by n days (for due-date tests). */
function day(n = 0) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

async function req(path, { method = 'GET', body, cookie, auth } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { status: res.status, data, cookie: extractCookie(res), headers: res.headers };
}

before(async () => {
  server = await start(0);
  // The listener must never hold the event loop open: the test runner only
  // runs finalisers (and prints the summary) once the loop can drain.
  server.unref();
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Safety net for early-exit paths: release sockets and the listener so the
  // runner can finalise (the cleanup test normally closes the server already).
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
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

/* ---------------- due dates & deadline filters ---------------- */

test('rejects a malformed due date', async () => {
  const { status, data } = await req('/api/tasks', {
    method: 'POST',
    cookie: cookieA,
    body: { project_id: projectId, title: 'Bad date', due_date: 'tomorrow' },
  });
  assert.equal(status, 400);
  assert.match(data.error, /due date/i);
});

test('deadline filters isolate overdue, due-today and undated tasks', async () => {
  const mk = (title, due_date, status = 'todo') =>
    req('/api/tasks', {
      method: 'POST',
      cookie: cookieA,
      body: { project_id: projectId, title, due_date, status },
    });

  const late = await mk('Chase the overdue invoice', day(-2));
  const today = await mk('Fix the signup bug', day(0), 'in_progress');
  const undated = await mk('Someday-ish idea', null);
  assert.equal(late.status, 201);
  assert.equal(today.status, 201);
  assert.equal(undated.status, 201);

  const titles = (list) => list.data.tasks.map((t) => t.title);

  const overdue = await req('/api/tasks?due=overdue', { cookie: cookieA });
  assert.ok(titles(overdue).includes('Chase the overdue invoice'));
  assert.ok(!titles(overdue).includes('Someday-ish idea'));

  const dueToday = await req('/api/tasks?due=today', { cookie: cookieA });
  assert.deepEqual(titles(dueToday), ['Fix the signup bug']);

  const noDate = await req('/api/tasks?due=none', { cookie: cookieA });
  assert.ok(titles(noDate).includes('Someday-ish idea'));
  assert.ok(!titles(noDate).includes('Chase the overdue invoice'));

  // Completing the late task clears it from the overdue list.
  await req(`/api/tasks/${late.data.task.id}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { status: 'done' },
  });
  const overdueAfter = await req('/api/tasks?due=overdue', { cookie: cookieA });
  assert.ok(!titles(overdueAfter).includes('Chase the overdue invoice'));
});

/* ---------------- labels ---------------- */

let labelId;
let labelId2;
let sandboxProjectId;

test('creates labels on a project (and rejects duplicates)', async () => {
  const created = await req(`/api/projects/${projectId}/labels`, {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'Research', color: '#0ea5e9' },
  });
  assert.equal(created.status, 201);
  labelId = created.data.label.id;

  const created2 = await req(`/api/projects/${projectId}/labels`, {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'Ship It', color: '#10b981' },
  });
  assert.equal(created2.status, 201);
  labelId2 = created2.data.label.id;

  const dupe = await req(`/api/projects/${projectId}/labels`, {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'research' }, // same name, different case
  });
  assert.equal(dupe.status, 409);

  const badColor = await req(`/api/projects/${projectId}/labels`, {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'Nope', color: 'red' },
  });
  assert.equal(badColor.status, 400);
});

test('attaches and detaches labels on a task', async () => {
  const attach = await req(`/api/tasks/${taskId}/labels`, {
    method: 'POST',
    cookie: cookieA,
    body: { label_id: labelId },
  });
  assert.equal(attach.status, 201);
  assert.ok(attach.data.labels.some((l) => l.id === labelId));

  // Task listings now carry their labels.
  const list = await req('/api/tasks?q=Design the landing page', { cookie: cookieA });
  assert.ok(list.data.tasks[0].labels.some((l) => l.name === 'Research'));

  // Setting label_ids on update replaces the assignment.
  const replace = await req(`/api/tasks/${taskId}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { label_ids: [labelId2] },
  });
  assert.equal(replace.status, 200);
  const names = replace.data.task.labels.map((l) => l.name);
  assert.deepEqual(names, ['Ship It']);

  const detach = await req(`/api/tasks/${taskId}/labels/${labelId2}`, {
    method: 'DELETE',
    cookie: cookieA,
  });
  assert.equal(detach.status, 200);
  const after = await req('/api/tasks?q=Design the landing page', { cookie: cookieA });
  assert.equal(after.data.tasks[0].labels.length, 0);
});

test('filters tasks by label', async () => {
  await req(`/api/tasks/${taskId}/labels`, {
    method: 'POST',
    cookie: cookieA,
    body: { label_id: labelId },
  });

  const filtered = await req(`/api/tasks?label_id=${labelId}`, { cookie: cookieA });
  assert.equal(filtered.data.tasks.length, 1);
  assert.equal(filtered.data.tasks[0].id, taskId);

  const wrongProject = await req(`/api/tasks/${taskId}/labels`, {
    method: 'POST',
    cookie: cookieA,
    body: { label_id: 999999 },
  });
  assert.equal(wrongProject.status, 404);
});

test("labels can't cross project boundaries and are invisible to other users", async () => {
  // Second project owned by the same user → its label must not attach here.
  const sandbox = await req('/api/projects', {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'Label Sandbox' },
  });
  sandboxProjectId = sandbox.data.project.id;
  const otherLabel = await req(`/api/projects/${sandboxProjectId}/labels`, {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'Elsewhere' },
  });

  const cross = await req(`/api/tasks/${taskId}/labels`, {
    method: 'POST',
    cookie: cookieA,
    body: { label_id: otherLabel.data.label.id },
  });
  assert.equal(cross.status, 400);

  // Another user can't list, create or delete my labels.
  const listB = await req(`/api/projects/${projectId}/labels`, { cookie: cookieB });
  assert.equal(listB.status, 404);
  const createB = await req(`/api/projects/${projectId}/labels`, {
    method: 'POST',
    cookie: cookieB,
    body: { name: 'Sneaky' },
  });
  assert.equal(createB.status, 404);
  const deleteB = await req(`/api/labels/${labelId}`, { method: 'DELETE', cookie: cookieB });
  assert.equal(deleteB.status, 404);

  // Clean up the sandbox project (cascades its labels).
  await req(`/api/projects/${sandboxProjectId}`, { method: 'DELETE', cookie: cookieA });
});

/* ---------------- API tokens ---------------- */

let apiSecret;
let apiTokenId;

test('creating an API token reveals the secret exactly once', async () => {
  const { status, data } = await req('/api/tokens', {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'CI bot' },
  });
  assert.equal(status, 201);
  assert.match(data.secret, /^tf_[0-9a-f]{40}$/);
  assert.equal(data.token.prefix, data.secret.slice(0, 9));
  assert.equal(data.token.last_used_at, null);
  apiSecret = data.secret;
  apiTokenId = data.token.id;
});

test('a bearer token authenticates API requests without a cookie', async () => {
  const me = await req('/api/auth/me', { auth: apiSecret });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, 'ada@example.com');

  const projects = await req('/api/projects', { auth: apiSecret });
  assert.equal(projects.status, 200);
});

test('listing tokens never leaks the secret; garbage tokens are rejected', async () => {
  const { data } = await req('/api/tokens', { cookie: cookieA });
  assert.equal(data.tokens.length, 1);
  assert.ok(!JSON.stringify(data.tokens).includes(apiSecret));

  const bogus = await req('/api/auth/me', { auth: 'tf_deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' });
  assert.equal(bogus.status, 401);
});

test('revoking a token revokes access immediately', async () => {
  const del = await req(`/api/tokens/${apiTokenId}`, { method: 'DELETE', cookie: cookieA });
  assert.equal(del.status, 200);
  const after = await req('/api/auth/me', { auth: apiSecret });
  assert.equal(after.status, 401);
  const again = await req(`/api/tokens/${apiTokenId}`, { method: 'DELETE', cookie: cookieA });
  assert.equal(again.status, 404);
});

/* ---------------- rate limiting ---------------- */

test('auth endpoints trip the brute-force rate limiter', async () => {
  let sawLimit = false;
  for (let i = 0; i < 15 && !sawLimit; i++) {
    const out = await req('/api/auth/login', {
      method: 'POST',
      body: { email: 'ada@example.com', password: 'definitely-not-the-password' },
    });
    if (out.status === 429) {
      sawLimit = true;
      assert.match(out.data.error, /too many/i);
    } else {
      assert.equal(out.status, 401); // plain bad-password failures until the limit trips
    }
  }
  assert.ok(sawLimit, 'expected the limiter to trip within 15 attempts');
});

/* ---------------- logout & cascade ---------------- */

test('deleting a project cascades to its tasks and labels', async () => {
  const del = await req(`/api/projects/${projectId}`, { method: 'DELETE', cookie: cookieA });
  assert.equal(del.status, 200);
  const tasks = await req('/api/tasks', { cookie: cookieA });
  assert.ok(!tasks.data.tasks.some((t) => t.project_id === projectId));
  const labels = await req('/api/labels', { cookie: cookieA });
  assert.ok(
    !labels.data.labels.some((l) => l.project_id === projectId),
    'labels should cascade with their project'
  );
});

test('logout destroys the session', async () => {
  const out = await req('/api/auth/logout', { method: 'POST', cookie: cookieA });
  assert.equal(out.status, 200);
  const me = await req('/api/auth/me', { cookie: cookieA });
  assert.equal(me.status, 401);
});

test('cleanup — server shutdown does not block exit', async () => {
  // Destroy idle keep-alive sockets first so close() resolves immediately
  // instead of waiting out the client's ~4s keep-alive timeout.
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(server.listening, false);
});

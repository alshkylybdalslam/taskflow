'use strict';

/**
 * API integration tests — no test framework needed, Node's built-in
 * test runner (node:test) plus global fetch does the job.
 * Run with:  npm test
 */

process.env.DB_PATH = ':memory:';
// Low auth rate limit so the brute-force test can trip it quickly (the
// budget is shared by every register/login call in this file).
process.env.AUTH_RATE_LIMIT_MAX = '12';
// Separate quota for admin account creation (POST /api/admin/users).
process.env.ADMIN_RATE_LIMIT_MAX = '10';

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

async function req(path, { method = 'GET', body, cookie, auth, headers: extra } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      ...(extra || {}),
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

  // bcrypt only uses the first 72 bytes — anything longer is rejected
  // instead of being silently truncated.
  const long = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Long Password', email: 'long@example.com', password: 'x'.repeat(73) },
  });
  assert.equal(long.status, 400);
  assert.match(long.data.error, /72 bytes/i);
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

test('a malformed session cookie is rejected with 401, not a 500', async () => {
  const broken = await req('/api/auth/me', {
    headers: { Cookie: 'taskflow_session=%E0%A4%A' },
  });
  assert.equal(broken.status, 401, 'bad percent-encoding must not crash the request');
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
  // Same 404 as a nonexistent label — label ids can't be probed across projects.
  assert.equal(cross.status, 404);
  assert.equal(cross.data.error, 'Label not found.');

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

/* ---------------- task write atomicity ---------------- */

test('invalid labels reject the whole update — fields stay untouched', async () => {
  const before = await req('/api/tasks', { cookie: cookieA });
  const originalTitle = before.data.tasks.find((t) => t.id === taskId).title;

  const put = await req(`/api/tasks/${taskId}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { title: 'Should not stick', label_ids: [999999] },
  });
  assert.equal(put.status, 400);

  const after = await req('/api/tasks', { cookie: cookieA });
  assert.equal(
    after.data.tasks.find((t) => t.id === taskId).title,
    originalTitle,
    'a failed label validation must not half-apply the update'
  );
});

test('invalid labels reject task creation — no orphan task is left behind', async () => {
  const post = await req('/api/tasks', {
    method: 'POST',
    cookie: cookieA,
    body: { project_id: projectId, title: 'Orphan candidate', label_ids: [999999] },
  });
  assert.equal(post.status, 400);

  const list = await req('/api/tasks?q=Orphan%20candidate', { cookie: cookieA });
  assert.equal(list.data.tasks.length, 0);
});

test('moving a task to another project clears its project-scoped labels', async () => {
  // Precondition: the task carries a label from its current project.
  const before = await req('/api/tasks', { cookie: cookieA });
  assert.ok(before.data.tasks.find((t) => t.id === taskId).labels.length > 0);

  const other = await req('/api/projects', {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'Atomicity sandbox' },
  });
  const otherId = other.data.project.id;

  const moved = await req(`/api/tasks/${taskId}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { project_id: otherId },
  });
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.data.task.labels, [], 'old-project labels must not follow the task');

  // Move it back so later tests see the original layout.
  const back = await req(`/api/tasks/${taskId}`, {
    method: 'PUT',
    cookie: cookieA,
    body: { project_id: projectId },
  });
  assert.equal(back.status, 200);
  await req(`/api/projects/${otherId}`, { method: 'DELETE', cookie: cookieA });
});

test('search treats % and _ literally instead of as LIKE wildcards', async () => {
  const one = await req('/api/tasks', {
    method: 'POST',
    cookie: cookieA,
    body: { project_id: projectId, title: '100% done review' },
  });
  const two = await req('/api/tasks', {
    method: 'POST',
    cookie: cookieA,
    body: { project_id: projectId, title: '100x done review' },
  });

  const hit = await req('/api/tasks?q=100%25', { cookie: cookieA });
  const titles = hit.data.tasks.map((t) => t.title);
  assert.ok(titles.includes('100% done review'));
  assert.ok(!titles.includes('100x done review'), '% must not act as a wildcard');

  await req(`/api/tasks/${one.data.task.id}`, { method: 'DELETE', cookie: cookieA });
  await req(`/api/tasks/${two.data.task.id}`, { method: 'DELETE', cookie: cookieA });
});

/* ---------------- comments & activity ---------------- */

test('comments start empty, validate, and are invisible to other users', async () => {
  const empty = await req(`/api/tasks/${taskId}/comments`, { cookie: cookieA });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data.comments, []);

  const other = await req(`/api/tasks/${taskId}/comments`, { cookie: cookieB });
  assert.equal(other.status, 404, "another user's task must not be readable");

  const blank = await req(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    cookie: cookieA,
    body: { body: '   ' },
  });
  assert.equal(blank.status, 400);

  const giant = await req(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    cookie: cookieA,
    body: { body: 'x'.repeat(2001) },
  });
  assert.equal(giant.status, 400);
  assert.match(giant.data.error, /2000/);
});

test('adds comments and lists them oldest first with their author', async () => {
  const first = await req(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    cookie: cookieA,
    body: { body: 'First thought.' },
  });
  assert.equal(first.status, 201);
  assert.equal(first.data.comment.author.name, 'Ada Lovelace');

  const second = await req(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    cookie: cookieA,
    body: { body: 'Second thought — with more detail.' },
  });
  assert.equal(second.status, 201);

  const list = await req(`/api/tasks/${taskId}/comments`, { cookie: cookieA });
  assert.deepEqual(
    list.data.comments.map((c) => c.body),
    ['First thought.', 'Second thought — with more detail.']
  );

  // Task responses carry the count for the badge in lists and on cards.
  const tasks = await req('/api/tasks?q=Design the landing page', { cookie: cookieA });
  assert.equal(tasks.data.tasks[0].comment_count, 2);
});

test('deleting a comment is owner-only and leaves an activity event', async () => {
  const list = await req(`/api/tasks/${taskId}/comments`, { cookie: cookieA });
  const target = list.data.comments[1];

  const byOther = await req(`/api/comments/${target.id}`, { method: 'DELETE', cookie: cookieB });
  assert.equal(byOther.status, 404);

  const del = await req(`/api/comments/${target.id}`, { method: 'DELETE', cookie: cookieA });
  assert.equal(del.status, 200);

  const after = await req(`/api/tasks/${taskId}/comments`, { cookie: cookieA });
  assert.equal(after.data.comments.length, 1);

  const feed = await req('/api/activity?limit=100', { cookie: cookieA });
  assert.ok(
    feed.data.activity.some((e) => e.action === 'comment.added'),
    'posting a comment must be logged'
  );
  assert.ok(
    feed.data.activity.some((e) => e.action === 'comment.deleted'),
    'deleting a comment must be logged'
  );
});

test('activity feed is per-user and filterable by project', async () => {
  const mine = await req('/api/activity?limit=100', { cookie: cookieA });
  assert.equal(mine.status, 200);
  assert.ok(mine.data.activity.some((e) => e.action === 'project.created'));
  assert.ok(mine.data.activity.some((e) => e.action === 'task.created'));

  // The other user's feed must not leak Ada's task titles.
  const theirs = await req('/api/activity?limit=100', { cookie: cookieB });
  assert.ok(!theirs.data.activity.some((e) => e.subject === 'Design the landing page'));

  const scoped = await req(`/api/activity?project_id=${projectId}&limit=100`, { cookie: cookieA });
  assert.ok(scoped.data.activity.length > 0);
  assert.ok(scoped.data.activity.every((e) => e.project_id === projectId));
});

test('an activity entry survives deletion of its task', async () => {
  const created = await req('/api/tasks', {
    method: 'POST',
    cookie: cookieA,
    body: { project_id: projectId, title: 'Short-lived audit subject' },
  });
  const id = created.data.task.id;

  await req(`/api/tasks/${id}`, { method: 'DELETE', cookie: cookieA });

  const feed = await req('/api/activity?limit=100', { cookie: cookieA });
  const event = feed.data.activity.find(
    (e) => e.action === 'task.deleted' && e.subject === 'Short-lived audit subject'
  );
  assert.ok(event, 'the deletion event must remain in the feed');
  assert.equal(event.task_id, null, 'the task row is gone; the event keeps its text');
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

test('a bearer token cannot mint new tokens — session only', async () => {
  const { status } = await req('/api/tokens', {
    method: 'POST',
    auth: apiSecret,
    body: { name: 'persistence attempt' },
  });
  assert.equal(status, 403, 'a leaked token must not create replacements that survive revocation');
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

/* ---------------- security hardening & API docs ---------------- */

test('security headers are set on every response', async () => {
  const page = await req('/');
  const csp = page.headers.get('content-security-policy') || '';
  assert.ok(csp.includes("script-src 'self'"), 'CSP must allow only same-origin scripts');
  assert.ok(csp.includes("script-src-attr 'none'"), 'CSP must block inline event handlers');
  assert.ok(csp.includes("'unsafe-inline'"), "CSP style-src must allow the app's inline styles");
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(page.headers.get('strict-transport-security'), 'HSTS should be set');
  assert.ok(page.headers.get('referrer-policy'), 'Referrer-Policy should be set');
  assert.ok(!page.headers.has('x-powered-by'), 'x-powered-by must be disabled');

  // The API itself must carry the same protection headers.
  const api = await req('/api/projects');
  assert.equal(api.status, 401);
  assert.ok(api.headers.get('content-security-policy'));
});

test('session cookie is hardened (HttpOnly, SameSite, Path, Secure)', async () => {
  // Note: this consumes one slot of AUTH_RATE_LIMIT_MAX (10) — the
  // brute-force test below must still be able to trip it.
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Security Test',
      email: `sec-${Date.now()}@example.com`,
      password: 'super-secret-1',
    }),
  });
  assert.equal(res.status, 201);
  const raw = res.headers.get('set-cookie') || '';
  assert.match(raw, /HttpOnly/i, 'cookie must be unreadable from JS');
  assert.match(raw, /SameSite=Lax/i, 'cookie must be SameSite=Lax');
  assert.match(raw, /Path=\//i, 'cookie must be scoped to the whole app');
  assert.ok(!/Secure/i.test(raw), 'Secure must be off over plain HTTP (local tests)');
});

test('oversized JSON bodies are rejected with 413', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(70000) }),
  });
  assert.equal(res.status, 413, 'a >64 KB body must not be buffered');
  const data = await res.json();
  assert.match(data.error, /too large/i);
});

test('OpenAPI spec is served at /api/docs.json', async () => {
  const { status, data } = await req('/api/docs.json');
  assert.equal(status, 200);
  assert.equal(data.openapi, '3.0.3');
  const operations = Object.values(data.paths).reduce((n, p) => n + Object.keys(p).length, 0);
  assert.equal(operations, 32, 'the spec must document every endpoint');
  assert.ok(data.components.securitySchemes.cookieAuth, 'cookie auth documented');
  assert.ok(data.components.securitySchemes.bearerAuth, 'bearer token auth documented');
});

test('interactive Swagger UI is served at /api/docs', async () => {
  const res = await fetch(`${base}/api/docs`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('swagger-ui'), 'docs page must render Swagger UI');

  // swagger-ui-express embeds the spec in a generated initializer script
  // (that's why no inline init script appears in the HTML itself).
  const init = await fetch(`${base}/api/docs/swagger-ui-init.js`);
  assert.equal(init.status, 200);
  const js = await init.text();
  assert.ok(js.includes('TaskFlow API'), 'initializer must embed our spec');
});

test('responses carry standard rate-limit headers', async () => {
  const { headers } = await req('/');
  const limit = headers.get('ratelimit-limit') || headers.get('ratelimit');
  assert.ok(limit, 'expected RateLimit-* headers on responses');
  assert.ok(Number(limit) > 0);
});

/* ---------------- admin panel ---------------- */

test('the first registered account is the admin', async () => {
  const a = await req('/api/auth/me', { cookie: cookieA });
  assert.equal(a.data.user.role, 'admin');
  const b = await req('/api/auth/me', { cookie: cookieB });
  assert.equal(b.data.user.role, 'user');
});

test('admin endpoints reject non-admins', async () => {
  for (const path of ['/api/admin/stats', '/api/admin/users']) {
    const { status } = await req(path, { cookie: cookieB });
    assert.equal(status, 403, `${path} must reject regular users`);
  }
  const anon = await req('/api/admin/stats');
  assert.equal(anon.status, 401, 'no session at all must be 401');
});

test('admin sees platform stats and the full user list', async () => {
  const stats = await req('/api/admin/stats', { cookie: cookieA });
  assert.equal(stats.status, 200);
  assert.ok(stats.data.stats.users >= 2);
  assert.ok(stats.data.stats.projects >= 1);

  const list = await req('/api/admin/users', { cookie: cookieA });
  assert.equal(list.status, 200);
  const ada = list.data.users.find((u) => u.email === 'ada@example.com');
  assert.equal(ada.role, 'admin');
  assert.ok(ada.projects >= 1, 'user list carries activity counts');
  const mallory = list.data.users.find((u) => u.email === 'mallory@example.com');
  assert.equal(mallory.role, 'user');
  assert.ok(!('password_hash' in ada), 'never expose password hashes');
});

test('admin can promote and demote users', async () => {
  const list = await req('/api/admin/users', { cookie: cookieA });
  const mallory = list.data.users.find((u) => u.email === 'mallory@example.com');

  const up = await req(`/api/admin/users/${mallory.id}`, {
    method: 'PUT', cookie: cookieA, body: { role: 'admin' },
  });
  assert.equal(up.status, 200);
  assert.equal(up.data.user.role, 'admin');

  // The promoted user can now use the admin API…
  const now = await req('/api/admin/stats', { cookie: cookieB });
  assert.equal(now.status, 200);

  // …and loses it again when demoted.
  const down = await req(`/api/admin/users/${mallory.id}`, {
    method: 'PUT', cookie: cookieA, body: { role: 'user' },
  });
  assert.equal(down.data.user.role, 'user');
  const after = await req('/api/admin/stats', { cookie: cookieB });
  assert.equal(after.status, 403);
});

test('admins cannot demote or delete themselves', async () => {
  const me = await req('/api/auth/me', { cookie: cookieA });
  const id = me.data.user.id;

  const role = await req(`/api/admin/users/${id}`, {
    method: 'PUT', cookie: cookieA, body: { role: 'user' },
  });
  assert.equal(role.status, 400);

  const del = await req(`/api/admin/users/${id}`, { method: 'DELETE', cookie: cookieA });
  assert.equal(del.status, 400);

  // Still signed in, still admin.
  const again = await req('/api/admin/stats', { cookie: cookieA });
  assert.equal(again.status, 200);
});

test('admin can delete a user — sessions and data cascade away', async () => {
  // Note: consumes one more AUTH_RATE_LIMIT slot (see below).
  const reg = await req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Temp User', email: `temp-${Date.now()}@example.com`, password: 'tempsecret1' },
  });
  assert.equal(reg.status, 201);
  const me = await req('/api/auth/me', { cookie: reg.cookie });
  const tempId = me.data.user.id;

  const proj = await req('/api/projects', {
    method: 'POST', cookie: reg.cookie, body: { name: 'Temp project' },
  });
  assert.equal(proj.status, 201);

  const del = await req(`/api/admin/users/${tempId}`, { method: 'DELETE', cookie: cookieA });
  assert.equal(del.status, 200);

  // Their session dies with them…
  const after = await req('/api/auth/me', { cookie: reg.cookie });
  assert.equal(after.status, 401);
  // …and they vanish from the user list.
  const list = await req('/api/admin/users', { cookie: cookieA });
  assert.ok(!list.data.users.some((u) => u.id === tempId));
});

test('admin can create a user — and that user can then sign in', async () => {
  const created = await req('/api/admin/users', {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'Grace Hopper', email: 'grace@example.com', password: 'gracesecret1' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.user.email, 'grace@example.com');
  assert.equal(created.data.user.role, 'user', 'default role is a regular user');
  assert.ok(!created.cookie, 'creating an account must not sign anyone in');

  // Note: this login consumes one AUTH_RATE_LIMIT slot (10) — the
  // brute-force test below must still be able to trip it.
  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { email: 'grace@example.com', password: 'gracesecret1' },
  });
  assert.equal(login.status, 200);
  const me = await req('/api/auth/me', { cookie: login.cookie });
  assert.equal(me.data.user.name, 'Grace Hopper');
  assert.equal(me.data.user.role, 'user');

  // Admin can grant admin at creation time too.
  const asAdmin = await req('/api/admin/users', {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'Admin Twin', email: 'twin@example.com', password: 'twinscret12', role: 'admin' },
  });
  assert.equal(asAdmin.status, 201);
  assert.equal(asAdmin.data.user.role, 'admin');
});

test('admin create validates input and rejects duplicate emails', async () => {
  const badCases = [
    { name: '', email: 'ok@example.com', password: 'longenough1' },
    { name: 'No Mail', email: 'not-an-email', password: 'longenough1' },
    { name: 'Short Pw', email: 'ok@example.com', password: 'short' },
    { name: 'Bad Role', email: 'ok@example.com', password: 'longenough1', role: 'superuser' },
  ];
  for (const body of badCases) {
    const { status } = await req('/api/admin/users', { method: 'POST', cookie: cookieA, body });
    assert.equal(status, 400, `must reject ${JSON.stringify(body)}`);
  }

  const dup = await req('/api/admin/users', {
    method: 'POST',
    cookie: cookieA,
    body: { name: 'Ada Again', email: 'ADA@example.com', password: 'longenough1' },
  });
  assert.equal(dup.status, 409);
});

test('only admins can create users', async () => {
  const asUser = await req('/api/admin/users', {
    method: 'POST',
    cookie: cookieB,
    body: { name: 'Sneaky', email: 'sneaky@example.com', password: 'longenough1' },
  });
  assert.equal(asUser.status, 403);

  const anon = await req('/api/admin/users', {
    method: 'POST',
    body: { name: 'Anon', email: 'anon@example.com', password: 'longenough1' },
  });
  assert.equal(anon.status, 401);

  // Nothing was created.
  const list = await req('/api/admin/users', { cookie: cookieA });
  assert.ok(!list.data.users.some((u) => u.email === 'sneaky@example.com'));
});

test('admin account creation has its own rate limit', async () => {
  // Seven create attempts have run in this section already (ADMIN_RATE_LIMIT_MAX=10).
  let sawLimit = false;
  for (let i = 0; i < 6 && !sawLimit; i++) {
    const out = await req('/api/admin/users', {
      method: 'POST',
      cookie: cookieA,
      body: { name: `Bulk ${i}`, email: `bulk-${i}@example.com`, password: 'bulkenough1' },
    });
    if (out.status === 429) {
      sawLimit = true;
      assert.match(out.data.error, /too many/i);
    } else {
      assert.equal(out.status, 201);
    }
  }
  assert.ok(sawLimit, 'expected the admin-create limiter to trip within 6 attempts');
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

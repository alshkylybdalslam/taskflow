'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

router.use(requireAuth);

/** A task joined with its project — used to verify ownership on every op. */
function findTask(id) {
  return db
    .prepare(
      `SELECT t.*, p.user_id AS owner_id, p.name AS project_name, p.color AS project_color
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE t.id = ?`
    )
    .get(id);
}

function ownedProjectId(userId, projectId) {
  const row = db
    .prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?')
    .get(projectId, userId);
  return row ? row.id : null;
}

function validateTask(body, { partial = false } = {}) {
  const { title, description, status, priority, due_date, project_id } = body;

  if (!partial || title !== undefined) {
    if (typeof title !== 'string' || title.trim().length < 1) return 'Task title is required.';
    if (title.trim().length > 200) return 'Title must be 200 characters or fewer.';
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > 2000)) {
    return 'Description must be 2000 characters or fewer.';
  }
  if (status !== undefined && !STATUSES.includes(status)) return 'Invalid status.';
  if (priority !== undefined && !PRIORITIES.includes(priority)) return 'Invalid priority.';
  if (due_date !== undefined && due_date !== null && (typeof due_date !== 'string' || !DATE_RE.test(due_date))) {
    return 'Due date must be a date like 2026-10-31.';
  }
  if (project_id !== undefined && !Number.isInteger(Number(project_id))) {
    return 'Invalid project.';
  }
  return null;
}

/**
 * GET /api/tasks
 * Filters: ?project_id= &status= &priority= &q= (search)
 * Order: open work first, soonest due date first.
 */
router.get('/', (req, res) => {
  const { project_id, status, priority, q } = req.query;

  const where = ['p.user_id = ?'];
  const params = [req.user.id];

  if (project_id) {
    where.push('t.project_id = ?');
    params.push(Number(project_id));
  }
  if (status && STATUSES.includes(status)) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (priority && PRIORITIES.includes(priority)) {
    where.push('t.priority = ?');
    params.push(priority);
  }
  if (q) {
    where.push('(t.title LIKE ? OR t.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }

  const tasks = db
    .prepare(
      `SELECT t.id, t.project_id, t.title, t.description, t.status, t.priority,
              t.due_date, t.created_at, t.updated_at, t.completed_at,
              p.name AS project_name, p.color AS project_color
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE ${where.join(' AND ')}
        ORDER BY (t.status = 'done') ASC,
                 t.due_date IS NULL,
                 t.due_date ASC,
                 t.id DESC`
    )
    .all(...params);

  res.json({ tasks });
});

/** POST /api/tasks — create a task */
router.post('/', (req, res) => {
  const body = req.body || {};
  const error = validateTask(body);
  if (error) return res.status(400).json({ error });

  const projectId = ownedProjectId(req.user.id, Number(body.project_id));
  if (!projectId) return res.status(400).json({ error: 'Choose a project you own.' });

  const result = db
    .prepare(
      `INSERT INTO tasks (project_id, title, description, status, priority, due_date, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      projectId,
      body.title.trim(),
      body.description || '',
      body.status || 'todo',
      body.priority || 'medium',
      body.due_date || null,
      (body.status || 'todo') === 'done' ? new Date().toISOString() : null
    );

  res.status(201).json({ task: findTask(result.lastInsertRowid) });
});

/** PUT /api/tasks/:id — partial update of a task */
router.put('/:id', (req, res) => {
  const task = findTask(req.params.id);
  if (!task || task.owner_id !== req.user.id) {
    return res.status(404).json({ error: 'Task not found.' });
  }

  const body = req.body || {};
  const error = validateTask(body, { partial: true });
  if (error) return res.status(400).json({ error });

  let projectId = task.project_id;
  if (body.project_id !== undefined) {
    const owned = ownedProjectId(req.user.id, Number(body.project_id));
    if (!owned) return res.status(400).json({ error: 'Choose a project you own.' });
    projectId = owned;
  }

  const nextStatus = body.status !== undefined ? body.status : task.status;

  // Stamp completion time only when the status actually flips.
  let completedAt = task.completed_at;
  if (body.status !== undefined && body.status !== task.status) {
    completedAt = body.status === 'done' ? new Date().toISOString() : null;
  }

  db.prepare(
    `UPDATE tasks
        SET project_id = ?, title = ?, description = ?, status = ?, priority = ?,
            due_date = ?, completed_at = ?, updated_at = datetime('now')
      WHERE id = ? AND project_id IN (SELECT id FROM projects WHERE user_id = ?)`
  ).run(
    projectId,
    body.title !== undefined ? String(body.title).trim() : task.title,
    body.description !== undefined ? String(body.description) : task.description,
    nextStatus,
    body.priority !== undefined ? body.priority : task.priority,
    body.due_date !== undefined ? body.due_date : task.due_date,
    completedAt,
    task.id,
    req.user.id
  );

  res.json({ task: findTask(task.id) });
});

/** DELETE /api/tasks/:id */
router.delete('/:id', (req, res) => {
  const task = findTask(req.params.id);
  if (!task || task.owner_id !== req.user.id) {
    return res.status(404).json({ error: 'Task not found.' });
  }
  db.prepare('DELETE FROM tasks WHERE id = ?').run(task.id);
  res.json({ ok: true });
});

module.exports = router;

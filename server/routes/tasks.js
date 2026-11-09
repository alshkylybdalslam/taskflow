'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { labelsFor } = require('./labels');

const router = express.Router();
const STATUSES = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DUE_FILTERS = ['overdue', 'today', 'none'];

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

/** Attach a `labels` array to a (list of) task(s) in one extra query. */
function withLabels(tasks) {
  const list = Array.isArray(tasks) ? tasks : [tasks];
  const ids = list.filter(Boolean).map((t) => t.id);
  const map = labelsFor(ids);
  for (const t of list) {
    if (t) t.labels = map.get(t.id) || [];
  }
  return Array.isArray(tasks) ? tasks : tasks;
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
  if (body.label_ids !== undefined) {
    if (!Array.isArray(body.label_ids) || body.label_ids.some((n) => !Number.isInteger(Number(n)))) {
      return 'label_ids must be an array of label ids.';
    }
  }
  return null;
}

/** Validate that every label belongs to `projectId` — writes nothing. */
function validateLabelIds(projectId, labelIds) {
  const ids = [...new Set(labelIds.map(Number))];
  for (const id of ids) {
    const label = db.prepare('SELECT project_id FROM labels WHERE id = ?').get(id);
    if (!label || label.project_id !== projectId) {
      return 'One of those labels belongs to another project.';
    }
  }
  return null;
}

/** Replace a task's label assignments. Returns an error string, or null. */
function setTaskLabels(taskId, projectId, labelIds) {
  const error = validateLabelIds(projectId, labelIds);
  if (error) return error;
  const ids = [...new Set(labelIds.map(Number))];
  const wipe = db.prepare('DELETE FROM task_labels WHERE task_id = ?');
  const link = db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)');
  db.transaction(() => {
    wipe.run(taskId);
    for (const id of ids) link.run(taskId, id);
  })();
  return null;
}

/**
 * GET /api/tasks
 * Filters: ?project_id= &status= &priority= &q= &label_id= &due=(overdue|today|none)
 * Order: open work first, soonest due date first.
 */
router.get('/', (req, res) => {
  const { project_id, status, priority, q, label_id, due } = req.query;

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
    // Escape LIKE wildcards so "%" and "_" match literally (correctness).
    const escaped = String(q).replace(/[\\%_]/g, (c) => `\\${c}`);
    where.push("(t.title LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')");
    params.push(`%${escaped}%`, `%${escaped}%`);
  }
  if (label_id && Number.isInteger(Number(label_id))) {
    where.push('EXISTS (SELECT 1 FROM task_labels tl WHERE tl.task_id = t.id AND tl.label_id = ?)');
    params.push(Number(label_id));
  }
  if (due === 'overdue') {
    where.push("t.due_date < date('now') AND t.status != 'done'");
  } else if (due === 'today') {
    where.push("t.due_date = date('now')");
  } else if (due === 'none') {
    where.push('t.due_date IS NULL');
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

  res.json({ tasks: withLabels(tasks) });
});

/** POST /api/tasks — create a task */
router.post('/', (req, res) => {
  const body = req.body || {};
  const error = validateTask(body);
  if (error) return res.status(400).json({ error });

  const projectId = ownedProjectId(req.user.id, Number(body.project_id));
  if (!projectId) return res.status(400).json({ error: 'Choose a project you own.' });

  const hasLabels = Array.isArray(body.label_ids) && body.label_ids.length > 0;
  if (hasLabels) {
    // Validate BEFORE inserting: no orphaned task if a label is invalid.
    const labelError = validateLabelIds(projectId, body.label_ids);
    if (labelError) return res.status(400).json({ error: labelError });
  }

  const taskId = db.transaction(() => {
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
    if (hasLabels) setTaskLabels(result.lastInsertRowid, projectId, body.label_ids);
    return result.lastInsertRowid;
  })();

  res.status(201).json({ task: withLabels(findTask(taskId)) });
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

  // Validate labels BEFORE the UPDATE: a bad label must not leave the task
  // half-updated (fields changed, error returned).
  if (body.label_ids !== undefined) {
    const labelError = validateLabelIds(projectId, body.label_ids);
    if (labelError) return res.status(400).json({ error: labelError });
  }

  const nextStatus = body.status !== undefined ? body.status : task.status;

  // Stamp completion time only when the status actually flips.
  let completedAt = task.completed_at;
  if (body.status !== undefined && body.status !== task.status) {
    completedAt = body.status === 'done' ? new Date().toISOString() : null;
  }

  const movedProject = projectId !== task.project_id;

  db.transaction(() => {
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

    if (body.label_ids !== undefined) {
      setTaskLabels(task.id, projectId, body.label_ids);
    } else if (movedProject) {
      // Labels are project-scoped — moving the task orphans the old ones.
      db.prepare('DELETE FROM task_labels WHERE task_id = ?').run(task.id);
    }
  })();

  res.json({ task: withLabels(findTask(task.id)) });
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

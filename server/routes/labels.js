'use strict';

/**
 * Labels — project-scoped tags attached to tasks via a junction table.
 *
 * Mounted as one router under /api:
 *   GET    /api/projects/:id/labels   list a project's labels
 *   POST   /api/projects/:id/labels   create a label
 *   GET    /api/labels                every label across my projects (filters)
 *   DELETE /api/labels/:id            delete a label (unassigns everywhere)
 *   POST   /api/tasks/:id/labels      attach a label   { label_id }
 *   DELETE /api/tasks/:id/labels/:labelId  detach a label
 */

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const COLOR_RE = /^#[0-9a-f]{6}$/i;

// NOTE: no router.use(requireAuth) here — this router is mounted at bare /api,
// so a router-level guard would intercept unrelated unknown endpoints (404s).
// Each route guards itself instead.

const LABEL_SELECT = `
  SELECT l.id, l.project_id, l.name, l.color, l.created_at, p.name AS project_name
    FROM labels l
    JOIN projects p ON p.id = l.project_id
`;

/** Project owned by the current user, or null. */
function ownedProject(id, userId) {
  return db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(id, userId) || null;
}

/** Task owned by the current user (via its project), or null. */
function ownedTask(id, userId) {
  return db
    .prepare(
      `SELECT t.id, t.project_id
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE t.id = ? AND p.user_id = ?`
    )
    .get(id, userId);
}

/** Labels of one task, as [{id, name, color}] — used in task responses. */
function labelsFor(taskIds) {
  if (!taskIds.length) return new Map();
  const map = new Map();
  // Chunk the ids: SQLite allows ~999 bound variables per statement, so a
  // large task list must not build one huge IN (?, ?, …) clause.
  for (let i = 0; i < taskIds.length; i += 500) {
    const chunk = taskIds.slice(i, i + 500);
    const marks = chunk.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT tl.task_id, l.id, l.name, l.color
           FROM task_labels tl
           JOIN labels l ON l.id = tl.label_id
          WHERE tl.task_id IN (${marks})`
      )
      .all(...chunk);
    for (const r of rows) {
      if (!map.has(r.task_id)) map.set(r.task_id, []);
      map.get(r.task_id).push({ id: r.id, name: r.name, color: r.color });
    }
  }
  return map;
}

function validateName(name, color) {
  if (typeof name !== 'string' || name.trim().length < 1) return 'Label name is required.';
  if (name.trim().length > 30) return 'Label names must be 30 characters or fewer.';
  if (color !== undefined && (typeof color !== 'string' || !COLOR_RE.test(color))) {
    return 'Color must be a hex value like #6366f1.';
  }
  return null;
}

/* ---------------- project labels ---------------- */

router.get('/projects/:id/labels', requireAuth, (req, res) => {
  if (!ownedProject(req.params.id, req.user.id)) {
    return res.status(404).json({ error: 'Project not found.' });
  }
  const labels = db
    .prepare(`${LABEL_SELECT} WHERE l.project_id = ? ORDER BY l.name COLLATE NOCASE`)
    .all(req.params.id);
  res.json({ labels });
});

router.post('/projects/:id/labels', requireAuth, (req, res) => {
  const project = ownedProject(req.params.id, req.user.id);
  if (!project) return res.status(404).json({ error: 'Project not found.' });

  const { name, color = '#6366f1' } = req.body || {};
  const error = validateName(name, color);
  if (error) return res.status(400).json({ error });

  const exists = db
    .prepare('SELECT id FROM labels WHERE project_id = ? AND name = ? COLLATE NOCASE')
    .get(project.id, name.trim());
  if (exists) return res.status(409).json({ error: 'That label already exists in this project.' });

  const result = db
    .prepare('INSERT INTO labels (project_id, name, color) VALUES (?, ?, ?)')
    .run(project.id, name.trim(), color);

  const label = db.prepare(`${LABEL_SELECT} WHERE l.id = ?`).get(result.lastInsertRowid);
  res.status(201).json({ label });
});

/* ---------------- global list (for filters) ---------------- */

router.get('/labels', requireAuth, (req, res) => {
  const labels = db
    .prepare(
      `${LABEL_SELECT} WHERE p.user_id = ? ORDER BY p.id, l.name COLLATE NOCASE`
    )
    .all(req.user.id);
  res.json({ labels });
});

router.delete('/labels/:id', requireAuth, (req, res) => {
  const label = db
    .prepare(`${LABEL_SELECT} WHERE l.id = ?`)
    .get(req.params.id);
  if (!label || !ownedProject(label.project_id, req.user.id)) {
    return res.status(404).json({ error: 'Label not found.' });
  }
  db.prepare('DELETE FROM labels WHERE id = ?').run(label.id); // task_labels cascade
  res.json({ ok: true });
});

/* ---------------- task assignment ---------------- */

router.post('/tasks/:id/labels', requireAuth, (req, res) => {
  const task = ownedTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const labelId = Number((req.body || {}).label_id);
  const label = db.prepare('SELECT id, project_id FROM labels WHERE id = ?').get(labelId);
  // Same response for "does not exist" and "belongs to another account's
  // project" — otherwise label ids could be probed across accounts.
  if (!label || label.project_id !== task.project_id) {
    return res.status(404).json({ error: 'Label not found.' });
  }

  db.prepare('INSERT OR IGNORE INTO task_labels (task_id, label_id) VALUES (?, ?)').run(
    task.id,
    label.id
  );
  const labels = labelsFor([task.id]).get(task.id) || [];
  res.status(201).json({ labels });
});

router.delete('/tasks/:id/labels/:labelId', requireAuth, (req, res) => {
  const task = ownedTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  db.prepare('DELETE FROM task_labels WHERE task_id = ? AND label_id = ?').run(
    task.id,
    Number(req.params.labelId)
  );
  res.json({ ok: true });
});

module.exports = router;
module.exports.labelsFor = labelsFor;

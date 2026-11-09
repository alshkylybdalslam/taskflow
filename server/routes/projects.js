'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../activity');

const router = express.Router();
const COLOR_RE = /^#[0-9a-f]{6}$/i;

const PROJECT_STATS = `
  SELECT p.id, p.name, p.description, p.color, p.created_at,
         COUNT(t.id) AS total_tasks,
         COALESCE(SUM(CASE WHEN t.status = 'todo'         THEN 1 ELSE 0 END), 0) AS todo_tasks,
         COALESCE(SUM(CASE WHEN t.status = 'in_progress'  THEN 1 ELSE 0 END), 0) AS in_progress_tasks,
         COALESCE(SUM(CASE WHEN t.status = 'done'         THEN 1 ELSE 0 END), 0) AS done_tasks,
         COALESCE(SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date < date('now')
                            AND t.status != 'done' THEN 1 ELSE 0 END), 0) AS overdue_tasks
    FROM projects p
    LEFT JOIN tasks t ON t.project_id = p.id
`;

router.use(requireAuth);

function ownedProject(req, res) {
  const project = db
    .prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return null;
  }
  return project;
}

function validate({ name, description, color }, { partial = false } = {}) {
  if (!partial || name !== undefined) {
    if (typeof name !== 'string' || name.trim().length < 1) {
      return 'Project name is required.';
    }
    if (name.trim().length > 80) return 'Project name must be 80 characters or fewer.';
  }
  if (description !== undefined && (typeof description !== 'string' || description.length > 500)) {
    return 'Description must be 500 characters or fewer.';
  }
  if (color !== undefined && (typeof color !== 'string' || !COLOR_RE.test(color))) {
    return 'Color must be a hex value like #4f46e5.';
  }
  return null;
}

/** GET /api/projects — all projects with task stats */
router.get('/', (req, res) => {
  const projects = db
    .prepare(`${PROJECT_STATS} WHERE p.user_id = ? GROUP BY p.id ORDER BY p.created_at DESC`)
    .all(req.user.id);
  res.json({ projects });
});

/** GET /api/projects/:id — a single project with task stats */
router.get('/:id', (req, res) => {
  const project = ownedProject(req, res);
  if (!project) return;
  const stats = db
    .prepare(`${PROJECT_STATS} WHERE p.id = ? GROUP BY p.id`)
    .get(project.id);
  res.json({ project: stats });
});

/** POST /api/projects — create a project */
router.post('/', (req, res) => {
  const { name, description = '', color = '#4f46e5' } = req.body || {};
  const error = validate({ name, description, color });
  if (error) return res.status(400).json({ error });

  const result = db
    .prepare('INSERT INTO projects (user_id, name, description, color) VALUES (?, ?, ?, ?)')
    .run(req.user.id, name.trim(), String(description), color);

  logActivity({
    userId: req.user.id,
    projectId: result.lastInsertRowid,
    action: 'project.created',
    subject: name.trim(),
    detail: String(description).slice(0, 80),
  });

  const project = db
    .prepare(`${PROJECT_STATS} WHERE p.id = ? GROUP BY p.id`)
    .get(result.lastInsertRowid);
  res.status(201).json({ project });
});

/** PUT /api/projects/:id — update a project */
router.put('/:id', (req, res) => {
  const project = ownedProject(req, res);
  if (!project) return;

  const { name, description, color } = req.body || {};
  const error = validate({ name, description, color }, { partial: true });
  if (error) return res.status(400).json({ error });

  db.prepare(
    `UPDATE projects
        SET name = ?, description = ?, color = ?
      WHERE id = ? AND user_id = ?`
  ).run(
    name !== undefined ? String(name).trim() : project.name,
    description !== undefined ? String(description) : project.description,
    color !== undefined ? color : project.color,
    project.id,
    req.user.id
  );

  const updated = db
    .prepare(`${PROJECT_STATS} WHERE p.id = ? GROUP BY p.id`)
    .get(project.id);

  const changed = [
    name !== undefined && 'name',
    description !== undefined && 'description',
    color !== undefined && 'color',
  ].filter(Boolean);
  if (changed.length) {
    logActivity({
      userId: req.user.id,
      projectId: project.id,
      action: 'project.updated',
      subject: updated.name,
      detail: changed.join(', '),
    });
  }

  res.json({ project: updated });
});

/** DELETE /api/projects/:id — delete a project (tasks cascade) */
router.delete('/:id', (req, res) => {
  const project = ownedProject(req, res);
  if (!project) return;
  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(project.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;

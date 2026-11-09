'use strict';

/**
 * Task comments — a lightweight discussion thread under each task.
 * Access follows task ownership: a comment is visible only to people who
 * can see the task (currently the project owner).
 */

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../activity');

const router = express.Router();

const MAX_BODY = 2000;

/** The task plus its project, only when the signed-in user owns the project. */
function ownedTask(taskId, userId) {
  return db
    .prepare(
      `SELECT t.id, t.title, t.project_id, p.name AS project_name
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE t.id = ? AND p.user_id = ?`
    )
    .get(taskId, userId);
}

/** A comment joined with its author — the shape the UI renders. */
function commentWithAuthor(id) {
  return db
    .prepare(
      `SELECT c.id, c.task_id, c.body, c.created_at,
              u.id AS author_id, u.name AS author_name
         FROM comments c
         JOIN users u ON u.id = c.user_id
        WHERE c.id = ?`
    )
    .get(id);
}

function shape(row) {
  return {
    id: row.id,
    task_id: row.task_id,
    body: row.body,
    created_at: row.created_at,
    author: { id: row.author_id, name: row.author_name },
  };
}

/** GET /api/tasks/:id/comments — oldest first, like a conversation. */
router.get('/tasks/:id/comments', requireAuth, (req, res) => {
  const task = ownedTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const rows = db
    .prepare(
      `SELECT c.id, c.task_id, c.body, c.created_at,
              u.id AS author_id, u.name AS author_name
         FROM comments c
         JOIN users u ON u.id = c.user_id
        WHERE c.task_id = ?
        ORDER BY c.id ASC`
    )
    .all(task.id);

  res.json({ comments: rows.map(shape) });
});

/** POST /api/tasks/:id/comments — add a comment */
router.post('/tasks/:id/comments', requireAuth, (req, res) => {
  const task = ownedTask(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task not found.' });

  const body = (req.body || {}).body;
  if (typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'Write something first.' });
  }
  if (body.length > MAX_BODY) {
    return res.status(400).json({ error: `Comments are limited to ${MAX_BODY} characters.` });
  }

  const id = db.transaction(() => {
    const result = db
      .prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)')
      .run(task.id, req.user.id, body.trim());

    logActivity({
      userId: req.user.id,
      projectId: task.project_id,
      taskId: task.id,
      action: 'comment.added',
      subject: task.title,
      detail: body.trim().slice(0, 80),
    });
    return result.lastInsertRowid;
  })();

  res.status(201).json({ comment: shape(commentWithAuthor(id)) });
});

/** DELETE /api/comments/:id — only the project owner can delete (for now) */
router.delete('/comments/:id', requireAuth, (req, res) => {
  const row = db
    .prepare(
      `SELECT c.id, c.body, c.user_id, t.id AS task_id, t.title AS task_title,
              t.project_id, p.user_id AS owner_id
         FROM comments c
         JOIN tasks t ON t.id = c.task_id
         JOIN projects p ON p.id = t.project_id
        WHERE c.id = ?`
    )
    .get(req.params.id);

  if (!row || row.owner_id !== req.user.id) {
    return res.status(404).json({ error: 'Comment not found.' });
  }

  db.transaction(() => {
    logActivity({
      userId: req.user.id,
      projectId: row.project_id,
      taskId: row.task_id,
      action: 'comment.deleted',
      subject: row.task_title,
      detail: row.body.slice(0, 80),
    });
    db.prepare('DELETE FROM comments WHERE id = ?').run(row.id);
  })();

  res.json({ ok: true });
});

module.exports = router;

'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

/**
 * GET /api/dashboard — everything the dashboard needs in one round trip:
 * summary numbers, priority split, per-project progress, upcoming deadlines,
 * recent completions and a 7-day "tasks completed" series.
 */
router.get('/', (req, res) => {
  const userId = req.user.id;

  const summary = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN t.status = 'todo'        THEN 1 ELSE 0 END), 0) AS todo,
              COALESCE(SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress,
              COALESCE(SUM(CASE WHEN t.status = 'done'        THEN 1 ELSE 0 END), 0) AS done,
              COALESCE(SUM(CASE WHEN t.status != 'done' AND t.due_date IS NOT NULL
                                AND t.due_date < date('now') THEN 1 ELSE 0 END), 0) AS overdue,
              COALESCE(SUM(CASE WHEN t.status != 'done' AND t.due_date IS NOT NULL
                                AND t.due_date = date('now') THEN 1 ELSE 0 END), 0) AS due_today
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE p.user_id = ?`
    )
    .get(userId);

  const byPriority = db
    .prepare(
      `SELECT t.priority, COUNT(*) AS count
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE p.user_id = ?
        GROUP BY t.priority`
    )
    .all(userId);

  const projects = db
    .prepare(
      `SELECT p.id, p.name, p.color,
              COUNT(t.id) AS total,
              COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) AS done
         FROM projects p
         LEFT JOIN tasks t ON t.project_id = p.id
        WHERE p.user_id = ?
        GROUP BY p.id
        ORDER BY p.created_at DESC`
    )
    .all(userId);

  const upcoming = db
    .prepare(
      `SELECT t.id, t.title, t.due_date, t.status, t.priority,
              p.name AS project_name, p.color AS project_color
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE p.user_id = ? AND t.status != 'done'
          AND t.due_date IS NOT NULL AND t.due_date >= date('now')
        ORDER BY t.due_date ASC
        LIMIT 6`
    )
    .all(userId);

  const recentCompleted = db
    .prepare(
      `SELECT t.id, t.title, t.completed_at, p.name AS project_name, p.color AS project_color
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE p.user_id = ? AND t.status = 'done' AND t.completed_at IS NOT NULL
        ORDER BY t.completed_at DESC
        LIMIT 5`
    )
    .all(userId);

  const weeklyRows = db
    .prepare(
      `SELECT date(t.completed_at) AS day, COUNT(*) AS count
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
        WHERE p.user_id = ? AND t.completed_at >= datetime('now', '-6 days', 'start of day')
        GROUP BY day`
    )
    .all(userId);

  // Build a gap-free 7-day series ending today.
  const countsByDay = Object.fromEntries(weeklyRows.map((r) => [r.day, r.count]));
  const weekly = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    weekly.push({ day, count: countsByDay[day] || 0 });
  }

  res.json({
    summary: {
      ...summary,
      completion_rate: summary.total ? Math.round((summary.done / summary.total) * 100) : 0,
    },
    byPriority,
    projects,
    upcoming,
    recentCompleted,
    weekly,
  });
});

module.exports = router;

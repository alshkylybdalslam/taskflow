'use strict';

/**
 * Activity feed — the audit trail written by every mutating route.
 * Only events belonging to the signed-in user's projects are returned.
 */

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

const MAX_LIMIT = 100;

/**
 * GET /api/activity?limit=50&project_id=1
 * Newest first. `limit` is clamped to 1…100.
 */
router.get('/', (req, res) => {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit) || 50));

  const where = ['p.user_id = ?'];
  const params = [req.user.id];

  if (req.query.project_id && Number.isInteger(Number(req.query.project_id))) {
    where.push('a.project_id = ?');
    params.push(Number(req.query.project_id));
  }

  const rows = db
    .prepare(
      `SELECT a.id, a.action, a.subject, a.detail, a.created_at,
              a.project_id, a.task_id,
              p.name AS project_name, p.color AS project_color,
              u.name AS actor_name
         FROM activity a
         JOIN projects p ON p.id = a.project_id
         JOIN users u ON u.id = a.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.id DESC
        LIMIT ?`
    )
    .all(...params, limit);

  res.json({ activity: rows });
});

module.exports = router;

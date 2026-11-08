'use strict';

/**
 * Admin panel API — global stats and user management.
 *
 *   GET    /api/admin/stats        platform-wide counters
 *   GET    /api/admin/users        every user with activity counts
 *   POST   /api/admin/users        create an account on someone's behalf
 *   PUT    /api/admin/users/:id    promote / demote (never yourself)
 *   DELETE /api/admin/users/:id    delete a user and all their data
 *
 * Guarded by requireAuth + requireAdmin (see middleware/auth.js).
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth, requireAdmin);

const ROLES = ['user', 'admin'];
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/** GET /api/admin/stats — counters for the admin dashboard. */
router.get('/stats', (req, res) => {
  const one = (sql) => Object.values(db.prepare(sql).get())[0];
  res.json({
    stats: {
      users: one('SELECT COUNT(*) FROM users'),
      admins: one("SELECT COUNT(*) FROM users WHERE role = 'admin'"),
      projects: one('SELECT COUNT(*) FROM projects'),
      tasks: one('SELECT COUNT(*) FROM tasks'),
      labels: one('SELECT COUNT(*) FROM labels'),
      api_tokens: one('SELECT COUNT(*) FROM api_tokens'),
      sessions: one('SELECT COUNT(*) FROM sessions'),
      done_tasks: one("SELECT COUNT(*) FROM tasks WHERE status = 'done'"),
    },
  });
});

/** GET /api/admin/users — every user with how much they've built. */
router.get('/users', (req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
              (SELECT COUNT(*) FROM projects p WHERE p.user_id = u.id) AS projects,
              (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id
                WHERE p.user_id = u.id) AS tasks,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id
                AND s.expires_at > datetime('now')) AS active_sessions
         FROM users u
        ORDER BY u.created_at ASC, u.id ASC`
    )
    .all();
  res.json({ users });
});

/**
 * POST /api/admin/users — create an account (admin onboarding, no invite
 * flow needed). The new user gets a session-free account: they log in
 * with the password set here. Deliberately NOT behind authLimiter — that
 * budget is for the public register/login endpoints.
 */
router.post('/users', (req, res) => {
  const { name, email, password, role } = req.body || {};

  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) {
    return res.status(400).json({ error: 'Name is required (max 80 characters).' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  const finalRole = role === undefined ? 'user' : role;
  if (!ROLES.includes(finalRole)) {
    return res.status(400).json({ error: 'Role must be "user" or "admin".' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name.trim(), normalizedEmail, passwordHash, finalRole);

  const user = db
    .prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?')
    .get(result.lastInsertRowid);
  res.status(201).json({ user });
});

/** PUT /api/admin/users/:id — set a user's role. */
router.put('/users/:id', (req, res) => {
  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const { role } = req.body || {};
  if (!ROLES.includes(role)) {
    return res.status(400).json({ error: 'Role must be "user" or "admin".' });
  }
  // Never change your own role: prevents an admin locking themselves out
  // (or silently giving themselves privileges through this endpoint).
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot change your own role.' });
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  const user = db
    .prepare('SELECT id, name, email, role, created_at FROM users WHERE id = ?')
    .get(target.id);
  res.json({ user });
});

/** DELETE /api/admin/users/:id — remove a user (projects/tasks/tokens cascade). */
router.delete('/users/:id', (req, res) => {
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own account here.' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true });
});

module.exports = router;

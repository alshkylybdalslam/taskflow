'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const {
  startSession,
  endSession,
  getSessionToken,
  requireAuth,
} = require('../middleware/auth');

const router = express.Router();
const EMAIL_RE = /^\S+@\S+\.\S+$/;

/**
 * Brute-force protection for credential endpoints: a sliding window of
 * attempts per IP address. Tunable via env (used by tests and ops):
 *   AUTH_RATE_LIMIT_MAX=30  AUTH_RATE_LIMIT_WINDOW_MS=900000
 */
const authLimiter = rateLimit({
  windowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please wait a few minutes and try again.' },
});

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

/** POST /api/auth/register — create an account and start a session */
router.post('/register', authLimiter, (req, res) => {
  const { name, email, password } = req.body || {};

  if (typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Please enter your name (at least 2 characters).' });
  }
  if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
    .run(name.trim(), normalizedEmail, passwordHash);

  startSession(res, result.lastInsertRowid);
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ user });
});

/** POST /api/auth/login — verify credentials and start a session */
router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

/** POST /api/auth/logout — destroy the current session */
router.post('/logout', (req, res) => {
  endSession(res, getSessionToken(req));
  res.json({ ok: true });
});

/** GET /api/auth/me — who am I? */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;

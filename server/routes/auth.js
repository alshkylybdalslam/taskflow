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
const MAX_PASSWORD_BYTES = 72; // bcrypt silently truncates beyond this

/** Numeric env var: `0` disables the limiter, invalid/empty uses the fallback. */
function envLimit(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Brute-force protection for credential endpoints: a sliding window of
 * attempts per IP address. Tunable via env (used by tests and ops):
 *   AUTH_RATE_LIMIT_MAX=30  AUTH_RATE_LIMIT_WINDOW_MS=900000
 * Setting AUTH_RATE_LIMIT_MAX=0 disables the limiter explicitly.
 */
const authMax = envLimit('AUTH_RATE_LIMIT_MAX', 30);
const authLimiter =
  authMax > 0
    ? rateLimit({
        windowMs: envLimit('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
        limit: authMax,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many attempts — please wait a few minutes and try again.' },
      })
    : (req, res, next) => next();

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
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
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return res
      .status(400)
      .json({ error: `Password must be ${MAX_PASSWORD_BYTES} bytes or fewer (bcrypt limit).` });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);

  // The very first account on a fresh install becomes the admin, so every
  // deployment has an admin without shipping a default password. Check and
  // insert run in one transaction so the guarantee is explicit.
  let result;
  try {
    result = db.transaction(() => {
      const isFirstUser = !db.prepare('SELECT id FROM users').get();
      return db
        .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(name.trim(), normalizedEmail, passwordHash, isFirstUser ? 'admin' : 'user');
    })();
  } catch (err) {
    // Two simultaneous registrations can both pass the check above — the
    // UNIQUE constraint is the real guard; report it as a normal 409.
    if (String(err.code || '').includes('SQLITE_CONSTRAINT')) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    throw err;
  }

  startSession(res, result.lastInsertRowid);
  const user = db
    .prepare('SELECT id, name, email, role FROM users WHERE id = ?')
    .get(result.lastInsertRowid);
  res.status(201).json({ user });
});

/** POST /api/auth/login — verify credentials and start a session */
// Compared against when the email does not exist, so login timing does not
// reveal which addresses have accounts (bcrypt cost is the same either way).
const DUMMY_HASH = bcrypt.hashSync('taskflow-timing-equalizer-not-a-password', 10);

router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  const passwordOk = bcrypt.compareSync(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !passwordOk) {
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

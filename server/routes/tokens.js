'use strict';

/**
 * Personal access tokens — script-friendly auth for the REST API.
 *
 *   Authorization: Bearer tf_<40 hex>
 *
 * Only the SHA-256 hash of a token is stored; the raw value is shown once
 * at creation time and never again (same rules as a password).
 */

const crypto = require('node:crypto');
const express = require('express');
const db = require('../db');
const { requireAuth, hashToken } = require('../middleware/auth');

const router = express.Router();

router.use(requireAuth);

const NAME_RE = /^[\w][\w .\-]{0,59}$/;

/** GET /api/tokens — list my tokens (never the secret itself) */
router.get('/', (req, res) => {
  const tokens = db
    .prepare(
      `SELECT id, name, prefix, created_at, last_used_at
         FROM api_tokens
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC`
    )
    .all(req.user.id);
  res.json({ tokens });
});

/** POST /api/tokens — mint a new token, returning the raw value exactly once */
router.post('/', (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !NAME_RE.test(name.trim())) {
    return res
      .status(400)
      .json({ error: 'Give the token a name (1–60 letters, numbers, spaces, - or .).' });
  }

  const raw = `tf_${crypto.randomBytes(20).toString('hex')}`;
  const result = db
    .prepare('INSERT INTO api_tokens (user_id, name, token_hash, prefix) VALUES (?, ?, ?, ?)')
    .run(req.user.id, name.trim(), hashToken(raw), raw.slice(0, 9));

  const token = db
    .prepare('SELECT id, name, prefix, created_at, last_used_at FROM api_tokens WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json({
    token,
    secret: raw, // shown once — store it somewhere safe
    warning: 'Copy this now — it will never be shown again.',
  });
});

/** DELETE /api/tokens/:id — revoke a token immediately */
router.delete('/:id', (req, res) => {
  const row = db
    .prepare('SELECT id FROM api_tokens WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Token not found.' });

  db.prepare('DELETE FROM api_tokens WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;

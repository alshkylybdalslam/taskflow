'use strict';

/**
 * Session auth — opaque random tokens stored in the sessions table,
 * delivered to the browser in an httpOnly cookie.
 */

const crypto = require('node:crypto');
const db = require('../db');

const SESSION_COOKIE = 'taskflow_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Minimal cookie header parser (no extra dependency needed). */
function parseCookies(header = '') {
  const jar = {};
  for (const pair of header.split(';')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    jar[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return jar;
}

function getSessionToken(req) {
  return parseCookies(req.headers.cookie || '')[SESSION_COOKIE] || null;
}

/** Create a session row and set the cookie on the response. */
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    expiresAt
  );
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Only meaningful behind HTTPS (Render etc. — trust proxy is set in
    // index.js); stays off for plain-HTTP local dev and tests.
    secure: Boolean(res.req && res.req.secure),
    maxAge: SESSION_TTL_MS,
  });
  return token;
}

/** Delete the session row and clear the cookie. */
function endSession(res, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** SHA-256 hex digest — how API tokens are stored (never the raw value). */
function hashToken(raw) {
  return require('node:crypto').createHash('sha256').update(raw).digest('hex');
}

/** Look up an `Authorization: Bearer tf_…` personal access token. */
function userFromApiToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const raw = header.slice(7).trim();
  if (!raw) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email
         FROM api_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = ?`
    )
    .get(hashToken(raw));
  if (!row) return null;

  // Keep a lightweight "last used" trail for the tokens screen.
  db.prepare("UPDATE api_tokens SET last_used_at = datetime('now') WHERE token_hash = ?").run(
    hashToken(raw)
  );
  return row;
}

/**
 * Express middleware: reject unauthenticated requests, attach req.user.
 * Accepts either a session cookie (browser) or a bearer API token (scripts).
 */
function requireAuth(req, res, next) {
  const token = getSessionToken(req);

  if (token) {
    const row = db
      .prepare(
        `SELECT u.id, u.name, u.email, s.expires_at
           FROM sessions s
           JOIN users u ON u.id = s.user_id
          WHERE s.token = ?`
      )
      .get(token);

    if (row && row.expires_at > new Date().toISOString()) {
      req.user = { id: row.id, name: row.name, email: row.email };
      req.sessionToken = token;
      return next();
    }
    // Expired or unknown cookie: drop it, then fall through (a bearer token
    // may still be attached to the same request).
    if (row) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  const apiUser = userFromApiToken(req);
  if (apiUser) {
    req.user = { id: apiUser.id, name: apiUser.name, email: apiUser.email };
    req.apiToken = true;
    return next();
  }

  if (token) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }
  return res.status(401).json({ error: 'You need to sign in to do that.' });
}

module.exports = {
  SESSION_COOKIE,
  getSessionToken,
  startSession,
  endSession,
  requireAuth,
  hashToken,
};

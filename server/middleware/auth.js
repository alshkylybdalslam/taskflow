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
    maxAge: SESSION_TTL_MS,
  });
  return token;
}

/** Delete the session row and clear the cookie. */
function endSession(res, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Express middleware: reject unauthenticated requests, attach req.user. */
function requireAuth(req, res, next) {
  const token = getSessionToken(req);
  if (!token) {
    return res.status(401).json({ error: 'You need to sign in to do that.' });
  }

  const row = db
    .prepare(
      `SELECT u.id, u.name, u.email, s.expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token = ?`
    )
    .get(token);

  if (!row || row.expires_at <= new Date().toISOString()) {
    if (row) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  }

  req.user = { id: row.id, name: row.name, email: row.email };
  req.sessionToken = token;
  next();
}

module.exports = {
  SESSION_COOKIE,
  getSessionToken,
  startSession,
  endSession,
  requireAuth,
};

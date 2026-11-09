'use strict';

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const openapiSpec = require('./openapi');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const dashboardRoutes = require('./routes/dashboard');
const labelRoutes = require('./routes/labels');
const tokenRoutes = require('./routes/tokens');
const adminRoutes = require('./routes/admin');
const commentRoutes = require('./routes/comments');
const activityRoutes = require('./routes/activity');

const app = express();

// Trust the first proxy hop (e.g. Render's router / nginx). Required so
// `req.secure` is true on HTTPS, which in turn marks session cookies
// `Secure`. Direct connections (tests, local dev) are unaffected.
app.set('trust proxy', 1);

app.disable('x-powered-by');

// Hardening: strict CSP (script-src 'self' — no inline scripts anywhere),
// no MIME sniffing, no framing, no referrer leakage, HSTS, etc.
app.use(helmet());

// Bound request bodies: oversized payloads are rejected with 413 instead
// of being buffered into memory (see the error handler below).
app.use(express.json({ limit: '64kb' }));

/** Numeric env var: `0` disables the limiter, invalid/empty uses the fallback. */
function envLimit(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Global rate limit per IP for every route (auth endpoints have their own
// tighter limiter on top). Standard `RateLimit-*` headers are sent.
// API_RATE_LIMIT_MAX=0 disables the limiter explicitly.
const apiMax = envLimit('API_RATE_LIMIT_MAX', 1000);
if (apiMax > 0) {
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: apiMax,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests — please try again later.' },
    })
  );
}

// --- API -------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/admin', adminRoutes);
// Label endpoints live under /projects/… and /tasks/… paths:
app.use('/api', labelRoutes);
// Comments have /tasks/:id/comments and /comments/:id paths:
app.use('/api', commentRoutes);
app.use('/api/activity', activityRoutes);

// --- Interactive API documentation ------------------------------------
// The machine-readable spec and the Swagger UI must be mounted BEFORE the
// /api 404 catch-all below. They are public by default (the docs are part
// of the portfolio demo); set DISABLE_DOCS=1 to hide them in production.
if (process.env.DISABLE_DOCS !== '1') {
  app.get('/api/docs.json', (req, res) => res.json(openapiSpec));
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(openapiSpec, {
      customSiteTitle: 'TaskFlow API — docs',
      explorer: false,
    })
  );
}

// Unknown API endpoints must return JSON, never fall through to the SPA.
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

// --- Frontend ---------------------------------------------------------
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// --- Error handling ---------------------------------------------------
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body contains invalid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large (64 KB limit).' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

/** Start the server. Port 0 picks a free port (used by tests). */
function start(port = process.env.PORT || 3000) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.on('error', reject);
  });
}

if (require.main === module) {
  start()
    .then((server) => {
      console.log(`✔ TaskFlow is running at http://localhost:${server.address().port}`);
    })
    .catch((err) => {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    });
}

module.exports = { app, start };

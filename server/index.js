'use strict';

const path = require('node:path');
const express = require('express');

const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const dashboardRoutes = require('./routes/dashboard');
const labelRoutes = require('./routes/labels');
const tokenRoutes = require('./routes/tokens');

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// --- API -------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/tokens', tokenRoutes);
// Label endpoints live under /projects/… and /tasks/… paths:
app.use('/api', labelRoutes);

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

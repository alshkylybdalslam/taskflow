'use strict';

/**
 * Database layer — SQLite via better-sqlite3 (synchronous, zero-config).
 * The database file lives in /data (git-ignored). Tests point DB_PATH to ':memory:'.
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'taskflow.db');

if (DB_PATH !== ':memory:') {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    color       TEXT    NOT NULL DEFAULT '#4f46e5',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title        TEXT    NOT NULL,
    description  TEXT    NOT NULL DEFAULT '',
    status       TEXT    NOT NULL DEFAULT 'todo'
                   CHECK (status IN ('todo', 'in_progress', 'done')),
    priority     TEXT    NOT NULL DEFAULT 'medium'
                   CHECK (priority IN ('low', 'medium', 'high')),
    due_date     TEXT,
    position     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS labels (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT '#6366f1',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (project_id, name)
  );

  -- Many-to-many: tasks <-> labels
  CREATE TABLE IF NOT EXISTS task_labels (
    task_id  INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
    label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, label_id)
  );

  -- Personal access tokens: only the SHA-256 hash is stored, never the raw value.
  CREATE TABLE IF NOT EXISTS api_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT    NOT NULL,
    token_hash   TEXT    NOT NULL UNIQUE,
    prefix       TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    last_used_at TEXT
  );

  -- Threaded discussion under a task.
  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    body       TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Human-readable audit trail. task_id survives task deletion as NULL so a
  -- "task deleted" event keeps its subject and its project.
  CREATE TABLE IF NOT EXISTS activity (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    project_id INTEGER          REFERENCES projects(id) ON DELETE CASCADE,
    task_id    INTEGER          REFERENCES tasks(id)    ON DELETE SET NULL,
    action     TEXT    NOT NULL,
    subject    TEXT    NOT NULL DEFAULT '',
    detail     TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_projects_user   ON projects(user_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_project   ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_due_date  ON tasks(due_date);
  CREATE INDEX IF NOT EXISTS idx_labels_project  ON labels(project_id);
  CREATE INDEX IF NOT EXISTS idx_task_labels_l   ON task_labels(label_id);
  CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id);
  CREATE INDEX IF NOT EXISTS idx_comments_task   ON comments(task_id);
  CREATE INDEX IF NOT EXISTS idx_activity_user   ON activity(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id);
`);

// Migration: databases created before roles existed get the column added.
// DDL is transactional in SQLite — wrapping both statements means a crash
// can never leave an install with the column but no admin.
const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some((c) => c.name === 'role')) {
  db.transaction(() => {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    // Legacy installs have no admin yet — promote the oldest account, the
    // same rule new registrations follow on a fresh database.
    db.exec("UPDATE users SET role = 'admin' WHERE id = (SELECT MIN(id) FROM users)");
  })();
}

module.exports = db;

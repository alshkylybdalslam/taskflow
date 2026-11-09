'use strict';

/**
 * Activity log — a human-readable audit trail rendered as the Activity feed.
 * Screens can be deleted; the feed keeps the subject text so history still
 * reads correctly after a task is removed.
 */

const db = require('./db');

const insert = db.prepare(
  `INSERT INTO activity (user_id, project_id, task_id, action, subject, detail)
   VALUES (?, ?, ?, ?, ?, ?)`
);

/**
 * Record one event. Called inside the same transaction as the change it
 * describes, so the feed can never disagree with the data.
 */
function logActivity({ userId, projectId = null, taskId = null, action, subject = '', detail = '' }) {
  insert.run(userId, projectId, taskId, action, subject, detail);
}

module.exports = { logActivity };

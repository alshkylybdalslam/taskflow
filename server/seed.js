'use strict';

/**
 * Seed the database with a demo account and realistic sample data.
 *   npm run seed          → seed only if the demo account doesn't exist
 *   npm run seed -- --force → wipe and re-seed the demo account
 */

const bcrypt = require('bcryptjs');
const db = require('./db');

const DEMO_EMAIL = 'demo@taskflow.dev';
const DEMO_PASSWORD = 'demo1234';

/** Date as YYYY-MM-DD, offset by n days from today. */
function day(n = 0) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

const PROJECTS = [
  {
    name: 'Website Redesign',
    description: 'Fresh look for the company site — research, design system and rollout.',
    color: '#4f46e5',
    labels: [
      ['Design', '#8b5cf6'],
      ['Research', '#0ea5e9'],
      ['Content', '#10b981'],
      ['Infra', '#f59e0b'],
    ],
    tasks: [
      ['Audit current site and collect analytics', 'done', 'medium', -9, ['Research']],
      ['Competitor research write-up', 'done', 'low', -7, ['Research']],
      ['Build the new design system in Figma', 'done', 'high', -5, ['Design']],
      ['Landing page — hero and social proof', 'in_progress', 'high', 1, ['Design', 'Content']],
      ['Migrate blog posts to the new layout', 'in_progress', 'medium', 3, ['Content']],
      ['Accessibility audit (WCAG 2.2 AA)', 'todo', 'medium', 6, ['Design', 'Research']],
      ['Set up performance budgets in CI', 'todo', 'low', 10, ['Infra']],
      ['Launch checklist and rollback plan', 'todo', 'high', 14, ['Infra']],
    ],
  },
  {
    name: 'Mobile App Launch',
    description: 'Ship the v1 iOS/Android app and grow the first 1,000 users.',
    color: '#0ea5e9',
    labels: [
      ['Engineering', '#6366f1'],
      ['Marketing', '#ef4444'],
      ['QA', '#f59e0b'],
      ['Growth', '#10b981'],
    ],
    tasks: [
      ['Define the v1 feature scope', 'done', 'high', -12, ['Engineering']],
      ['Onboarding flow — screens and copy', 'done', 'high', -8, ['Engineering', 'Growth']],
      ['Push notification service integration', 'in_progress', 'high', 0, ['Engineering']],
      ['App Store screenshots and listing', 'todo', 'medium', 4, ['Marketing']],
      ['Beta test with 20 users', 'todo', 'high', 8, ['QA', 'Growth']],
      ['Crash reporting and analytics setup', 'todo', 'medium', 11, ['Engineering', 'QA']],
      ['Write the privacy policy', 'todo', 'low', 13, ['Marketing']],
    ],
  },
  {
    name: 'Personal Blog',
    description: 'Weekly technical writing — consistency beats intensity.',
    color: '#f59e0b',
    labels: [
      ['Writing', '#10b981'],
      ['Ideas', '#8b5cf6'],
    ],
    tasks: [
      ['Post: "What I learned building a REST API"', 'done', 'medium', -6, ['Writing']],
      ['Post: "SQLite in production — yes, really"', 'done', 'medium', -2, ['Writing']],
      ['Outline next 4 post ideas', 'in_progress', 'low', 2, ['Ideas']],
      ['Draft: "A week with Node.js test runner"', 'todo', 'medium', 5, ['Writing']],
      ['Reply to reader comments', 'todo', 'low', -1, ['Writing']],
    ],
  },
];

function seed() {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL);

  if (existing) {
    if (!process.argv.includes('--force')) {
      console.log('Demo data already exists — nothing to do. Use --force to re-seed.');
      return;
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(existing.id); // cascades to all data
    console.log('Removed previous demo data.');
  }

  const userId = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('Demo User', DEMO_EMAIL, bcrypt.hashSync(DEMO_PASSWORD, 10), 'admin').lastInsertRowid;

  const insertProject = db.prepare(
    'INSERT INTO projects (user_id, name, description, color) VALUES (?, ?, ?, ?)'
  );
  const insertLabel = db.prepare('INSERT INTO labels (project_id, name, color) VALUES (?, ?, ?)');
  const insertTask = db.prepare(
    `INSERT INTO tasks (project_id, title, description, status, priority, due_date, completed_at)
     VALUES (?, ?, '', ?, ?, ?, ?)`
  );
  const linkLabel = db.prepare('INSERT INTO task_labels (task_id, label_id) VALUES (?, ?)');

  let taskCount = 0;
  let labelCount = 0;
  const seedAll = db.transaction(() => {
    for (const project of PROJECTS) {
      const projectId = insertProject.run(userId, project.name, project.description, project.color)
        .lastInsertRowid;

      const labelIds = {};
      for (const [labelName, labelColor] of project.labels || []) {
        labelIds[labelName] = insertLabel.run(projectId, labelName, labelColor).lastInsertRowid;
        labelCount++;
      }

      for (const [title, status, priority, dueOffset, labelNames = []] of project.tasks) {
        const taskId = insertTask.run(
          projectId,
          title,
          status,
          priority,
          day(dueOffset),
          status === 'done' ? new Date(Date.now() + dueOffset * 86400000).toISOString() : null
        ).lastInsertRowid;
        for (const name of labelNames) linkLabel.run(taskId, labelIds[name]);
        taskCount++;
      }
    }
  });
  seedAll();

  console.log(
    `✔ Seeded demo account with ${PROJECTS.length} projects, ${taskCount} tasks and ${labelCount} labels.`
  );
  console.log(`  Sign in with: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
}

seed();

<div align="center">

# ✅ TaskFlow

**A full-stack task & project manager — built with Node.js, Express & SQLite.**

Projects, tasks, priorities, deadlines and a dashboard that tells you exactly where you stand.

[![Node.js](https://img.shields.io/badge/Node.js-18.x-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.x-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite](https://img.shields.io/badge/SQLite-3-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

---

## ✨ Features

- **🔐 Accounts & sessions** — register/login with bcrypt password hashing and httpOnly session cookies
- **📁 Projects** — create colour-coded projects with live progress tracking
- **✔ Tasks** — status (`To do → In progress → Done`), priority, due dates, descriptions
- **🔎 Filtering & search** — by project, status, priority, or free-text search
- **📊 Dashboard** — status donut, 7-day completion trend, per-project progress, upcoming deadlines and overdue alerts — all in a single API round trip
- **📱 Responsive UI** — polished single-page frontend with modals, toasts and empty states
- **🌗 Dark mode** — one-click theme toggle, persisted in `localStorage` and applied before first paint (no flash)
- **🧪 Tested** — integration tests covering auth, CRUD, ownership rules and the dashboard

## 🛠 Tech stack

| Layer      | Technology |
|------------|------------|
| Backend    | Node.js, Express 4 |
| Database   | SQLite via `better-sqlite3` (WAL mode, foreign keys) |
| Auth       | bcryptjs password hashing + opaque session tokens in httpOnly cookies |
| Frontend   | Vanilla JS SPA, hand-rolled SVG/CSS charts (no framework, no chart library) |
| Testing    | Node built-in test runner (`node --test`) + `fetch` |

## 🚀 Quick start

```bash
git clone https://github.com/<your-username>/taskflow.git
cd taskflow
npm install
npm run seed     # optional: demo data
npm start        # → http://localhost:3000
```

**Demo account** (after seeding): `demo@taskflow.dev` / `demo1234`

### Scripts

| Command         | What it does |
|-----------------|--------------|
| `npm start`     | Start the server on port 3000 (`PORT` env overrides) |
| `npm run dev`   | Start with auto-reload on file changes |
| `npm run seed`  | Load demo projects & tasks (`-- --force` to reset) |
| `npm test`      | Run the integration test suite |

## 🔌 API overview

All endpoints are JSON. Protected routes require a session cookie.

| Method | Endpoint                | Description |
|--------|-------------------------|-------------|
| POST   | `/api/auth/register`    | Create an account |
| POST   | `/api/auth/login`       | Sign in |
| POST   | `/api/auth/logout`      | Sign out |
| GET    | `/api/auth/me`          | Current user |
| GET    | `/api/projects`         | List projects with task stats |
| POST   | `/api/projects`         | Create project |
| GET    | `/api/projects/:id`     | One project with task stats |
| PUT    | `/api/projects/:id`     | Update project |
| DELETE | `/api/projects/:id`     | Delete project (cascades tasks) |
| GET    | `/api/tasks`            | List tasks — `?project_id= &status= &priority= &q=` |
| POST   | `/api/tasks`            | Create task |
| PUT    | `/api/tasks/:id`        | Update task (partial) |
| DELETE | `/api/tasks/:id`        | Delete task |
| GET    | `/api/dashboard`        | Summary, charts, deadlines, activity |

### Example

```bash
curl -c jar.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@taskflow.dev","password":"demo1234"}'

curl -b jar.txt http://localhost:3000/api/dashboard
```

## 🏗 Architecture

```
taskflow/
├── server/
│   ├── index.js            # Express app: API → static → SPA fallback
│   ├── db.js               # SQLite connection + schema (migrations-on-boot)
│   ├── seed.js             # Demo data generator
│   ├── middleware/
│   │   └── auth.js         # Sessions, cookies, requireAuth guard
│   └── routes/
│       ├── auth.js         # Register / login / logout / me
│       ├── projects.js     # Project CRUD + stats
│       ├── tasks.js        # Task CRUD + filters + ownership checks
│       └── dashboard.js    # Aggregated stats in one round trip
├── public/                 # Frontend SPA (index.html, styles.css, app.js)
└── tests/
    └── api.test.js         # Integration tests (node --test)
```

**Key design decisions**

- **Layered ownership checks** — every task operation joins back to the owning user, so one user can never touch another's data, even by guessing IDs.
- **Zero-config database** — SQLite file in `/data` (git-ignored); tests run against `:memory:`.
- **One round-trip dashboard** — six aggregate queries composed server-side so the UI renders instantly.
- **Minimal dependencies** — 3 runtime deps total; charts are hand-built SVG/CSS.

## 🗺 Roadmap

- [ ] Drag & drop between statuses
- [ ] Due-date reminders and email notifications
- [ ] Team workspaces and task assignment
- [ ] REST API tokens for third-party access
- [ ] PWA offline support

## 📄 License

MIT — free to use, modify and share.

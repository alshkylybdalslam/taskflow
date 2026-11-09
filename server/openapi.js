'use strict';

/**
 * OpenAPI 3.0.3 description of the TaskFlow REST API.
 *
 * Served two ways:
 *   GET /api/docs.json — the machine-readable spec
 *   GET /api/docs      — interactive Swagger UI
 *
 * Kept as plain data (no annotations in the routes) so the route files stay
 * readable; if an endpoint changes, update it here too.
 */

/* ----------------------------- fragments ----------------------------- */

const ERROR = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
};

const OK = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
};

const id = (description) => ({ type: 'integer', description, example: 1 });

const dateOnly = (description) => ({
  type: 'string',
  nullable: true,
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description,
  example: '2026-11-30',
});

const dateTime = (description) => ({
  type: 'string',
  nullable: true,
  description,
  example: '2026-11-08 12:00:00',
});

const schemas = {
  Error: ERROR,
  Ok: OK,

  User: {
    type: 'object',
    properties: {
      id: id('User id'),
      name: { type: 'string', example: 'Demo User' },
      email: { type: 'string', format: 'email', example: 'demo@taskflow.dev' },
      role: { type: 'string', enum: ['user', 'admin'], description: 'First account on a fresh install becomes admin' },
    },
    required: ['id', 'name', 'email', 'role'],
  },

  TaskLabel: {
    type: 'object',
    properties: {
      id: id('Label id'),
      name: { type: 'string', example: 'backend' },
      color: { type: 'string', example: '#6366f1' },
    },
    required: ['id', 'name', 'color'],
  },

  Task: {
    type: 'object',
    properties: {
      id: id('Task id'),
      project_id: id('Owning project'),
      title: { type: 'string', maxLength: 200, example: 'Write API docs' },
      description: { type: 'string', maxLength: 2000, example: '' },
      status: { type: 'string', enum: ['todo', 'in_progress', 'done'], example: 'todo' },
      priority: { type: 'string', enum: ['low', 'medium', 'high'], example: 'medium' },
      due_date: dateOnly('Due date, null when none'),
      created_at: dateTime('Creation timestamp'),
      updated_at: dateTime('Last update timestamp'),
      completed_at: dateTime('Set when the task flipped to done'),
      project_name: { type: 'string', example: 'Website relaunch' },
      project_color: { type: 'string', example: '#4f46e5' },
      labels: {
        type: 'array',
        items: { $ref: '#/components/schemas/TaskLabel' },
        description: 'Labels attached to this task',
      },
      comment_count: { type: 'integer', description: 'Number of comments on the task', example: 2 },
    },
    required: ['id', 'project_id', 'title', 'status', 'priority', 'labels'],
  },

  Comment: {
    type: 'object',
    properties: {
      id: id('Comment id'),
      task_id: id('Task the comment belongs to'),
      body: { type: 'string', maxLength: 2000, example: 'Looks good — shipping after the review.' },
      created_at: dateTime('Creation timestamp'),
      author: {
        type: 'object',
        properties: {
          id: id('Author user id'),
          name: { type: 'string', example: 'Demo User' },
        },
        required: ['id', 'name'],
      },
    },
    required: ['id', 'task_id', 'body', 'created_at', 'author'],
  },

  ActivityEvent: {
    type: 'object',
    properties: {
      id: id('Event id'),
      action: {
        type: 'string',
        description: 'Event type',
        enum: [
          'project.created',
          'project.updated',
          'task.created',
          'task.updated',
          'task.status_changed',
          'task.completed',
          'task.reopened',
          'task.moved',
          'task.deleted',
          'comment.added',
          'comment.deleted',
        ],
        example: 'task.completed',
      },
      subject: { type: 'string', description: 'Task or project title at event time', example: 'Write API docs' },
      detail: { type: 'string', description: 'Short human-readable context', example: 'todo → done' },
      project_id: id('Owning project'),
      project_name: { type: 'string', example: 'Website relaunch' },
      project_color: { type: 'string', example: '#4f46e5' },
      task_id: { type: 'integer', nullable: true, description: 'Null after the task is deleted' },
      actor_name: { type: 'string', example: 'Demo User' },
      created_at: dateTime('When the event happened'),
    },
    required: ['id', 'action', 'subject', 'project_id', 'created_at'],
  },

  Project: {
    type: 'object',
    properties: {
      id: id('Project id'),
      name: { type: 'string', maxLength: 80, example: 'Website relaunch' },
      description: { type: 'string', maxLength: 500, example: '' },
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', example: '#4f46e5' },
      created_at: dateTime('Creation timestamp'),
      total_tasks: { type: 'integer', example: 12 },
      todo_tasks: { type: 'integer', example: 4 },
      in_progress_tasks: { type: 'integer', example: 3 },
      done_tasks: { type: 'integer', example: 5 },
      overdue_tasks: { type: 'integer', example: 1 },
    },
    required: ['id', 'name', 'color'],
  },

  Label: {
    type: 'object',
    properties: {
      id: id('Label id'),
      project_id: id('Owning project'),
      name: { type: 'string', maxLength: 30, example: 'backend' },
      color: { type: 'string', example: '#6366f1' },
      created_at: dateTime('Creation timestamp'),
      project_name: { type: 'string', example: 'Website relaunch' },
    },
    required: ['id', 'project_id', 'name', 'color'],
  },

  Token: {
    type: 'object',
    properties: {
      id: id('Token id'),
      name: { type: 'string', example: 'CI script' },
      prefix: { type: 'string', description: 'First characters of the secret, for identification', example: 'tf_3f9a1c' },
      created_at: dateTime('Creation timestamp'),
      last_used_at: dateTime('Last successful use'),
    },
    required: ['id', 'name', 'prefix'],
  },

  DashboardSummary: {
    type: 'object',
    properties: {
      total: { type: 'integer', example: 24 },
      todo: { type: 'integer', example: 9 },
      in_progress: { type: 'integer', example: 7 },
      done: { type: 'integer', example: 8 },
      overdue: { type: 'integer', example: 2 },
      due_today: { type: 'integer', example: 3 },
      completion_rate: { type: 'integer', description: 'Percent 0–100', example: 33 },
    },
    required: ['total', 'todo', 'in_progress', 'done', 'overdue', 'due_today', 'completion_rate'],
  },

  Dashboard: {
    type: 'object',
    properties: {
      summary: { $ref: '#/components/schemas/DashboardSummary' },
      byPriority: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            count: { type: 'integer' },
          },
        },
      },
      projects: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: id('Project id'),
            name: { type: 'string' },
            color: { type: 'string' },
            total: { type: 'integer' },
            done: { type: 'integer' },
          },
        },
      },
      upcoming: {
        type: 'array',
        description: 'Next 6 open tasks with a due date',
        items: {
          type: 'object',
          properties: {
            id: id('Task id'),
            title: { type: 'string' },
            due_date: { type: 'string' },
            status: { type: 'string' },
            priority: { type: 'string' },
            project_name: { type: 'string' },
            project_color: { type: 'string' },
          },
        },
      },
      recentCompleted: {
        type: 'array',
        description: 'Last 5 completed tasks',
        items: {
          type: 'object',
          properties: {
            id: id('Task id'),
            title: { type: 'string' },
            completed_at: { type: 'string' },
            project_name: { type: 'string' },
            project_color: { type: 'string' },
          },
        },
      },
      weekly: {
        type: 'array',
        description: 'Gap-free 7-day series of tasks completed per day',
        items: {
          type: 'object',
          properties: {
            day: { type: 'string', example: '2026-11-08' },
            count: { type: 'integer', example: 3 },
          },
        },
      },
    },
    required: ['summary', 'byPriority', 'projects', 'upcoming', 'recentCompleted', 'weekly'],
  },
};

const responses = {
  BadRequest: {
    description: 'Validation failed',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  Unauthorized: {
    description: 'No valid session cookie or bearer token',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  NotFound: {
    description: 'Not found (or not yours)',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  Conflict: {
    description: 'Already exists',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  Forbidden: {
    description: 'Authenticated, but not an admin',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
  TooManyRequests: {
    description: 'Rate limit exceeded — retry after the window resets',
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  },
};

/** Security for every authenticated endpoint: session cookie OR API token. */
const AUTH = [{ cookieAuth: [] }, { bearerAuth: [] }];

const json = (schema) => ({ 'application/json': { schema } });

const sessionCookie = {
  'Set-Cookie': {
    schema: { type: 'string' },
    description:
      'taskflow_session=<opaque token>; HttpOnly; SameSite=Lax; Path=/ (plus Secure over HTTPS)',
  },
};

/** Common path parameter: {id} */
const pathId = (name = 'id') => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'integer' },
  description: 'Resource id',
});

/* ------------------------------ paths ------------------------------- */

const paths = {
  /* ------------------------------ auth ----------------------------- */
  '/api/auth/register': {
    post: {
      tags: ['Auth'],
      summary: 'Create an account',
      description: 'Creates the account, stores a bcrypt hash of the password and starts a session (cookie is set). Rate-limited.',
      security: [],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', minLength: 2, example: 'Demo User' },
            email: { type: 'string', format: 'email', example: 'new@user.dev' },
            password: { type: 'string', minLength: 8, maxLength: 72, example: 'correct horse battery staple' },
          },
        }),
      },
      responses: {
        201: {
          description: 'Account created and signed in',
          headers: { 'Set-Cookie': sessionCookie },
          content: json({ type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        409: { $ref: '#/components/responses/Conflict' },
        429: { $ref: '#/components/responses/TooManyRequests' },
      },
    },
  },

  '/api/auth/login': {
    post: {
      tags: ['Auth'],
      summary: 'Sign in',
      description: 'Verifies credentials and starts a session. Rate-limited per IP to slow brute force.',
      security: [],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email', example: 'demo@taskflow.dev' },
            password: { type: 'string', example: 'demo1234' },
          },
        }),
      },
      responses: {
        200: {
          description: 'Signed in',
          headers: { 'Set-Cookie': sessionCookie },
          content: json({ type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        429: { $ref: '#/components/responses/TooManyRequests' },
      },
    },
  },

  '/api/auth/logout': {
    post: {
      tags: ['Auth'],
      summary: 'Sign out',
      description: 'Destroys the server-side session and clears the cookie. Safe to call when already signed out.',
      security: [],
      responses: {
        200: { description: 'Signed out', content: json({ $ref: '#/components/schemas/Ok' }) },
      },
    },
  },

  '/api/auth/me': {
    get: {
      tags: ['Auth'],
      summary: 'Current user',
      security: AUTH,
      responses: {
        200: {
          description: 'The authenticated user',
          content: json({ type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        429: { $ref: '#/components/responses/TooManyRequests' },
      },
    },
  },

  /* --------------------------- projects ---------------------------- */
  '/api/projects': {
    get: {
      tags: ['Projects'],
      summary: 'List my projects',
      description: 'Every project of the current user with rolled-up task statistics.',
      security: AUTH,
      responses: {
        200: {
          description: 'Projects, newest first',
          content: json({ type: 'object', properties: { projects: { type: 'array', items: { $ref: '#/components/schemas/Project' } } } }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Create a project',
      security: AUTH,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80, example: 'Website relaunch' },
            description: { type: 'string', maxLength: 500, default: '' },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', default: '#4f46e5' },
          },
        }),
      },
      responses: {
        201: {
          description: 'Project created',
          content: json({ type: 'object', properties: { project: { $ref: '#/components/schemas/Project' } } }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/api/projects/{id}': {
    get: {
      tags: ['Projects'],
      summary: 'One project',
      security: AUTH,
      parameters: [pathId()],
      responses: {
        200: {
          description: 'The project with task statistics',
          content: json({ type: 'object', properties: { project: { $ref: '#/components/schemas/Project' } } }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    put: {
      tags: ['Projects'],
      summary: 'Update a project',
      description: 'Partial update — only the fields you send are changed.',
      security: AUTH,
      parameters: [pathId()],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80 },
            description: { type: 'string', maxLength: 500 },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          },
        }),
      },
      responses: {
        200: {
          description: 'Updated project',
          content: json({ type: 'object', properties: { project: { $ref: '#/components/schemas/Project' } } }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    delete: {
      tags: ['Projects'],
      summary: 'Delete a project',
      description: 'Deletes the project; its tasks and labels cascade away.',
      security: AUTH,
      parameters: [pathId()],
      responses: {
        200: { description: 'Deleted', content: json({ $ref: '#/components/schemas/Ok' }) },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  /* ----------------------------- tasks ----------------------------- */
  '/api/tasks': {
    get: {
      tags: ['Tasks'],
      summary: 'List tasks',
      description: 'Open work first, then soonest due date first.',
      security: AUTH,
      parameters: [
        { name: 'project_id', in: 'query', schema: { type: 'integer' }, description: 'Only this project' },
        { name: 'status', in: 'query', schema: { type: 'string', enum: ['todo', 'in_progress', 'done'] } },
        { name: 'priority', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high'] } },
        { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search title and description' },
        { name: 'label_id', in: 'query', schema: { type: 'integer' }, description: 'Tasks carrying this label' },
        { name: 'due', in: 'query', schema: { type: 'string', enum: ['overdue', 'today', 'none'] }, description: 'Deadline filter' },
      ],
      responses: {
        200: {
          description: 'Matching tasks',
          content: json({ type: 'object', properties: { tasks: { type: 'array', items: { $ref: '#/components/schemas/Task' } } } }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    post: {
      tags: ['Tasks'],
      summary: 'Create a task',
      security: AUTH,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['title', 'project_id'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200, example: 'Write API docs' },
            project_id: id('Owning project (must be yours)'),
            description: { type: 'string', maxLength: 2000 },
            status: { type: 'string', enum: ['todo', 'in_progress', 'done'], default: 'todo' },
            priority: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
            due_date: dateOnly('Due date'),
            label_ids: { type: 'array', items: { type: 'integer' }, description: 'Labels to attach (must belong to the project)' },
          },
        }),
      },
      responses: {
        201: {
          description: 'Task created',
          content: json({ type: 'object', properties: { task: { $ref: '#/components/schemas/Task' } } }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/api/tasks/{id}': {
    put: {
      tags: ['Tasks'],
      summary: 'Update a task',
      description: 'Partial update. Sending `status` flips `completed_at`; sending `label_ids` replaces label assignments.',
      security: AUTH,
      parameters: [pathId()],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            description: { type: 'string', maxLength: 2000 },
            status: { type: 'string', enum: ['todo', 'in_progress', 'done'] },
            priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            due_date: dateOnly('Due date'),
            project_id: id('Move to another project you own'),
            label_ids: { type: 'array', items: { type: 'integer' }, description: 'Replaces current assignments' },
          },
        }),
      },
      responses: {
        200: {
          description: 'Updated task',
          content: json({ type: 'object', properties: { task: { $ref: '#/components/schemas/Task' } } }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    delete: {
      tags: ['Tasks'],
      summary: 'Delete a task',
      security: AUTH,
      parameters: [pathId()],
      responses: {
        200: { description: 'Deleted', content: json({ $ref: '#/components/schemas/Ok' }) },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  /* ----------------------------- labels ---------------------------- */
  '/api/labels': {
    get: {
      tags: ['Labels'],
      summary: 'All my labels',
      description: 'Labels across every project of the current user — used by the sidebar filters.',
      security: AUTH,
      responses: {
        200: {
          description: 'Labels grouped by project',
          content: json({ type: 'object', properties: { labels: { type: 'array', items: { $ref: '#/components/schemas/Label' } } } }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/api/labels/{id}': {
    delete: {
      tags: ['Labels'],
      summary: 'Delete a label',
      description: 'Removes the label and every assignment of it.',
      security: AUTH,
      parameters: [pathId()],
      responses: {
        200: { description: 'Deleted', content: json({ $ref: '#/components/schemas/Ok' }) },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/api/projects/{id}/labels': {
    get: {
      tags: ['Labels'],
      summary: 'Labels of one project',
      security: AUTH,
      parameters: [pathId()],
      responses: {
        200: {
          description: 'Project labels, alphabetical',
          content: json({ type: 'object', properties: { labels: { type: 'array', items: { $ref: '#/components/schemas/Label' } } } }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    post: {
      tags: ['Labels'],
      summary: 'Create a label in a project',
      security: AUTH,
      parameters: [pathId()],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 30, example: 'backend' },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', default: '#6366f1' },
          },
        }),
      },
      responses: {
        201: {
          description: 'Label created',
          content: json({ type: 'object', properties: { label: { $ref: '#/components/schemas/Label' } } }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
        409: { $ref: '#/components/responses/Conflict' },
      },
    },
  },

  '/api/tasks/{id}/labels': {
    post: {
      tags: ['Labels'],
      summary: 'Attach a label to a task',
      security: AUTH,
      parameters: [pathId()],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['label_id'],
          properties: { label_id: id('Label from the same project') },
        }),
      },
      responses: {
        201: {
          description: 'The task’s labels after attaching',
          content: json({ type: 'object', properties: { labels: { type: 'array', items: { $ref: '#/components/schemas/TaskLabel' } } } }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/api/tasks/{id}/labels/{labelId}': {
    delete: {
      tags: ['Labels'],
      summary: 'Detach a label from a task',
      security: AUTH,
      parameters: [pathId(), pathId('labelId')],
      responses: {
        200: { description: 'Detached', content: json({ $ref: '#/components/schemas/Ok' }) },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  /* --------------------------- comments --------------------------- */
  '/api/tasks/{id}/comments': {
    get: {
      tags: ['Comments'],
      summary: 'List a task’s comments',
      description: 'Oldest first. A task is visible only to the owner of its project.',
      security: AUTH,
      parameters: [pathId()],
      responses: {
        200: {
          description: 'Comments on the task',
          content: json({
            type: 'object',
            properties: { comments: { type: 'array', items: { $ref: '#/components/schemas/Comment' } } },
          }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    post: {
      tags: ['Comments'],
      summary: 'Add a comment',
      security: AUTH,
      parameters: [pathId()],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['body'],
          properties: { body: { type: 'string', minLength: 1, maxLength: 2000, example: 'On it.' } },
        }),
      },
      responses: {
        201: {
          description: 'The new comment',
          content: json({
            type: 'object',
            properties: { comment: { $ref: '#/components/schemas/Comment' } },
          }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  '/api/comments/{id}': {
    delete: {
      tags: ['Comments'],
      summary: 'Delete a comment',
      security: AUTH,
      parameters: [pathId()],
      responses: {
        200: { description: 'Deleted', content: json({ $ref: '#/components/schemas/Ok' }) },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  /* --------------------------- activity --------------------------- */
  '/api/activity': {
    get: {
      tags: ['Activity'],
      summary: 'Recent activity across my projects',
      description: 'Newest first. Deleted tasks keep their events (the task id becomes null).',
      security: AUTH,
      parameters: [
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } },
        { name: 'project_id', in: 'query', schema: { type: 'integer' }, description: 'Only this project' },
      ],
      responses: {
        200: {
          description: 'Activity events',
          content: json({
            type: 'object',
            properties: {
              activity: { type: 'array', items: { $ref: '#/components/schemas/ActivityEvent' } },
            },
          }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  /* ----------------------------- tokens ---------------------------- */
  '/api/tokens': {
    get: {
      tags: ['Tokens'],
      summary: 'List my API tokens',
      description: 'Never returns the secret — only prefix and metadata.',
      security: AUTH,
      responses: {
        200: {
          description: 'Tokens, newest first',
          content: json({ type: 'object', properties: { tokens: { type: 'array', items: { $ref: '#/components/schemas/Token' } } } }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
    post: {
      tags: ['Tokens'],
      summary: 'Mint an API token',
      description:
        'Returns the raw secret exactly once (`tf_` + 40 hex). Only its SHA-256 hash is stored — like a password, it cannot be recovered. Send it as `Authorization: Bearer tf_…`.',
      security: AUTH,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', pattern: '^[\\w][\\w .\\-]{0,59}$', example: 'CI script' } },
        }),
      },
      responses: {
        201: {
          description: 'Token minted — copy `secret` now',
          content: json({
            type: 'object',
            properties: {
              token: { $ref: '#/components/schemas/Token' },
              secret: { type: 'string', example: 'tf_3f9a1c…' },
              warning: { type: 'string', example: 'Copy this now — it will never be shown again.' },
            },
            required: ['token', 'secret'],
          }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  '/api/tokens/{id}': {
    delete: {
      tags: ['Tokens'],
      summary: 'Revoke an API token',
      security: AUTH,
      parameters: [pathId()],
      responses: {
        200: { description: 'Revoked', content: json({ $ref: '#/components/schemas/Ok' }) },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },

  /* --------------------------- dashboard --------------------------- */
  '/api/dashboard': {
    get: {
      tags: ['Dashboard'],
      summary: 'Everything the dashboard needs',
      description: 'One client request: summary numbers, priority split, per-project progress, upcoming deadlines, recent completions and a 7-day completion series (six fast SQLite queries behind the scenes).',
      security: AUTH,
      responses: {
        200: {
          description: 'Dashboard payload',
          content: json({ $ref: '#/components/schemas/Dashboard' }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
      },
    },
  },

  /* ------------------------------ admin ---------------------------- */
  '/api/admin/stats': {
    get: {
      tags: ['Admin'],
      summary: 'Platform-wide statistics',
      description: 'Counters across every account (users, projects, tasks, tokens, active sessions).',
      security: AUTH,
      responses: {
        200: {
          description: 'Global counters',
          content: json({
            type: 'object',
            properties: {
              stats: {
                type: 'object',
                properties: {
                  users: { type: 'integer' },
                  admins: { type: 'integer' },
                  projects: { type: 'integer' },
                  tasks: { type: 'integer' },
                  labels: { type: 'integer' },
                  api_tokens: { type: 'integer' },
                  sessions: { type: 'integer' },
                  done_tasks: { type: 'integer' },
                },
              },
            },
          }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
  },

  '/api/admin/users': {
    get: {
      tags: ['Admin'],
      summary: 'List every user',
      description: 'Users with their role and activity counts. Never exposes password hashes — just account metadata.',
      security: AUTH,
      responses: {
        200: {
          description: 'All users, oldest first',
          content: json({
            type: 'object',
            properties: {
              users: {
                type: 'array',
                items: {
                  allOf: [
                    { $ref: '#/components/schemas/User' },
                    {
                      type: 'object',
                      properties: {
                        created_at: dateTime('Account creation'),
                        projects: { type: 'integer' },
                        tasks: { type: 'integer' },
                        active_sessions: { type: 'integer' },
                      },
                    },
                  ],
                },
              },
            },
          }),
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
      },
    },
    post: {
      tags: ['Admin'],
      summary: 'Create a user',
      description: 'Admin onboarding: creates an account with a name, email and password. The new user signs in through the normal login endpoint — no session is started here. Rate limit budget is reserved for the public auth endpoints.',
      security: AUTH,
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 80, example: 'Grace Hopper' },
            email: { type: 'string', format: 'email', example: 'grace@taskflow.dev' },
            password: { type: 'string', minLength: 8, maxLength: 72, example: 'correct horse battery staple' },
            role: { type: 'string', enum: ['user', 'admin'], default: 'user', description: 'Optional — grant admin immediately' },
          },
        }),
      },
      responses: {
        201: {
          description: 'Account created (no session — sign in separately)',
          content: json({ type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        409: { $ref: '#/components/responses/Conflict' },
      },
    },
  },

  '/api/admin/users/{id}': {
    put: {
      tags: ['Admin'],
      summary: 'Change a user’s role',
      description: 'Promote to `admin` or demote to `user`. You can never change your own role (lock-out protection).',
      security: AUTH,
      parameters: [pathId()],
      requestBody: {
        required: true,
        content: json({
          type: 'object',
          required: ['role'],
          properties: { role: { type: 'string', enum: ['user', 'admin'] } },
        }),
      },
      responses: {
        200: {
          description: 'Role updated',
          content: json({ type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } }),
        },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
    delete: {
      tags: ['Admin'],
      summary: 'Delete a user',
      description: 'Removes the account; their projects, tasks, labels, tokens and sessions cascade away. You cannot delete yourself.',
      security: AUTH,
      parameters: [pathId()],
      responses: {
        200: { description: 'Deleted', content: json({ $ref: '#/components/schemas/Ok' }) },
        400: { $ref: '#/components/responses/BadRequest' },
        401: { $ref: '#/components/responses/Unauthorized' },
        403: { $ref: '#/components/responses/Forbidden' },
        404: { $ref: '#/components/responses/NotFound' },
      },
    },
  },
};

/* ------------------------------ spec -------------------------------- */

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'TaskFlow API',
    version: '1.0.0',
    description:
      'REST API behind **TaskFlow**, a full-stack task & project manager.\n\n' +
      'Authenticate with a session cookie (browser sign-in) or a personal ' +
      'access token sent as `Authorization: Bearer tf_…` (mint one at ' +
      '`POST /api/tokens`). All endpoints are rate-limited and return JSON ' +
      'errors of the shape `{ "error": "…" }`.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/', description: 'This server' }],
  tags: [
    { name: 'Auth', description: 'Accounts and sessions' },
    { name: 'Projects', description: 'Projects with rolled-up task stats' },
    { name: 'Tasks', description: 'Task CRUD with filters' },
    { name: 'Labels', description: 'Project-scoped labels attached to tasks' },
    { name: 'Comments', description: 'Discussion threads under tasks' },
    { name: 'Activity', description: 'Audit trail across projects' },
    { name: 'Tokens', description: 'Personal access tokens for scripts' },
    { name: 'Dashboard', description: 'Aggregated stats in one request' },
    { name: 'Admin', description: 'Platform stats & user management (admin role only)' },
  ],
  paths,
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'taskflow_session',
        description: 'Session cookie set by `/api/auth/login` or `/api/auth/register`.',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'Personal access token from `POST /api/tokens` (shown once at creation).',
      },
    },
    schemas,
    responses,
  },
};

module.exports = spec;

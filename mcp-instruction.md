# Implement an MCP Server for the Todo Webapp

## Goal

Add a Model Context Protocol (MCP) server to the todo webapp so Claude (via Claude.ai connectors, Claude Code, or the Claude API) can read and manage tasks directly — without a proxy or hand-written tool definitions.

## What to build

A standalone MCP server process (TypeScript) that:
- Wraps the existing webapp REST API
- Exposes todo operations as MCP tools
- Exposes task lists as MCP resources
- Supports both **stdio** (for Claude Code) and **Streamable HTTP** (for Claude.ai connectors and the Claude API)
- Handles auth server-side so credentials never leave the backend

---

## Assumptions

- You already know the webapp's full REST API surface (routes, request/response shapes, auth mechanism).
- The webapp is a Node.js/TypeScript project, or the MCP server can live alongside it as a sibling package.
- Auth is via an API key or Bearer token stored in an environment variable (`TODO_API_KEY`).

---

## Step 1 — Scaffold the MCP server package

Create a new directory `mcp-server/` at the repo root (or inside `packages/` if this is a monorepo).

```
mcp-server/
  src/
    index.ts        ← entry point, wires transport
    tools.ts        ← all tool registrations
    resources.ts    ← all resource registrations
    client.ts       ← thin wrapper around the webapp REST API
  package.json
  tsconfig.json
```

Install dependencies:

```bash
npm install @modelcontextprotocol/sdk zod
npm install -D typescript @types/node tsx
```

`package.json` scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts"
  }
}
```

`tsconfig.json` — use `"module": "Node16"` and `"moduleResolution": "Node16"`.

---

## Step 2 — Build the API client (`src/client.ts`)

Create a typed wrapper around the webapp REST API. This is the **only** file that knows the base URL and injects the auth header. All tools call through this client — never fetch the API directly from tools.

```typescript
// src/client.ts
const BASE_URL = process.env.TODO_API_URL ?? 'http://localhost:3000';
const API_KEY  = process.env.TODO_API_KEY ?? '';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  // Tasks
  listTasks:   (params?: { list?: string; status?: string }) =>
    request<Task[]>('GET', '/tasks' + toQuery(params)),
  getTask:     (id: string) =>
    request<Task>('GET', `/tasks/${id}`),
  createTask:  (body: CreateTaskInput) =>
    request<Task>('POST', '/tasks', body),
  updateTask:  (id: string, body: Partial<Task>) =>
    request<Task>('PATCH', `/tasks/${id}`, body),
  deleteTask:  (id: string) =>
    request<void>('DELETE', `/tasks/${id}`),

  // Lists / projects
  listLists:   () =>
    request<TaskList[]>('GET', '/lists'),
  createList:  (body: { name: string }) =>
    request<TaskList>('POST', '/lists', body),
};

function toQuery(p?: Record<string, string | undefined>) {
  if (!p) return '';
  const q = new URLSearchParams(
    Object.entries(p).filter(([, v]) => v !== undefined) as [string, string][]
  ).toString();
  return q ? `?${q}` : '';
}

// Types — mirror exactly what the webapp API returns
export interface Task {
  id: string;
  title: string;
  notes?: string;
  list?: string;
  priority?: 'p1' | 'p2' | 'p3' | null;
  status: 'todo' | 'in_progress' | 'done';
  tags: string[];
  created_at: string;
  updated_at: string;
}
export interface TaskList { id: string; name: string; task_count: number }
export type CreateTaskInput = Pick<Task, 'title'> & Partial<Omit<Task, 'id' | 'created_at' | 'updated_at'>>
```

> **Note:** Align the types above to the webapp's actual response shapes. If the API returns snake_case, keep snake_case here.

---

## Step 3 — Register tools (`src/tools.ts`)

Register one tool per distinct action. Use Zod for input schemas — the SDK converts these to JSON Schema automatically.

Tool naming convention: `verb_noun` in snake_case (e.g. `list_tasks`, `update_task`).
Descriptions must be written for Claude to understand **when** to call the tool, not just what it does.

```typescript
// src/tools.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { api } from './client.js';

export function registerTools(server: McpServer) {

  // ── READ ────────────────────────────────────────────────────────────────

  server.registerTool('list_tasks', {
    title: 'List tasks',
    description: 'Return all tasks, optionally filtered by list name or status. Use this before any bulk operation so you know current task IDs.',
    inputSchema: {
      list:   z.string().optional().describe('Filter by list/project name'),
      status: z.enum(['todo', 'in_progress', 'done']).optional().describe('Filter by status'),
    },
  }, async (input) => {
    const tasks = await api.listTasks(input);
    return { content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }] };
  });

  server.registerTool('get_task', {
    title: 'Get task',
    description: 'Get full details for a single task by its ID.',
    inputSchema: { id: z.string().describe('Task ID') },
  }, async ({ id }) => {
    const task = await api.getTask(id);
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  });

  // ── CREATE ──────────────────────────────────────────────────────────────

  server.registerTool('create_task', {
    title: 'Create task',
    description: 'Create a new task. Returns the created task with its assigned ID.',
    inputSchema: {
      title:    z.string().describe('Task title'),
      list:     z.string().optional().describe('List or project to add the task to'),
      priority: z.enum(['p1', 'p2', 'p3']).optional().describe('p1 = urgent, p2 = normal, p3 = low'),
      tags:     z.array(z.string()).optional().describe('Labels to apply'),
      notes:    z.string().optional().describe('Additional notes or description'),
    },
  }, async (input) => {
    const task = await api.createTask(input);
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  });

  // ── UPDATE ──────────────────────────────────────────────────────────────

  server.registerTool('update_task', {
    title: 'Update task',
    description: 'Update one or more fields on an existing task. Only supply the fields you want to change.',
    inputSchema: {
      id:       z.string().describe('Task ID to update'),
      title:    z.string().optional(),
      notes:    z.string().optional(),
      list:     z.string().optional().describe('Move task to a different list'),
      priority: z.enum(['p1', 'p2', 'p3', 'none']).optional(),
      status:   z.enum(['todo', 'in_progress', 'done']).optional(),
      tags:     z.array(z.string()).optional().describe('Replace the full tags array'),
    },
  }, async ({ id, ...fields }) => {
    const task = await api.updateTask(id, fields);
    return { content: [{ type: 'text', text: JSON.stringify(task, null, 2) }] };
  });

  // ── DELETE ──────────────────────────────────────────────────────────────

  server.registerTool('delete_task', {
    title: 'Delete task',
    description: 'Permanently delete a task by ID. This cannot be undone — confirm with the user before calling.',
    inputSchema: { id: z.string().describe('Task ID to delete') },
  }, async ({ id }) => {
    await api.deleteTask(id);
    return { content: [{ type: 'text', text: `Task ${id} deleted.` }] };
  });

  // ── LISTS ───────────────────────────────────────────────────────────────

  server.registerTool('list_lists', {
    title: 'List task lists',
    description: 'Return all available lists/projects. Call this to discover valid list names before moving tasks.',
    inputSchema: {},
  }, async () => {
    const lists = await api.listLists();
    return { content: [{ type: 'text', text: JSON.stringify(lists, null, 2) }] };
  });

  server.registerTool('create_list', {
    title: 'Create list',
    description: 'Create a new task list or project.',
    inputSchema: { name: z.string().describe('List name') },
  }, async ({ name }) => {
    const list = await api.createList({ name });
    return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] };
  });
}
```

**Error handling pattern** — wrap every tool handler body:

```typescript
  }, async (input) => {
    try {
      const result = await api.someCall(input);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  });
```

Add this pattern to every tool registration. Claude uses `isError: true` to decide whether to retry or surface the error to the user.

---

## Step 4 — Register resources (`src/resources.ts`)

Resources give Claude read access to task data as addressable URIs. Claude can read these proactively without being asked to call a tool.

```typescript
// src/resources.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { api } from './client.js';

export function registerResources(server: McpServer) {

  // All tasks as a single readable resource
  server.registerResource(
    'all-tasks',
    'todo://tasks',
    {
      title: 'All tasks',
      description: 'Complete list of all tasks across all lists',
      mimeType: 'application/json',
    },
    async () => {
      const tasks = await api.listTasks();
      return {
        contents: [{
          uri: 'todo://tasks',
          mimeType: 'application/json',
          text: JSON.stringify(tasks, null, 2),
        }],
      };
    }
  );

  // All lists
  server.registerResource(
    'all-lists',
    'todo://lists',
    {
      title: 'Task lists',
      description: 'All available task lists and their task counts',
      mimeType: 'application/json',
    },
    async () => {
      const lists = await api.listLists();
      return {
        contents: [{
          uri: 'todo://lists',
          mimeType: 'application/json',
          text: JSON.stringify(lists, null, 2),
        }],
      };
    }
  );
}
```

---

## Step 5 — Wire transport in `src/index.ts`

Support both transports from a single entry point, controlled by the `MCP_TRANSPORT` env var.

```typescript
// src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';

const server = new McpServer({
  name: 'todo-mcp-server',
  version: '1.0.0',
});

registerTools(server);
registerResources(server);

const transport = process.env.MCP_TRANSPORT ?? 'stdio';

if (transport === 'http') {
  // ── Streamable HTTP (Claude.ai connectors, Claude API) ──────────────────
  const PORT = parseInt(process.env.PORT ?? '3100', 10);
  const app = express();
  app.use(express.json());

  const httpTransport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(httpTransport);

  app.post('/mcp', (req, res) => httpTransport.handleRequest(req, res));
  app.get('/mcp', (req, res) => httpTransport.handleRequest(req, res));   // SSE stream

  app.listen(PORT, () => {
    console.error(`Todo MCP server listening on http://localhost:${PORT}/mcp`);
  });

} else {
  // ── stdio (Claude Code, local) ──────────────────────────────────────────
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error('Todo MCP server running on stdio');
}
```

> Install `express` and `@types/express` for the HTTP transport path.

---

## Step 6 — Add auth middleware (HTTP transport only)

When running over HTTP, validate that requests carry the expected API key so the MCP endpoint isn't open to the internet.

Add this before the `/mcp` route handlers:

```typescript
const MCP_SECRET = process.env.MCP_SERVER_SECRET;
if (MCP_SECRET) {
  app.use('/mcp', (req, res, next) => {
    const auth = req.headers['authorization'] ?? '';
    if (auth !== `Bearer ${MCP_SECRET}`) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  });
}
```

Set `MCP_SERVER_SECRET` in production. Claude.ai will send this as the Bearer token when you configure the custom connector.

---

## Step 7 — Environment variables

Create `.env.example` at `mcp-server/`:

```
# URL of the todo webapp API
TODO_API_URL=http://localhost:3000

# API key the MCP server uses to authenticate with the webapp
TODO_API_KEY=your-webapp-api-key-here

# Transport: "stdio" for Claude Code, "http" for Claude.ai / Claude API
MCP_TRANSPORT=stdio

# Port for HTTP transport (default 3100)
PORT=3100

# Secret Claude.ai must send as Bearer token (HTTP transport only)
MCP_SERVER_SECRET=
```

Never commit `.env`. Copy to `.env` and fill in values.

---

## Step 8 — Connect to Claude Code (stdio)

Add the server to your Claude Code config (`.claude.json` or via the CLI):

```bash
claude mcp add --transport stdio todo-mcp \
  -- node /path/to/mcp-server/dist/index.js
```

Or with environment variables:

```bash
claude mcp add --transport stdio todo-mcp \
  -e TODO_API_URL=http://localhost:3000 \
  -e TODO_API_KEY=your-key \
  -- tsx /path/to/mcp-server/src/index.ts
```

Verify Claude Code sees the tools:

```bash
claude mcp list
```

---

## Step 9 — Connect to Claude.ai as a custom connector (HTTP transport)

1. Start the server with `MCP_TRANSPORT=http` (and set `MCP_SERVER_SECRET`).
2. Expose the port publicly (or use a tunnel like `ngrok` for local testing).
3. In Claude.ai → **Settings** → **Connectors** → **Add custom connector**:
   - Name: `Todo`
   - URL: `https://your-server.example.com/mcp`
   - Auth: Bearer token → paste `MCP_SERVER_SECRET`
4. Click **Connect**. Claude will call `POST /mcp` to discover tools automatically.

---

## Step 10 — Verify end-to-end

Once connected, test with these prompts in Claude.ai or Claude Code:

```
List all my tasks
```
```
Move all p1 tasks to the "urgent" list
```
```
Create a task called "Review MCP implementation" in the work list with p2 priority
```
```
Mark task <id> as done
```

Expected: Claude calls the appropriate tools, executes them against your webapp, and reports results. No proxy, no copy-paste.

---

## File checklist

```
mcp-server/
  src/
    index.ts        ✓ transport wiring (stdio + HTTP)
    tools.ts        ✓ list_tasks, get_task, create_task, update_task, delete_task, list_lists, create_list
    resources.ts    ✓ todo://tasks, todo://lists
    client.ts       ✓ typed REST wrapper with auth injection
  .env.example      ✓
  package.json      ✓
  tsconfig.json     ✓
  README.md         ← add connection instructions for your team
```

---

## References

- MCP TypeScript SDK: https://ts.sdk.modelcontextprotocol.io
- MCP server transport spec: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- Claude.ai custom connectors: https://support.claude.com
- Claude Code MCP config: https://code.claude.com/docs/en/mcp

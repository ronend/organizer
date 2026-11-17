# coo MCP Server

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server (name
`coo`) that wraps the coo household app's API (`GET /api/state`, `POST /api/batch`,
`POST /api/documents`, `GET /api/registry`).
It lets Claude — via Claude Code, Claude.ai connectors, or the Claude API — read
the household agenda, people, cars, routines and trips, and make small changes to
tasks.

**Auth is per-user pass-through.** The caller's Cognito access token flows through
the MCP server to the coo API, so records stay owned by the real user — the
MCP server never holds shared credentials. Over HTTP the token comes from the
request; over stdio it comes from `COO_API_KEY`.

## What it exposes

Every tool reads the whole state with `GET /api/state` and projects it; task
tools then send the full, modified record with `POST /api/batch` (the API
upserts). `add_document` only resolves names to ids and posts to
`POST /api/documents`, where the document rules live.

**Tools**

| Tool                    | Purpose |
|-------------------------|---------|
| `get_agenda(filter?)`   | Open tasks in `overdue` / `today` / `next_7_days` (1–7 days) / `later` (8+ days or no date), sorted by date then manual order. Each row: id, title, date, who (person, car "makeModel (plate)", "Trip: name" or "General"), routine title, `appointment` flag. Dated open sub-tasks are rows of their own (id `<task id>~<sub-task id>`, with `subtaskOf` = the parent's title). `filter`: `everything` (default), `general`, or a person / car (name or plate) / trip name. |
| `list_people_and_cars()`| People and cars with ids |
| `list_routines()`       | Routines with their assignees (subject name, date, done) |
| `list_trips()`          | Trips, soonest first, with travelers and reservation counts |
| `get_trip(name_or_id)`  | One trip with its reservations (sorted by start) and open trip tasks |
| `add_task(title, date?, who?, notes?, subtasks?)` | New plain task; `date` defaults to today, `who` is a person name, car name/plate, or `general` (default); `subtasks` is an optional list of checklist titles |
| `complete_task(task_id)` | Marks a plain task (or a `<task>~<sub-task>` sub-task) done. Refuses routine steps that need input (`schedule` / `renew` / `pickup`) and trip booking tasks — those are finished in the app |
| `reschedule_task(task_id, date)` | Moves a task to a new date. Refuses booked appointments |
| `list_document_types()` | Which documents each subject type (person, car, ...) can hold, from the API's registry: categories, types, which `add_document` parameters each uses, detail fields per type, pin label/default, renewal reminder defaults |
| `add_document(subject, name?, category?, type?, valid_until?, date?, id_number?, issuer?, issue_date?, details?, provider?, about?, episode?, routine?, pin?, remind?, remind_days?, keep_both?)` | Adds a document to any subject (person name, car make/model or plate). `category` is inferred when the subject holds one kind or the type settles it. Posts to `POST /api/documents`, which applies the rules: `routine` links a routine (IDs and car documents archive the older one of that type on it; IDs move it to the new expiry; open "add the document" tasks close); IDs with an expiry get renewal reminders unless `remind` is false; a second active ID of a type is refused until you pass `routine` (replace) or `keep_both`. No files over MCP |

> `add_task` takes `who` rather than `for` — `for` is a Python keyword, and
> FastMCP maps tool arguments straight onto the function's parameters.

**Resources**

- `coo://state` — the full state as JSON
- `coo://agenda` — the current agenda (same shape as `get_agenda`)

> **Data model:** see [frontend/src/types/coo.ts](../frontend/src/types/coo.ts)
> (the contract) and [data-structure.md](../data-structure.md) (storage + API).
> The pure projection/mutation logic lives in [src/logic.py](src/logic.py).

Implemented in Python with the [`mcp`](https://pypi.org/project/mcp/) SDK
(FastMCP) — matching the webapp's Python/FastAPI backend.

## Setup

```bash
cd mcp-server
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # then fill in values
```

Run it:

```bash
.venv/bin/python -m src            # stdio (default)
MCP_TRANSPORT=http .venv/bin/python -m src   # Streamable HTTP
```

### Environment

See [.env.example](.env.example). Key points:

- **`COO_API_URL`** — the coo API base URL. Use the **CloudFront URL** (it
  injects `x-origin-verify`, so leave `COO_ORIGIN_SECRET` blank) or a Lambda
  Function URL directly (then set `COO_ORIGIN_SECRET`). *In the deployed Lambda,
  SAM sets this to the API (`OrganizerFunction`) Function URL.*
- **`COO_API_KEY`** — a **Cognito access token**, used as the bearer **only over
  stdio** (Claude Code). Over HTTP the caller's own token is forwarded instead.
  Tokens expire ~1h.
- **`ORIGIN_SECRET`** — if set (HTTP), requests must carry a matching
  `x-origin-verify` header (CloudFront injects it). Blocks direct Function URL
  access. *Set by SAM in the deployed Lambda.*
- **`COGNITO_USER_POOL_ID`** — if set (HTTP), the server validates the caller's
  Cognito access token before any tool runs. *Set by SAM in the deployed Lambda;
  `AWS_REGION` is provided automatically.*
- **`COO_TIMEZONE`** — IANA zone (e.g. `Asia/Jerusalem`) that decides what
  "today" is for `get_agenda` / `add_task`. Defaults to UTC. Not set by SAM; add
  it to `MCPFunction`'s environment if the household isn't on UTC.

> These were previously `TODO_API_URL` / `TODO_API_KEY` / `TODO_ORIGIN_SECRET`;
> update any existing `.env` or `claude mcp add` registration.

#### Getting a Cognito access token (for stdio `COO_API_KEY`, or to test HTTP)

Any valid access token for a user in the pool works, e.g. via the AWS CLI:

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <UserPoolClientId> \
  --auth-parameters USERNAME=user@example.com,PASSWORD=... \
  --query 'AuthenticationResult.AccessToken' --output text
```

(`USER_PASSWORD_AUTH` must be enabled on the app client.)

## Tests

```bash
cd mcp-server
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest -q tests
```

The document tests run against the household captured from the frontend
(`backend/tests/fixtures/frontend_state.json`) and validate every record with the
backend's models.

## Connect to Claude Code (stdio)

```bash
claude mcp add --transport stdio coo \
  -e COO_API_URL=https://your-cloudfront-domain \
  -e COO_API_KEY=your-cognito-access-token \
  -e PYTHONPATH=/absolute/path/to/mcp-server \
  -- /absolute/path/to/mcp-server/.venv/bin/python -m src
```

> `PYTHONPATH` points at the `mcp-server` directory so `python -m src` resolves
> the `src` package regardless of the launch working directory.

Verify:

```bash
claude mcp list
```

## Deploy to AWS (HTTP, behind CloudFront)

The MCP server deploys as a **Lambda behind the existing CloudFront distribution
at `/mcp`** — defined in [iac/template.yaml](../iac/template.yaml) (`MCPFunction`,
the `MCPOrigin`, and the `/mcp` cache behavior), in the same SAM stack as the API.

Runtime shape:
- Streamable HTTP in **stateless + JSON-response** mode (serverless-friendly:
  each request is self-contained, no SSE session to keep alive), wrapped with
  **Mangum** in [src/handler.py](src/handler.py).
- The endpoint is gated in-app by **origin-verify** (CloudFront's `x-origin-verify`)
  then **Cognito** (the caller's access token is validated) — no separate MCP secret.
- That same caller token is forwarded to the coo API (per-user pass-through).

```
Claude.ai / API ──Bearer Cognito token──► CloudFront /mcp ──(+x-origin-verify)──► MCPFunction
                                                                                      │ forwards caller token
                                                                                      ▼
                                                                          OrganizerFunction URL (coo API)
```

Deploy happens via the existing **Deploy Backend** GitHub Action (it now also
triggers on `mcp-server/**`), which runs `sam build --use-container && sam deploy`.
To deploy manually from `iac/`:

```bash
sam build --use-container
sam deploy --no-confirm-changeset --parameter-overrides AppUrl=https://<cloudfront-domain>
```

After deploy, the stack output **`MCPUrl`** is your connector URL
(`https://<cloudfront-domain>/mcp`).

### OAuth discovery

The endpoint implements **OAuth 2.0 discovery** so clients can log the user in
themselves (no token pasting). On an unauthenticated call it returns
`401` with a `WWW-Authenticate` challenge pointing at RFC 9728 protected-resource
metadata, served at `/.well-known/oauth-protected-resource/mcp`:

```jsonc
{
  "resource": "https://<domain>/mcp",
  "authorization_servers": ["https://cognito-idp.<region>.amazonaws.com/<UserPoolId>"],
  "scopes_supported": ["openid", "email"]
}
```

The client then reads **Cognito's** own authorization-server metadata
(`<issuer>/.well-known/openid-configuration`) to find the `authorize`/`token`
endpoints (the Cognito hosted UI), runs the authorization-code + PKCE flow, and
calls `/mcp` with the resulting Cognito access token — refreshing it automatically.

This is wired via FastMCP's built-in auth (`AuthSettings` + a `CognitoTokenVerifier`,
see [src/auth.py](src/auth.py) / [src/server.py](src/server.py)); CloudFront routes
`/.well-known/oauth-*` to the MCP Lambda. Discovery activates once `AppUrl` is set
(second deploy); before that the endpoint falls back to validating a supplied token.

### Connect Claude.ai as a custom connector

1. Use **`MCPUrl`** as the connector URL.
2. For the OAuth client, use the **`MCPUserPoolClientId`** stack output (a public
   client, PKCE, **no secret**). Claude opens the Cognito hosted login; the user
   signs in once and Claude manages tokens from then on.

> **Cognito caveat — no Dynamic Client Registration.** Cognito can't auto-register
> the client, so supply `MCPUserPoolClientId` to the connector manually. The
> connector's redirect URI must be listed in the client's callback URLs — set via
> `MCPUserPoolClient.CallbackURLs` in the template (Claude.ai's plus mcp-remote's localhost callback). To make
> registration fully automatic you'd add a small DCR shim that hands back this
> fixed client id; not included here.
>
> Alternatively, for quick testing you can still pass a Cognito access token
> directly as the bearer (tokens expire ~1h).

## Verify end-to-end

Try these prompts once connected:

```
What's on my agenda this week?
What's overdue for the Mazda?
Add a task for Maya to renew her library card next Monday
Mark "Call the plumber" done
Move the property-tax task to Friday
Show me the Lisbon trip
```

## Architecture

```
Claude (Code / .ai / API)
        │  MCP (stdio | Streamable HTTP)
        ▼
  coo MCP server  ──caller's Bearer token (+x-origin-verify)──►  coo API (FastAPI) ─► DynamoDB
        └── src/client.py is the only file that knows the API URL
```

## Files

```
mcp-server/
  src/
    __main__.py    local entry: stdio or HTTP (uvicorn) transport
    handler.py     AWS Lambda entry: Mangum(build_asgi_app())
    asgi.py        gated Streamable HTTP app (origin-verify + Cognito)
    server.py      builds the FastMCP instance (stateless+JSON), registers tools/resources
    auth.py        Cognito access-token verification (mirrors the backend)
    tools.py       agenda, people/cars, routines, trips, add/complete/reschedule task
    logic.py       pure projections + task mutations over a CooState dict (no I/O)
    resources.py   coo://state, coo://agenda
    client.py      get_state / batch REST wrapper, per-request token pass-through (the only privileged file)
  requirements.txt
  .env.example
  README.md
```

Deployment IaC lives in [iac/template.yaml](../iac/template.yaml) (shared SAM
stack); CI is [.github/workflows/deploy-backend.yml](../.github/workflows/deploy-backend.yml).

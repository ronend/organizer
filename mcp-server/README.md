# Organizer MCP Server

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server that
wraps the Organizer webapp's REST API (`/api/organizers`). It lets Claude — via
Claude Code, Claude.ai connectors, or the Claude API — read and manage organizer
entries directly, with no proxy and no hand-written tool definitions.

**Auth is per-user pass-through.** The caller's Cognito access token flows through
the MCP server to the Organizer API, so entries stay owned by the real user — the
MCP server never holds shared credentials. Over HTTP the token comes from the
request; over stdio it comes from `TODO_API_KEY`.

## What it exposes

**Tools**

| Tool                  | API call                                  | Purpose |
|-----------------------|-------------------------------------------|---------|
| `list_entries`        | `GET /api/organizers` (+ client filter)   | All entries, optionally filtered by type/tag/done |
| `get_entry`           | `GET /api/organizers` → find by id        | One entry (no single-GET route exists) |
| `list_tags`           | derived from `GET /api/organizers`        | Distinct tags + counts (tags replace lists/projects) |
| `create_entry`        | `POST /api/organizers`                    | Create a task / trip / recurring entry |
| `update_entry`        | `PUT /api/organizers/{id}`                | Partial update of any field |
| `complete_recurring`  | `POST /api/organizers/{id}/complete`      | Complete an occurrence and spawn the next |
| `delete_entry`        | `DELETE /api/organizers/{id}`             | Permanent delete |

**Resources**

- `organizer://entries` — all entries as JSON
- `organizer://tags` — distinct tags with counts

> **Data model note:** entries have a `type` (`task` \| `trip` \| `recurring`),
> a required `title` and `dueDate` (`YYYY-MM-DD`), a `dueTime`, a `done` boolean,
> and free-form `tags`. There is **no** `status`/`priority`/`list` concept — this
> server is aligned to the webapp's actual schema, not the generic todo template.

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

- **`TODO_API_URL`** — the Organizer API base URL. Use the **CloudFront URL** (it
  injects `x-origin-verify`, so leave `TODO_ORIGIN_SECRET` blank) or a Lambda
  Function URL directly (then set `TODO_ORIGIN_SECRET`). *In the deployed Lambda,
  SAM sets this to the Organizer Function URL.*
- **`TODO_API_KEY`** — a **Cognito access token**, used as the bearer **only over
  stdio** (Claude Code). Over HTTP the caller's own token is forwarded instead.
  Tokens expire ~1h.
- **`ORIGIN_SECRET`** — if set (HTTP), requests must carry a matching
  `x-origin-verify` header (CloudFront injects it). Blocks direct Function URL
  access. *Set by SAM in the deployed Lambda.*
- **`COGNITO_USER_POOL_ID`** — if set (HTTP), the server validates the caller's
  Cognito access token before any tool runs. *Set by SAM in the deployed Lambda;
  `AWS_REGION` is provided automatically.*

#### Getting a Cognito access token (for stdio `TODO_API_KEY`, or to test HTTP)

Any valid access token for a user in the pool works, e.g. via the AWS CLI:

```bash
aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id <UserPoolClientId> \
  --auth-parameters USERNAME=user@example.com,PASSWORD=... \
  --query 'AuthenticationResult.AccessToken' --output text
```

(`USER_PASSWORD_AUTH` must be enabled on the app client.)

## Connect to Claude Code (stdio)

```bash
claude mcp add --transport stdio organizer \
  -e TODO_API_URL=https://your-cloudfront-domain \
  -e TODO_API_KEY=your-cognito-access-token \
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
- That same caller token is forwarded to the Organizer API (per-user pass-through).

```
Claude.ai / API ──Bearer Cognito token──► CloudFront /mcp ──(+x-origin-verify)──► MCPFunction
                                                                                      │ forwards caller token
                                                                                      ▼
                                                                          Organizer Function URL (API)
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
> the `McpOAuthCallbackUrls` template parameter (defaults to Claude.ai's). To make
> registration fully automatic you'd add a small DCR shim that hands back this
> fixed client id; not included here.
>
> Alternatively, for quick testing you can still pass a Cognito access token
> directly as the bearer (tokens expire ~1h).

## Verify end-to-end

Try these prompts once connected:

```
List all my entries
Show me all recurring entries
Create a task called "Review MCP implementation" due 2026-06-20 with tag work
Mark entry <id> as done
Complete the recurring entry <id>
```

## Architecture

```
Claude (Code / .ai / API)
        │  MCP (stdio | Streamable HTTP)
        ▼
  organizer-mcp-server  ──caller's Bearer token (+x-origin-verify)──►  Organizer API (FastAPI) ─► DynamoDB
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
    tools.py       list/get/create/update/complete/delete entries, list tags
    resources.py   organizer://entries, organizer://tags
    client.py      typed REST wrapper, per-request token pass-through (the only privileged file)
  requirements.txt
  .env.example
  README.md
```

Deployment IaC lives in [iac/template.yaml](../iac/template.yaml) (shared SAM
stack); CI is [.github/workflows/deploy-backend.yml](../.github/workflows/deploy-backend.yml).

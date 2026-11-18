"""The ONLY module that knows the coo API's base URL and builds outbound auth.

Every tool/resource calls through the functions here — they never hit the API
directly. The coo API expects:

  - Authorization: Bearer <Cognito access token>   (verified by the API's auth middleware)
  - x-origin-verify: <ORIGIN_SECRET>                (required by the API's origin-verify
    middleware when calling the Lambda Function URL directly; CloudFront injects
    this header itself, so it is OPTIONAL when COO_API_URL is the CloudFront URL)

Auth is **per-request, pass-through**: the caller's Cognito access token (sent to
this MCP server) is forwarded to the API, so items stay owned by the real user.
  - HTTP transport: the token is read from the incoming request's Authorization
    header via the MCP request context (see `token_from_context`).
  - stdio transport: there is no incoming HTTP request, so the token falls back
    to the COO_API_KEY environment variable.

The API surface (see data-structure.md):
  GET  /api/state      → CooState {people, cars, contacts, routines, assignments,
                                   tasks, documents, trips, reservations}
  POST /api/batch      → {put: Entity[], delete: {kind, id}[]} → {ok, updatedAt}
  GET  /api/registry   → subject types (built-in + the household's own) and document categories
  POST /api/subject-types, DELETE /api/subject-types/{key} → the household's own subject types
  POST /api/documents  → create/update any document; the server applies the
                         document rules (see backend/src/routes/documents.py)
Records are camelCase and mirror frontend/src/types/coo.ts exactly; puts are
FULL records (upserts), so edit a fetched record and send it back whole.
"""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx

BASE_URL = os.environ.get("COO_API_URL", "http://localhost:8000").rstrip("/")
# Only needed when hitting the Lambda Function URL directly (bypassing CloudFront).
ORIGIN_SECRET = os.environ.get("COO_ORIGIN_SECRET", "")


# ── Token resolution (per-request pass-through) ───────────────────────────────


def env_token() -> str:
    """stdio / local fallback token."""
    return os.environ.get("COO_API_KEY", "")


def token_from_context(ctx: Any) -> str:
    """Extract the caller's bearer token from the MCP request context.

    Works for tools (Context injected as a parameter) and resources (which call
    ``mcp.get_context()``). For HTTP transport the context carries the original
    Starlette request; for stdio there is none, so fall back to the environment.
    """
    request = None
    try:
        request = getattr(ctx.request_context, "request", None)
    except Exception:
        request = None
    if request is not None:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            return auth.split(" ", 1)[1].strip()
    return env_token()


# ── HTTP plumbing ─────────────────────────────────────────────────────────────

_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(base_url=BASE_URL, timeout=30.0)
    return _client


def _headers(token: str) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    if ORIGIN_SECRET:
        headers["x-origin-verify"] = ORIGIN_SECRET
    return headers


class ApiError(RuntimeError):
    """A 4xx/5xx from the coo API; ``body`` is the parsed JSON body (or {})."""

    def __init__(self, message: str, status: int, detail: Any, body: dict):
        super().__init__(message)
        self.status = status
        self.detail = detail
        self.body = body


async def _request(method: str, path: str, token: str, json: Any = None) -> Any:
    resp = await _get_client().request(method, path, headers=_headers(token), json=json)
    if resp.status_code >= 400:
        detail: Any = resp.text
        body: dict = {}
        try:
            body = resp.json()
            detail = body.get("detail") or body.get("error") or detail
        except Exception:
            pass  # body wasn't JSON — keep raw text
        raise ApiError(f"{method} {path} → {resp.status_code} {detail}", resp.status_code, detail, body)
    # 204 No Content (DELETE) / empty body.
    if resp.status_code == 204 or not resp.content:
        return None
    return resp.json()


# ── coo API ───────────────────────────────────────────────────────────────────
#
# Every function takes the caller's `token`.


async def get_state(token: str) -> dict:
    """GET /api/state — every record for the user, grouped by collection."""
    return await _request("GET", "/api/state", token)


async def batch(
    token: str,
    put: Optional[list[dict]] = None,
    delete: Optional[list[dict]] = None,
    expect: Optional[list[dict]] = None,
) -> dict:
    """POST /api/batch — upsert full records and/or delete {kind, id} refs.
    ``expect`` [{kind, id, updatedAt|null}] makes the write conditional (409 if stale)."""
    return await _request(
        "POST", "/api/batch", token, json={"put": put or [], "delete": delete or [], "expect": expect or []}
    )


async def get_registry(token: str) -> dict:
    """GET /api/registry — subject types (built-in and the household's own) and
    document categories. Not cached: define_subject_type changes it."""
    return await _request("GET", "/api/registry", token)


async def save_subject_type(token: str, body: dict) -> dict:
    """POST /api/subject-types — create or replace a household subject type."""
    return await _request("POST", "/api/subject-types", token, json=body)


async def delete_subject_type(token: str, key: str) -> dict:
    """DELETE /api/subject-types/{key}."""
    return await _request("DELETE", f"/api/subject-types/{key}", token)


async def save_document(token: str, body: dict) -> dict:
    """POST /api/documents — create/update a document; returns {document, changes, summary}."""
    return await _request("POST", "/api/documents", token, json=body)

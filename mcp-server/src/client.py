"""The ONLY module that knows the webapp's base URL and builds outbound auth.

Every tool/resource calls through the functions here — they never hit the API
directly. The Organizer API expects:

  - Authorization: Bearer <Cognito access token>   (verified by the API's auth middleware)
  - x-origin-verify: <ORIGIN_SECRET>                (required by the API's origin-verify
    middleware when calling the Lambda Function URL directly; CloudFront injects
    this header itself, so it is OPTIONAL when TODO_API_URL is the CloudFront URL)

Auth is **per-request, pass-through**: the caller's Cognito access token (sent to
this MCP server) is forwarded to the API, so items stay owned by the real user.
  - HTTP transport: the token is read from the incoming request's Authorization
    header via the MCP request context (see `token_from_context`).
  - stdio transport: there is no incoming HTTP request, so the token falls back
    to the TODO_API_KEY environment variable.

Types below mirror the webapp's flat entity model (snake_case) — see
backend/src/routes/items.py, frontend/src/types/organizer.ts, and
entity-model-proposal.md.
"""

from __future__ import annotations

import os
from typing import Any, Literal, Optional

import httpx

BASE_URL = os.environ.get("TODO_API_URL", "http://localhost:8000").rstrip("/")
# Only needed when hitting the Lambda Function URL directly (bypassing CloudFront).
ORIGIN_SECRET = os.environ.get("TODO_ORIGIN_SECRET", "")

EntityType = Literal["todo", "appointment", "habit", "routine", "reservation", "event", "story"]
ReservationSubtype = Literal["hotel", "flight", "tour", "activity", "restaurant"]


# ── Token resolution (per-request pass-through) ───────────────────────────────


def env_token() -> str:
    """stdio / local fallback token."""
    return os.environ.get("TODO_API_KEY", "")


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


async def _request(method: str, path: str, token: str, json: Any = None) -> Any:
    resp = await _get_client().request(method, path, headers=_headers(token), json=json)
    if resp.status_code >= 400:
        detail = resp.text
        try:
            data = resp.json()
            detail = data.get("detail") or data.get("error") or detail
        except Exception:
            pass  # body wasn't JSON — keep raw text
        raise RuntimeError(f"{method} {path} → {resp.status_code} {detail}")
    # 204 No Content (DELETE) / empty body.
    if resp.status_code == 204 or not resp.content:
        return None
    return resp.json()


# ── Items ─────────────────────────────────────────────────────────────────────
#
# GET /api/items returns ALL of a user's entities. Every function takes the
# caller's `token`.


async def list_items(token: str, type: Optional[EntityType] = None) -> list[dict]:
    """GET /api/items, optionally filtered by type (server-side)."""
    qs = f"?type={type}" if type else ""
    return await _request("GET", f"/api/items{qs}", token)


async def get_item(token: str, item_id: str) -> dict:
    """GET /api/items/{id} — full entity (404 if missing)."""
    return await _request("GET", f"/api/items/{item_id}", token)


async def create_item(token: str, body: dict) -> dict:
    """POST /api/items — returns the created entity (201)."""
    return await _request("POST", "/api/items", token, json=body)


async def update_item(token: str, item_id: str, body: dict) -> dict:
    """PUT /api/items/{id} — partial update, returns the updated entity."""
    return await _request("PUT", f"/api/items/{item_id}", token, json=body)


async def delete_item(token: str, item_id: str) -> None:
    """DELETE /api/items/{id} — 204 No Content."""
    await _request("DELETE", f"/api/items/{item_id}", token)


async def log_habit(token: str, item_id: str, date: str, completed: bool) -> dict:
    """POST /api/items/{id}/log — record a habit occurrence for a date."""
    return await _request(
        "POST", f"/api/items/{item_id}/log", token, json={"date": date, "completed": completed}
    )


async def story_timeline(token: str, item_id: str) -> dict:
    """GET /api/items/{id}/timeline — a story's reservations/events, chronological."""
    return await _request("GET", f"/api/items/{item_id}/timeline", token)


# ── Derived views ──────────────────────────────────────────────────────────────


async def upcoming_reminders(
    token: str, before: Optional[str] = None, status: Optional[str] = "pending"
) -> list[dict]:
    """GET /api/reminders/upcoming — the flat reminder index, ordered by fire_at."""
    params = []
    if before:
        params.append(f"before={before}")
    if status is not None:
        params.append(f"status={status}")
    qs = ("?" + "&".join(params)) if params else ""
    return await _request("GET", f"/api/reminders/upcoming{qs}", token)

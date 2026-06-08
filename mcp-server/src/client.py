"""The ONLY module that knows the webapp's base URL and builds outbound auth.

Every tool/resource calls through the functions here — they never hit the API
directly. The Organizer API expects:

  - Authorization: Bearer <Cognito access token>   (verified by the API's auth middleware)
  - x-origin-verify: <ORIGIN_SECRET>                (required by the API's origin-verify
    middleware when calling the Lambda Function URL directly; CloudFront injects
    this header itself, so it is OPTIONAL when TODO_API_URL is the CloudFront URL)

Auth is **per-request, pass-through**: the caller's Cognito access token (sent to
this MCP server) is forwarded to the API, so entries stay owned by the real user.
  - HTTP transport: the token is read from the incoming request's Authorization
    header via the MCP request context (see `token_from_context`).
  - stdio transport: there is no incoming HTTP request, so the token falls back
    to the TODO_API_KEY environment variable.

Types below mirror the webapp's actual shapes (camelCase) — see
backend/src/routes/organizers.py and frontend/src/types/organizer.ts.
"""

from __future__ import annotations

import os
from typing import Any, Literal, Optional

import httpx
from pydantic import BaseModel

BASE_URL = os.environ.get("TODO_API_URL", "http://localhost:8000").rstrip("/")
# Only needed when hitting the Lambda Function URL directly (bypassing CloudFront).
ORIGIN_SECRET = os.environ.get("TODO_ORIGIN_SECRET", "")

EntryType = Literal["task", "trip", "recurring"]
SegmentType = Literal["flight", "hotel", "car", "activity", "train", "note"]
RecurrenceFreq = Literal["day", "week", "month"]


# ── Domain models (mirror the webapp; used as typed tool inputs) ──────────────


class Recurrence(BaseModel):
    freq: RecurrenceFreq
    interval: int = 1
    weekdays: Optional[list[int]] = None
    monthDay: Optional[int] = None


class Reminder(BaseModel):
    label: str
    daysBefore: int = 0
    note: Optional[str] = None


class Contact(BaseModel):
    name: str = ""
    role: str = ""
    phone: str = ""
    email: str = ""


class DependsOnRef(BaseModel):
    entryId: str
    daysBefore: int = 0


class Segment(BaseModel):
    id: str = ""
    type: SegmentType
    fields: dict[str, str] = {}


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


# ── API surface ───────────────────────────────────────────────────────────────
#
# GET /api/organizers returns ALL of a user's entries (no server-side filtering,
# no list/project concept, no single-GET route). We add thin client-side
# conveniences — filtering, find-by-id, tag derivation — on top. Every function
# takes the caller's `token`.


async def list_entries(
    token: str,
    type: Optional[EntryType] = None,
    tag: Optional[str] = None,
    done: Optional[bool] = None,
) -> list[dict]:
    """GET /api/organizers, optionally filtered client-side."""
    entries: list[dict] = await _request("GET", "/api/organizers", token)
    if type is None and tag is None and done is None:
        return entries
    needle = tag.strip().lower() if tag else None
    result = []
    for e in entries:
        if type is not None and e.get("type") != type:
            continue
        if done is not None and bool(e.get("done")) != done:
            continue
        if needle is not None and needle not in (e.get("tags") or []):
            continue
        result.append(e)
    return result


async def get_entry(token: str, entry_id: str) -> dict:
    """No single-GET route exists — find within the full list."""
    entries: list[dict] = await _request("GET", "/api/organizers", token)
    for e in entries:
        if e.get("id") == entry_id:
            return e
    raise RuntimeError(f"Entry {entry_id} not found")


async def create_entry(token: str, body: dict) -> dict:
    """POST /api/organizers — returns the created entry (201)."""
    return await _request("POST", "/api/organizers", token, json=body)


async def update_entry(token: str, entry_id: str, body: dict) -> dict:
    """PUT /api/organizers/{id} — returns the updated entry (404 if missing)."""
    return await _request("PUT", f"/api/organizers/{entry_id}", token, json=body)


async def complete_recurring(token: str, entry_id: str) -> dict:
    """POST /api/organizers/{id}/complete — complete a recurring occurrence and
    spawn the next occurrence (+ its reminder sub-tasks)."""
    return await _request("POST", f"/api/organizers/{entry_id}/complete", token)


async def delete_entry(token: str, entry_id: str) -> None:
    """DELETE /api/organizers/{id} — 204 No Content."""
    await _request("DELETE", f"/api/organizers/{entry_id}", token)


async def list_tags(token: str) -> list[dict]:
    """Derived: distinct tags across all entries, with counts."""
    entries: list[dict] = await _request("GET", "/api/organizers", token)
    counts: dict[str, int] = {}
    for e in entries:
        for t in e.get("tags") or []:
            counts[t] = counts.get(t, 0) + 1
    return [
        {"tag": tag, "count": count}
        for tag, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

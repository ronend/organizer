"""The ONLY module that knows the webapp's base URL and builds outbound auth.

Every tool/resource calls through the functions here — they never hit the API
directly. The Organizer API expects:

  - Authorization: Bearer <Cognito access token>   (verified by the API's auth middleware)
  - x-origin-verify: <ORIGIN_SECRET>                (required by the API's origin-verify
    middleware when calling the Lambda Function URL directly; CloudFront injects
    this header itself, so it is OPTIONAL when TODO_API_URL is the CloudFront URL)

Auth is **per-request, pass-through**: the caller's Cognito access token (sent to
this MCP server) is forwarded to the API, so events stay owned by the real user.
  - HTTP transport: the token is read from the incoming request's Authorization
    header via the MCP request context (see `token_from_context`).
  - stdio transport: there is no incoming HTTP request, so the token falls back
    to the TODO_API_KEY environment variable.

Types below mirror the webapp's event model (snake_case) — see
backend/src/routes/events.py and frontend/src/types/organizer.ts, which both
follow data-structure.md.
"""

from __future__ import annotations

import os
from typing import Any, Literal, Optional

import httpx
from pydantic import BaseModel, Field

BASE_URL = os.environ.get("TODO_API_URL", "http://localhost:8000").rstrip("/")
# Only needed when hitting the Lambda Function URL directly (bypassing CloudFront).
ORIGIN_SECRET = os.environ.get("TODO_ORIGIN_SECRET", "")

EventKind = Literal["container", "occurrence", "habit", "list"]
ItemKind = Literal["task", "reservation", "entry", "checklist_item"]


# ── Domain models (mirror the webapp; used as typed tool inputs) ──────────────


class Reminder(BaseModel):
    id: Optional[str] = None
    title: str = ""
    status: str = "pending"
    fire_at: str = ""
    offset_rule: Optional[str] = None  # "-30d", "-2h", "+1d", "0"
    recurrence_rule: Optional[str] = None  # RFC 5545 RRULE
    notes: Optional[str] = None
    url: Optional[str] = None
    login_hint: Optional[str] = None
    attrs: dict[str, Any] = Field(default_factory=dict)


class Item(BaseModel):
    id: Optional[str] = None
    kind: ItemKind = "task"
    subtype: str = ""
    tags: list[str] = Field(default_factory=list)
    title: str = ""
    status: str = "todo"
    scheduled_at: Optional[str] = None
    due_at: Optional[str] = None
    sort_order: int = 0
    confirmation_ref: Optional[str] = None
    cost: Optional[float] = None
    currency: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    url: Optional[str] = None
    login_hint: Optional[str] = None
    prereq_ids: list[str] = Field(default_factory=list)
    attrs: dict[str, Any] = Field(default_factory=dict)
    reminders: list[Reminder] = Field(default_factory=list)


class ChecklistItem(BaseModel):
    id: Optional[str] = None
    label: str = ""
    checked: bool = False
    needs_purchase: bool = False
    purchased: bool = False
    notes: Optional[str] = None
    sort_order: int = 0


class ChecklistInstance(BaseModel):
    id: Optional[str] = None
    template_id: Optional[str] = None
    name: str = ""
    items: list[ChecklistItem] = Field(default_factory=list)


class Attachment(BaseModel):
    id: Optional[str] = None
    label: str = ""
    item_id: Optional[str] = None
    mime_type: Optional[str] = None
    url: Optional[str] = None
    storage_key: Optional[str] = None


class TemplateItem(BaseModel):
    id: Optional[str] = None
    label: str = ""
    category: Optional[str] = None
    needs_purchase: bool = False
    sort_order: int = 0
    default_reminder_offset: Optional[str] = None
    notes: Optional[str] = None


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


# ── Events ─────────────────────────────────────────────────────────────────────
#
# GET /api/events returns ALL of a user's event documents. We add thin
# client-side conveniences (filtering, tag derivation) on top. Every function
# takes the caller's `token`.


async def list_events(
    token: str,
    kind: Optional[EventKind] = None,
    tag: Optional[str] = None,
    status: Optional[str] = None,
) -> list[dict]:
    """GET /api/events, optionally filtered client-side by kind/tag/status."""
    events: list[dict] = await _request("GET", "/api/events", token)
    if kind is None and tag is None and status is None:
        return events
    needle = tag.strip().lower() if tag else None
    result = []
    for e in events:
        if kind is not None and e.get("kind") != kind:
            continue
        if status is not None and e.get("status") != status:
            continue
        if needle is not None and needle not in (e.get("tags") or []):
            continue
        result.append(e)
    return result


async def get_event(token: str, event_id: str) -> dict:
    """GET /api/events/{id} — full event document (404 if missing)."""
    return await _request("GET", f"/api/events/{event_id}", token)


async def create_event(token: str, body: dict) -> dict:
    """POST /api/events — returns the created event (201)."""
    return await _request("POST", "/api/events", token, json=body)


async def update_event(token: str, event_id: str, body: dict) -> dict:
    """PUT /api/events/{id} — returns the updated event (404 if missing)."""
    return await _request("PUT", f"/api/events/{event_id}", token, json=body)


async def complete_event(token: str, event_id: str) -> dict:
    """POST /api/events/{id}/complete — mark done; if it recurs, spawn the next
    occurrence. Returns {"completed": <event>, "next": <event|None>}."""
    return await _request("POST", f"/api/events/{event_id}/complete", token)


async def delete_event(token: str, event_id: str) -> None:
    """DELETE /api/events/{id} — 204 No Content."""
    await _request("DELETE", f"/api/events/{event_id}", token)


# ── Templates ────────────────────────────────────────────────────────────────


async def list_templates(token: str) -> list[dict]:
    return await _request("GET", "/api/templates", token)


async def create_template(token: str, body: dict) -> dict:
    return await _request("POST", "/api/templates", token, json=body)


async def update_template(token: str, template_id: str, body: dict) -> dict:
    return await _request("PUT", f"/api/templates/{template_id}", token, json=body)


async def delete_template(token: str, template_id: str) -> None:
    await _request("DELETE", f"/api/templates/{template_id}", token)


# ── Derived views ──────────────────────────────────────────────────────────────


async def upcoming_reminders(
    token: str, before: Optional[str] = None, status: Optional[str] = "pending"
) -> list[dict]:
    """GET /api/reminders/upcoming — the flat reminders_index, ordered by fire_at."""
    params = []
    if before:
        params.append(f"before={before}")
    if status is not None:
        params.append(f"status={status}")
    qs = ("?" + "&".join(params)) if params else ""
    return await _request("GET", f"/api/reminders/upcoming{qs}", token)


async def shopping_list(token: str) -> list[dict]:
    """GET /api/views/shopping — checklist items that need purchasing."""
    return await _request("GET", "/api/views/shopping", token)


async def list_tags(token: str) -> list[dict]:
    """Derived: distinct tags across all events, with counts."""
    events: list[dict] = await _request("GET", "/api/events", token)
    counts: dict[str, int] = {}
    for e in events:
        for t in e.get("tags") or []:
            counts[t] = counts.get(t, 0) + 1
    return [
        {"tag": tag, "count": count}
        for tag, count in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

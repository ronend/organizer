"""Event CRUD routes (see data-structure.md).

The auth dependency runs first on every route here, so ``user["sub"]`` is the
verified userId. userId is ALWAYS taken from the JWT — never from the request
body or query string.

An EventDocument embeds its items, reminders, checklists and attachments. The
reminders_index projection and template auto-apply are handled in the data layer
on every write.
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from src.db import dynamo
from src.middleware.auth import require_auth

router = APIRouter(prefix="/api/events")

EVENT_KINDS = {"container", "occurrence", "habit", "list"}
ITEM_KINDS = {"task", "reservation", "entry", "checklist_item"}


def normalize_tags(raw: Optional[list[str]]) -> list[str]:
    """Lowercase, trim, cap at 40 chars, drop empties, de-dupe (order-stable)."""
    if not raw:
        return []
    out: list[str] = []
    for t in raw:
        norm = (t or "").strip().lower()[:40]
        if norm and norm not in out:
            out.append(norm)
    return out


# ── Embedded subdocument models ────────────────────────────────────────────────


class Reminder(BaseModel):
    id: Optional[str] = None
    title: str = ""
    status: str = "pending"
    fire_at: str = ""
    offset_rule: Optional[str] = None
    recurrence_rule: Optional[str] = None
    notes: Optional[str] = None
    url: Optional[str] = None
    login_hint: Optional[str] = None
    attrs: dict[str, Any] = Field(default_factory=dict)


class Item(BaseModel):
    id: Optional[str] = None
    kind: str = "task"
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


class CreateEvent(BaseModel):
    kind: str = "list"
    subtype: str = ""
    tags: list[str] = Field(default_factory=list)
    title: str
    status: str = "planned"
    parent_id: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    recurrence_rule: Optional[str] = None
    attrs: dict[str, Any] = Field(default_factory=dict)
    items: list[Item] = Field(default_factory=list)
    reminders: list[Reminder] = Field(default_factory=list)
    checklists: list[ChecklistInstance] = Field(default_factory=list)
    attachments: list[Attachment] = Field(default_factory=list)


class UpdateEvent(BaseModel):
    kind: Optional[str] = None
    subtype: Optional[str] = None
    tags: Optional[list[str]] = None
    title: Optional[str] = None
    status: Optional[str] = None
    parent_id: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    recurrence_rule: Optional[str] = None
    attrs: Optional[dict[str, Any]] = None
    items: Optional[list[Item]] = None
    reminders: Optional[list[Reminder]] = None
    checklists: Optional[list[ChecklistInstance]] = None
    attachments: Optional[list[Attachment]] = None


def _validate_kind(kind: Optional[str]) -> None:
    if kind is not None and kind not in EVENT_KINDS:
        raise HTTPException(status_code=400, detail=f"invalid event kind: {kind}")


@router.get("")
def list_events(user: dict = Depends(require_auth)):
    return dynamo.list_events(user["sub"])


@router.get("/{event_id}")
def get_event(event_id: str, user: dict = Depends(require_auth)):
    event = dynamo.get_event(user["sub"], event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.post("", status_code=201)
def create_event(body: CreateEvent, user: dict = Depends(require_auth)):
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    _validate_kind(body.kind)
    data = body.model_dump()
    data["tags"] = normalize_tags(data.get("tags"))
    return dynamo.create_event(user["sub"], data)


@router.put("/{event_id}")
def update_event(event_id: str, body: UpdateEvent, user: dict = Depends(require_auth)):
    _validate_kind(body.kind)
    updates = body.model_dump(exclude_unset=True)
    if "tags" in updates:
        updates["tags"] = normalize_tags(updates["tags"])
    updated = dynamo.update_event(user["sub"], event_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return updated


@router.post("/{event_id}/complete")
def complete_event(event_id: str, user: dict = Depends(require_auth)):
    """Mark an event done; if it recurs, atomically spawn the next occurrence.
    Returns {"completed": <event>, "next": <event|None>}."""
    result = dynamo.complete_event_occurrence(user["sub"], event_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return result


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: str, user: dict = Depends(require_auth)):
    dynamo.delete_event(user["sub"], event_id)
    return Response(status_code=204)

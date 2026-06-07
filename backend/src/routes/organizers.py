"""Organizer item CRUD routes. The auth dependency runs first on every route
here, so `user["sub"]` is the verified userId. userId is ALWAYS taken from the
JWT — never from the request body or query string.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from src.db import dynamo
from src.middleware.auth import require_auth

router = APIRouter(prefix="/api/organizers")

# Tags are free-form labels (no fixed set). Entry types are a fixed enum.
TYPES = {"task", "trip", "recurring"}


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


class Recurrence(BaseModel):
    freq: str  # day | week | month
    interval: int = 1
    weekdays: Optional[list[int]] = None
    monthDay: Optional[int] = None


class Reminder(BaseModel):
    label: str
    daysBefore: int = 0
    note: str = ""


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
    type: str = "note"
    fields: dict = {}


class CreateItem(BaseModel):
    title: str
    dueDate: str
    tags: list[str] = []
    type: str = "task"
    description: str = ""
    dueTime: str = "09:00"
    done: bool = False
    link: str = ""
    contacts: list[Contact] = []
    dependsOn: list[DependsOnRef] = []
    recurrence: Optional[Recurrence] = None
    reminders: list[Reminder] = []
    startDate: str = ""
    endDate: str = ""
    segments: list[Segment] = []
    parentId: Optional[str] = None
    isPrereq: bool = False


class UpdateItem(BaseModel):
    title: Optional[str] = None
    dueDate: Optional[str] = None
    tags: Optional[list[str]] = None
    type: Optional[str] = None
    description: Optional[str] = None
    dueTime: Optional[str] = None
    done: Optional[bool] = None
    link: Optional[str] = None
    contacts: Optional[list[Contact]] = None
    dependsOn: Optional[list[DependsOnRef]] = None
    recurrence: Optional[Recurrence] = None
    reminders: Optional[list[Reminder]] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    segments: Optional[list[Segment]] = None
    parentId: Optional[str] = None
    isPrereq: Optional[bool] = None


def _validate_type(type_: Optional[str]) -> None:
    if type_ is not None and type_ not in TYPES:
        raise HTTPException(status_code=400, detail=f"invalid type: {type_}")


@router.get("")
def list_items(user: dict = Depends(require_auth)):
    return dynamo.list_organizers(user["sub"])


@router.post("", status_code=201)
def create_item(body: CreateItem, user: dict = Depends(require_auth)):
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if not body.dueDate.strip():
        raise HTTPException(status_code=400, detail="dueDate is required")
    _validate_type(body.type)
    data = body.model_dump()
    data["tags"] = normalize_tags(data.get("tags"))
    return dynamo.create_organizer(user["sub"], data)


@router.put("/{organizer_id}")
def update_item(
    organizer_id: str, body: UpdateItem, user: dict = Depends(require_auth)
):
    _validate_type(body.type)
    updates = body.model_dump(exclude_unset=True)
    if "tags" in updates:
        updates["tags"] = normalize_tags(updates["tags"])
    updated = dynamo.update_organizer(user["sub"], organizer_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return updated


@router.post("/{organizer_id}/complete")
def complete_routine(organizer_id: str, user: dict = Depends(require_auth)):
    """Atomically mark a routine occurrence done and spawn the next occurrence
    (+ its prerequisite items). Returns the newly created items."""
    created = dynamo.complete_routine(user["sub"], organizer_id)
    if created is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"created": created}


@router.delete("/{organizer_id}", status_code=204)
def delete_item(organizer_id: str, user: dict = Depends(require_auth)):
    dynamo.delete_organizer(user["sub"], organizer_id)
    return Response(status_code=204)

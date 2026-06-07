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

# Categories are free-form labels (no fixed set). Types are a fixed enum.
TYPES = {"simple", "complex", "repeat", "project", "routine"}


def normalize_category(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    return (raw.strip().lower() or "errand")[:40]


class CreateItem(BaseModel):
    title: str
    dueDate: str
    category: str = "errand"
    type: str = "simple"
    description: str = ""
    dueTime: str = "09:00"
    done: bool = False


class UpdateItem(BaseModel):
    title: Optional[str] = None
    dueDate: Optional[str] = None
    category: Optional[str] = None
    type: Optional[str] = None
    description: Optional[str] = None
    dueTime: Optional[str] = None
    done: Optional[bool] = None


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
    data["category"] = normalize_category(data.get("category"))
    return dynamo.create_organizer(user["sub"], data)


@router.put("/{organizer_id}")
def update_item(
    organizer_id: str, body: UpdateItem, user: dict = Depends(require_auth)
):
    _validate_type(body.type)
    updates = body.model_dump(exclude_unset=True)
    if "category" in updates:
        updates["category"] = normalize_category(updates["category"])
    updated = dynamo.update_organizer(user["sub"], organizer_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return updated


@router.delete("/{organizer_id}", status_code=204)
def delete_item(organizer_id: str, user: dict = Depends(require_auth)):
    dynamo.delete_organizer(user["sub"], organizer_id)
    return Response(status_code=204)

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

CATEGORIES = {"errand", "project", "health", "finance", "home"}
TYPES = {"simple", "complex", "repeat", "project"}


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


def _validate(category: Optional[str], type_: Optional[str]) -> None:
    if category is not None and category not in CATEGORIES:
        raise HTTPException(status_code=400, detail=f"invalid category: {category}")
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
    _validate(body.category, body.type)
    return dynamo.create_organizer(user["sub"], body.model_dump())


@router.put("/{organizer_id}")
def update_item(
    organizer_id: str, body: UpdateItem, user: dict = Depends(require_auth)
):
    _validate(body.category, body.type)
    updates = body.model_dump(exclude_unset=True)
    updated = dynamo.update_organizer(user["sub"], organizer_id, updates)
    if updated is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return updated


@router.delete("/{organizer_id}", status_code=204)
def delete_item(organizer_id: str, user: dict = Depends(require_auth)):
    dynamo.delete_organizer(user["sub"], organizer_id)
    return Response(status_code=204)

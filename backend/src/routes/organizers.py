"""Organizer CRUD routes. The auth dependency runs first on every route here, so
`user["sub"]` is the verified userId. userId is ALWAYS taken from the JWT —
never from the request body or query string.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from src.db import dynamo
from src.middleware.auth import require_auth

router = APIRouter(prefix="/api/organizers")


class CreateOrganizer(BaseModel):
    text: str


class UpdateOrganizer(BaseModel):
    done: Optional[bool] = None
    text: Optional[str] = None


@router.get("")
def list_organizers(user: dict = Depends(require_auth)):
    return dynamo.list_organizers(user["sub"])


@router.post("", status_code=201)
def create_organizer(body: CreateOrganizer, user: dict = Depends(require_auth)):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    return dynamo.create_organizer(user["sub"], text)


@router.put("/{organizer_id}")
def update_organizer(organizer_id: str, body: UpdateOrganizer, user: dict = Depends(require_auth)):
    updated = dynamo.update_organizer(
        user["sub"], organizer_id, done=body.done, text=body.text
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Organizer not found")
    return updated


@router.delete("/{organizer_id}", status_code=204)
def delete_organizer(organizer_id: str, user: dict = Depends(require_auth)):
    dynamo.delete_organizer(user["sub"], organizer_id)
    return Response(status_code=204)

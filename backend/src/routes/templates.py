"""Reusable checklist template routes (see data-structure.md).

Templates are referenced by ``template_id`` inside a ChecklistInstance but never
embedded — a checklist instance is a snapshot taken at creation time, so editing
a template does not change existing instances. Stored per-user under the TMPL#
sort-key prefix.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from src.db import dynamo
from src.middleware.auth import require_auth

router = APIRouter(prefix="/api/templates")


class TemplateItem(BaseModel):
    id: Optional[str] = None
    label: str = ""
    category: Optional[str] = None
    needs_purchase: bool = False
    sort_order: int = 0
    default_reminder_offset: Optional[str] = None
    notes: Optional[str] = None


class CreateTemplate(BaseModel):
    name: str
    applies_to_subtype: Optional[str] = None
    auto_apply: bool = False
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    items: list[TemplateItem] = Field(default_factory=list)


class UpdateTemplate(BaseModel):
    name: Optional[str] = None
    applies_to_subtype: Optional[str] = None
    auto_apply: Optional[bool] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    items: Optional[list[TemplateItem]] = None


@router.get("")
def list_templates(user: dict = Depends(require_auth)):
    return dynamo.list_templates(user["sub"])


@router.get("/{template_id}")
def get_template(template_id: str, user: dict = Depends(require_auth)):
    tmpl = dynamo.get_template(user["sub"], template_id)
    if tmpl is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return tmpl


@router.post("", status_code=201)
def create_template(body: CreateTemplate, user: dict = Depends(require_auth)):
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    return dynamo.create_template(user["sub"], body.model_dump())


@router.put("/{template_id}")
def update_template(
    template_id: str, body: UpdateTemplate, user: dict = Depends(require_auth)
):
    updated = dynamo.update_template(
        user["sub"], template_id, body.model_dump(exclude_unset=True)
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Template not found")
    return updated


@router.delete("/{template_id}", status_code=204)
def delete_template(template_id: str, user: dict = Depends(require_auth)):
    dynamo.delete_template(user["sub"], template_id)
    return Response(status_code=204)

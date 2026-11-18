"""Household-defined subject types (no UI; the API and the MCP server).

POST   /api/subject-types          body {key, label, plural?, nameLabel?, namePlaceholder?,
                                         icon?, attributes?, allows?, documentCategories?,
                                         routineAreas?, rules?}
       → {subjectType, created}
       Creates the type, or replaces an existing one's definition (its subjects must
       still fit it: remove an attribute that holds values by marking it deprecated).
DELETE /api/subject-types/{key}    → {ok}; 400 while subjects of the type exist.

A type is a ``subjectType`` record (id = key) shaped like a registry.json
subjectTypes entry; once saved it is part of GET /api/registry and every check
treats it like a built-in type. Keys of built-in types (person, car, trip) can't
be used.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field, TypeAdapter, ValidationError

from src.db import dynamo
from src.middleware.auth import require_auth
from src.models import Area, Category, DateOrderRule, FieldDef, Short, SubjectTypeRecord, Tiny, TypeKey, _Strict
from src.routes.state import write

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])
_record = TypeAdapter(SubjectTypeRecord)


class SubjectTypeInput(_Strict):
    key: TypeKey
    label: Annotated[str, Field(min_length=1, max_length=100)]
    plural: Optional[Annotated[str, Field(min_length=1, max_length=100)]] = None
    nameLabel: Optional[Annotated[str, Field(min_length=1, max_length=100)]] = None
    namePlaceholder: Optional[Short] = None
    icon: Optional[Tiny] = None
    attributes: Optional[Annotated[list[FieldDef], Field(max_length=50)]] = None
    allows: Optional[list[Literal["task", "document", "assignment", "reservation"]]] = None
    documentCategories: Optional[list[Category]] = None
    routineAreas: Optional[list[Area]] = None
    rules: Optional[list[DateOrderRule]] = None


@router.post("/subject-types")
def save_subject_type(body: SubjectTypeInput, claims: dict = Depends(require_auth)) -> dict:
    user_id = claims["sub"]
    state = dynamo.load_state(user_id)
    prev = next((r for r in state.get("subjectTypes", []) if r["id"] == body.key), None)
    stamp = dynamo.now_iso()
    given = body.model_dump(exclude_unset=True, exclude={"key"})
    allows = given.get("allows", (prev or {}).get("allows", ["task", "document"]))
    data = {
        **(prev or {"kind": "subjectType", "id": body.key, "createdAt": stamp, "archived": False}),
        "updatedAt": stamp,
        **given,
    }
    data.setdefault("plural", f"{body.label}s")
    # Sensible defaults: documents of the generic file category, no routines.
    if "documentCategories" not in data:
        data["documentCategories"] = ["attachment"] if "document" in allows else []
    try:
        rec = _record.validate_python(data).model_dump()
    except ValidationError as e:
        err = e.errors()[0]
        raise HTTPException(status_code=422, detail=f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}")
    write(user_id, state, [rec], [])
    return {"subjectType": rec, "created": prev is None}


@router.delete("/subject-types/{key}")
def delete_subject_type(key: str, claims: dict = Depends(require_auth)) -> dict:
    user_id = claims["sub"]
    state = dynamo.load_state(user_id)
    if not any(r["id"] == key for r in state.get("subjectTypes", [])):
        raise HTTPException(status_code=404, detail=f"No subject type {key!r} of yours")
    write(user_id, state, [], [{"kind": "subjectType", "id": key}])
    return {"ok": True}

"""Document routes — one API for every document on every subject.

POST /api/documents
    body {document, renewal?, closeTaskId?, duplicates?, today?}
      document     the fields to set. Without an existing ``id`` it creates a
                   document (``subjectType``, ``subjectId``, ``docKind`` and
                   ``name`` required; ``type`` defaults to the category's);
                   with one, it updates only the fields given.
      renewal      {remindDays?} — create renewal reminders from the expiry
                   (categories with ``renewal`` in the registry)
      closeTaskId  a task to mark done (e.g. the "add the document" task the
                   form was opened from)
      duplicates   "allow" (default) or "reject": with "reject", a second
                   active document of a one-per-type category is a 409 whose
                   detail lists the current ones
      today        the caller's local date, for planning steps (default: server)
    → {document, changes: {put, delete}, summary}
      ``changes`` is everything written (already stamped), so the app can apply
      it locally without re-sending it.

    Files are attached by FileRef (``file``, ``front``, ``back``) after uploading
    them through POST /api/files/upload-url, the one upload path for all files.

GET /api/registry
    → the subject/document registry (src/registry.json)
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import Field, TypeAdapter, ValidationError

from src import documents, registry
from src.db import dynamo
from src.middleware.auth import require_auth
from src.models import (
    DetailRow,
    DocKind,
    Entity,
    FileRef,
    Id,
    ISODate,
    Long,
    Short,
    SubjectType,
    Title,
    _Strict,
    file_refs,
)
from src.routes.state import user_prefix

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])
_entity = TypeAdapter(Entity)


class DocumentFields(_Strict):
    id: Optional[Id] = None
    subjectType: Optional[SubjectType] = None
    subjectId: Optional[Id] = None
    docKind: Optional[DocKind] = None
    name: Optional[Title] = None
    type: Optional[Short] = None
    date: Optional[ISODate] = None
    validUntil: Optional[ISODate] = None
    idNumber: Optional[Short] = None
    issuer: Optional[Short] = None
    issueDate: Optional[ISODate] = None
    details: Optional[Annotated[list[DetailRow], Field(max_length=100)]] = None
    front: Optional[FileRef] = None
    back: Optional[FileRef] = None
    providerId: Optional[Id] = None
    about: Optional[Long] = None
    episode: Optional[Short] = None
    file: Optional[FileRef] = None
    assignmentId: Optional[Id] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None
    outdated: Optional[bool] = None


# Fields where null is a real value (clear it) rather than "not given".
_NULLABLE = {"date", "validUntil", "issueDate", "front", "back", "providerId", "file", "assignmentId"}


class RenewalOptions(_Strict):
    remindDays: Optional[Annotated[int, Field(ge=0, le=3650)]] = None


class SaveDocumentRequest(_Strict):
    document: DocumentFields
    renewal: Optional[RenewalOptions] = None
    closeTaskId: Optional[Id] = None
    duplicates: Literal["allow", "reject"] = "allow"
    today: Optional[ISODate] = None


@router.get("/registry")
def get_registry() -> dict:
    return registry.registry()


@router.post("/documents")
def save_document(body: SaveDocumentRequest, claims: dict = Depends(require_auth)):
    user_id = claims["sub"]
    given = body.document.model_dump(exclude_unset=True)
    fields = {k: v for k, v in given.items() if v is not None or k in _NULLABLE}
    # Defaults for strings/lists that a caller "cleared" with null.
    for k in ("idNumber", "issuer", "about", "episode"):
        if k in given and given[k] is None:
            fields[k] = ""

    state = dynamo.load_state(user_id)
    try:
        puts, deletes, doc, summary = documents.save_document(
            state,
            fields,
            renewal=body.renewal.model_dump() if body.renewal else None,
            close_task_id=body.closeTaskId,
            duplicates=body.duplicates,
            today=body.today,
        )
    except documents.Duplicate as e:
        return JSONResponse(status_code=409, content={"detail": str(e), "existing": e.existing})
    except documents.NotFound as e:
        raise HTTPException(status_code=404, detail=str(e))
    except documents.DocumentError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Everything written must be a valid record, with files in the caller's storage.
    prefix = user_prefix(user_id)
    for p in puts:
        try:
            entity = _entity.validate_python(p)
        except ValidationError as e:
            raise HTTPException(status_code=400, detail=f"Invalid {p['kind']}: {e.errors()[0]['msg']}")
        if any(not ref.key.startswith(prefix) for ref in file_refs(entity)):
            raise HTTPException(status_code=403, detail="File key outside your storage")

    stamp = dynamo.apply_changes(user_id, puts, deletes)
    stamped = [{**p, "updatedAt": stamp} for p in puts]
    doc = next(p for p in stamped if p["kind"] == "document" and p["id"] == doc["id"])
    return {"document": doc, "changes": {"put": stamped, "delete": deletes}, "summary": summary}

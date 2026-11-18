"""Document routes — one API for every document on every subject.

POST /api/documents
    body {document, renewal?, closeTaskId?, duplicates?, today?, expectUpdatedAt?}
      document     the fields to set. Without an existing ``id`` it creates a
                   document (``subjectId``, ``category`` and ``title``
                   required; ``type``, ``pinned`` and ``date`` default from the
                   category); with one, it updates only the fields given.
      renewal      {remindDays?} — create renewal reminders from the expiry
                   (categories with a ``renewal`` rule)
      closeTaskId  a task to mark done (e.g. the one the form was opened from)
      duplicates   "allow" (default) or "reject": with "reject", a second
                   active document of a one-per-type category is a 409 whose
                   body lists the current ones
      today        the caller's local date, for planning steps (default: server)
      expectUpdatedAt  when editing: the document's updatedAt as last read;
                   409 if it changed since
    → {document, changes: {put, delete}, summary}
      ``changes`` is everything written (already stamped), so the app can
      apply it locally without re-sending it.

    Files are uploaded first through POST /api/files/upload-url (the one
    upload path for every file); the request carries the returned FileRefs in
    ``files: [{role, file}]``.

GET /api/registry
    → the registry (src/registry.json) plus the caller's own subject types
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
    AttachedTo,
    Category,
    CustomField,
    DocumentFile,
    Entity,
    Expiry,
    Fields,
    Id,
    ISODate,
    Short,
    Timestamp,
    _Strict,
)
from src.routes.state import user_prefix, write

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])
_entity = TypeAdapter(Entity)


class DocumentInput(_Strict):
    id: Optional[Id] = None
    subjectId: Optional[Id] = None
    category: Optional[Category] = None
    type: Optional[Short] = None
    title: Optional[Annotated[str, Field(max_length=300)]] = None
    date: Optional[ISODate] = None
    files: Optional[Annotated[list[DocumentFile], Field(max_length=20)]] = None
    fields: Optional[Fields] = None
    customFields: Optional[Annotated[list[CustomField], Field(max_length=100)]] = None
    assignmentId: Optional[Id] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None
    attachedTo: Optional[AttachedTo] = None
    expiry: Optional[Expiry] = None


# Fields where null is a real value (clear it) rather than "not given".
_NULLABLE = set(documents.NULLABLE)


class RenewalOptions(_Strict):
    remindDays: Optional[Annotated[int, Field(ge=0, le=3650)]] = None


class SaveDocumentRequest(_Strict):
    document: DocumentInput
    renewal: Optional[RenewalOptions] = None
    closeTaskId: Optional[Id] = None
    duplicates: Literal["allow", "reject"] = "allow"
    today: Optional[ISODate] = None
    expectUpdatedAt: Optional[Timestamp] = None


@router.get("/registry")
def get_registry(claims: dict = Depends(require_auth)) -> dict:
    """The registry with the caller's own subject types merged in (marked ``custom``)."""
    return registry.effective(dynamo.load_state(claims["sub"]))


@router.post("/documents")
def save_document(body: SaveDocumentRequest, claims: dict = Depends(require_auth)):
    user_id = claims["sub"]
    given = body.document.model_dump(exclude_unset=True)
    fields = {k: v for k, v in given.items() if v is not None or k in _NULLABLE}

    prefix = user_prefix(user_id)
    if any(not f["file"]["key"].startswith(prefix) for f in fields.get("files") or []):
        raise HTTPException(status_code=403, detail="File key outside your storage")

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

    # Same shape + household checks as every batch, then one write.
    try:
        puts = [_entity.validate_python(p).model_dump() for p in puts]
    except ValidationError as e:
        err = e.errors()[0]
        raise HTTPException(status_code=400, detail=f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}")
    expect = []
    if body.expectUpdatedAt and fields.get("id"):
        expect = [{"kind": "document", "id": fields["id"], "updatedAt": body.expectUpdatedAt}]
    stamp = write(user_id, state, puts, deletes, expect)

    stamped = [{**p, "updatedAt": stamp} for p in puts]
    doc = next(p for p in stamped if p["kind"] == "document" and p["id"] == doc["id"])
    return {"document": doc, "changes": {"put": stamped, "delete": deletes}, "summary": summary}

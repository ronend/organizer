"""State routes — the whole household in one read, changes in one write.

GET  /api/state   → {schemaVersion: 2, subjects, tasks, documents, reservations,
                     routines, assignments, contacts, needsMigration}
                    ``needsMigration`` is true when the user only has version 1
                    rows (see POST /api/migrate).
POST /api/batch   → body ChangeSet {put: Entity[], delete: {kind,id}[],
                    expect?: {kind,id,updatedAt|null}[]}
                    → {ok: true, updatedAt}

Every batch is validated against the household it would produce
(src/integrity.py): registry fields, references, subtask rules, and no
deleting a record something still references. 400 lists the problems;
409 when an expectation failed (the record changed since it was read).

Both require a Cognito access token; records are scoped by its ``sub``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from src import integrity
from src.db import dynamo
from src.middleware.auth import require_auth
from src.models import SCHEMA_VERSION, ChangeSet, file_refs

MAX_OPERATIONS = 500
MAX_ERRORS_SHOWN = 20

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])


def user_prefix(user_id: str) -> str:
    """S3 key prefix owned by a user; every FileRef must live under it."""
    return f"u/{user_id}/"


def check_files(entities, user_id: str) -> None:
    prefix = user_prefix(user_id)
    for entity in entities:
        for ref in file_refs(entity):
            if not ref.key.startswith(prefix):
                raise HTTPException(status_code=403, detail=f"File key outside your storage: {entity.kind} {entity.id}")


def raise_integrity(errors: list[str]) -> None:
    if errors:
        shown = errors[:MAX_ERRORS_SHOWN]
        more = f" (+{len(errors) - len(shown)} more)" if len(errors) > len(shown) else ""
        raise HTTPException(status_code=400, detail="; ".join(shown) + more)


def write(user_id: str, state: dict, puts: list[dict], deletes: list[dict], expect: list[dict] = ()) -> str:
    """Validate a change against the household and write it (shared by the routes)."""
    after = integrity.apply(state, puts, deletes)
    raise_integrity(integrity.check(after, puts, deletes))
    try:
        return dynamo.apply_changes(user_id, puts, deletes, expect)
    except dynamo.ConflictError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except dynamo.StaleError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/state")
def get_state(claims: dict = Depends(require_auth)) -> dict:
    user_id = claims["sub"]
    state = dynamo.load_state(user_id)
    empty = not any(state.values())
    return {
        "schemaVersion": SCHEMA_VERSION,
        **state,
        "needsMigration": empty and dynamo.has_items(user_id, dynamo.V1_PREFIX),
    }


@router.post("/batch")
def post_batch(body: ChangeSet, claims: dict = Depends(require_auth)) -> dict:
    user_id = claims["sub"]
    if len(body.put) + len(body.delete) > MAX_OPERATIONS:
        raise HTTPException(status_code=400, detail=f"A batch may contain at most {MAX_OPERATIONS} operations")
    check_files(body.put, user_id)

    keys = [(e.kind, e.id) for e in body.put] + [(r.kind, r.id) for r in body.delete]
    if len(keys) != len(set(keys)):
        raise HTTPException(status_code=400, detail="A record appears more than once in the batch")

    puts = [e.model_dump() for e in body.put]
    deletes = [r.model_dump() for r in body.delete]
    stamp = write(user_id, dynamo.load_state(user_id), puts, deletes, [e.model_dump() for e in body.expect])
    return {"ok": True, "updatedAt": stamp}

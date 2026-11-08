"""State routes — the whole household in one read, changes in one write.

GET  /api/state   → CooState (every record, grouped by collection)
POST /api/batch   → body ChangeSet {put: Entity[], delete: {kind,id}[]}
                    → {ok: true, updatedAt}

Both require a Cognito access token; records are scoped by its ``sub``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from src.db import dynamo
from src.middleware.auth import require_auth
from src.models import ChangeSet, file_refs

MAX_OPERATIONS = 500

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])


def user_prefix(user_id: str) -> str:
    """S3 key prefix owned by a user; every FileRef must live under it."""
    return f"u/{user_id}/"


@router.get("/state")
def get_state(claims: dict = Depends(require_auth)) -> dict:
    return dynamo.load_state(claims["sub"])


@router.post("/batch")
def post_batch(body: ChangeSet, claims: dict = Depends(require_auth)) -> dict:
    user_id = claims["sub"]

    if len(body.put) + len(body.delete) > MAX_OPERATIONS:
        raise HTTPException(
            status_code=400, detail=f"A batch may contain at most {MAX_OPERATIONS} operations"
        )

    prefix = user_prefix(user_id)
    for entity in body.put:
        for ref in file_refs(entity):
            if not ref.key.startswith(prefix):
                raise HTTPException(
                    status_code=403,
                    detail=f"File key outside your storage: {entity.kind} {entity.id}",
                )

    try:
        stamp = dynamo.apply_changes(
            user_id,
            [e.model_dump() for e in body.put],
            [r.model_dump() for r in body.delete],
        )
    except dynamo.ConflictError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"ok": True, "updatedAt": stamp}

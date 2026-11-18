"""POST /api/migrate — move the caller's household from version 1 to version 2.

body {dryRun?: bool}
→ {migrated: bool, counts: {kind: n}, notes: [...], errors: [...]}

Reads the caller's version 1 rows (COO#...), maps them (src/migration.py),
validates every result with the v2 models and the household checks, and only
then writes the v2 rows (V2#...). The version 1 rows are left untouched, so
rolling back is redeploying the previous version.

409 if the caller already has version 2 rows; 422 (with errors, nothing
written) if any migrated record fails validation.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import TypeAdapter, ValidationError

from src import integrity, migration
from src.db import dynamo
from src.middleware.auth import require_auth
from src.models import Entity, _Strict
from src.routes.state import user_prefix

router = APIRouter(prefix="/api", dependencies=[Depends(require_auth)])
_entity = TypeAdapter(Entity)


class MigrateRequest(_Strict):
    dryRun: bool = False


def run(user_id: str, dry_run: bool) -> tuple[int, dict]:
    if dynamo.has_items(user_id, dynamo.SK_PREFIX):
        return 409, {"migrated": False, "detail": "Already on version 2"}
    v1 = migration.group_v1(dynamo.load_items(user_id, dynamo.V1_PREFIX))
    records, report = migration.migrate(v1)

    errors: list[str] = []
    prefix = user_prefix(user_id)
    for r in records:
        try:
            _entity.validate_python(r)
        except ValidationError as e:
            errors.append(f"{r['kind']} {r['id']}: {e.errors()[0]['msg']}")
        for f in r.get("files", []):
            if not f["file"]["key"].startswith(prefix):
                errors.append(f"{r['kind']} {r['id']}: file outside your storage")
    errors += integrity.check_all(migration.to_state(records))
    body = {"migrated": False, **report, "errors": errors}
    if errors:
        return 422, body
    if not dry_run and records:
        dynamo.apply_changes(user_id, records, [])
        body["migrated"] = True
    return 200, body


@router.post("/migrate")
def migrate(body: MigrateRequest | None = None, claims: dict = Depends(require_auth)):
    status, out = run(claims["sub"], bool(body and body.dryRun))
    if status == 409:
        raise HTTPException(status_code=409, detail=out["detail"])
    return JSONResponse(status_code=status, content=out)

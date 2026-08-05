"""Read-only derived views over the entity model (see entity-model-proposal.md).

- ``GET /api/reminders/upcoming`` — query the flat reminder index, ordered by
  fire_at. Optional ``before`` (ISO datetime) and ``status`` filters. This is the
  notification substrate: routine reminders plus a single trigger per dated item.

(The old shopping view was retired with checklists; story timelines live on the
items router at ``GET /api/items/{id}/timeline``.)
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from src.db import dynamo
from src.middleware.auth import require_auth

reminders_router = APIRouter(prefix="/api/reminders")


@reminders_router.get("/upcoming")
def upcoming_reminders(
    before: Optional[str] = Query(None, description="ISO datetime upper bound on fire_at"),
    status: Optional[str] = Query("pending", description="Filter by reminder status"),
    limit: int = Query(50, ge=1, le=500),
    user: dict = Depends(require_auth),
):
    # An empty status query ("?status=") means "any status".
    st = status or None
    return dynamo.upcoming_reminders(user["sub"], before_iso=before, status=st, limit=limit)

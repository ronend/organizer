"""Read-only derived views over the event model (see data-structure.md).

- ``GET /api/reminders/upcoming`` — query the flat reminders_index, ordered by
  fire_at. Optional ``before`` (ISO datetime) and ``status`` filters.
- ``GET /api/views/shopping`` — checklist items across all events that need
  purchasing and aren't yet purchased.
"""

from typing import Optional

from fastapi import APIRouter, Depends, Query

from src.db import dynamo
from src.middleware.auth import require_auth

reminders_router = APIRouter(prefix="/api/reminders")
views_router = APIRouter(prefix="/api/views")


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


@views_router.get("/shopping")
def shopping_list(user: dict = Depends(require_auth)):
    return dynamo.shopping_list(user["sub"])

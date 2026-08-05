"""Entity CRUD routes — the flat 7-type model (see entity-model-proposal.md).

Every item is one of seven sibling types, modeled as a Pydantic discriminated
union tagged by ``type``: todo | appointment | habit | routine | reservation |
event | story. FastAPI validates the correct shape per ``type`` on create; PUT
re-validates the merged document against the existing item's type.

The auth dependency runs first on every route, so ``user["sub"]`` is the verified
userId. userId is ALWAYS taken from the JWT — never from the body or query.
"""

from typing import Annotated, Any, Literal, Optional, Union

from fastapi import APIRouter, Body, Depends, HTTPException, Response
from pydantic import AfterValidator, BaseModel, Field, model_validator

from src import recurrence as rec
from src.db import dynamo
from src.middleware.auth import require_auth

router = APIRouter(prefix="/api/items")

RESERVATION_SUBTYPES = ("hotel", "flight", "tour", "activity", "restaurant")


# ── Reusable validated field types ─────────────────────────────────────────────


def _check_title(v: str) -> str:
    v = (v or "").strip()
    if not v:
        raise ValueError("title is required")
    return v


def _check_dt(v: str) -> str:
    if not v or rec.parse_iso(v) is None:
        raise ValueError("must be a valid ISO 8601 date-time")
    return v


Title = Annotated[str, AfterValidator(_check_title)]
IsoDateTime = Annotated[str, AfterValidator(_check_dt)]
Weekday = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


# ── Sub-schemas ────────────────────────────────────────────────────────────────


class ContactDetails(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


class DailyRule(BaseModel):
    freq: Literal["daily"]
    interval: int = Field(default=1, ge=1)


class WeeklyRule(BaseModel):
    freq: Literal["weekly"]
    interval: int = Field(default=1, ge=1)
    days: list[Weekday] = Field(min_length=1)


class EveryNDaysRule(BaseModel):
    freq: Literal["every_n_days"]
    n: int = Field(ge=1)


class MonthlyRule(BaseModel):
    freq: Literal["monthly"]
    interval: int = Field(default=1, ge=1)
    day_of_month: int = Field(ge=1, le=31)


RecurrenceRule = Annotated[
    Union[DailyRule, WeeklyRule, EveryNDaysRule, MonthlyRule],
    Field(discriminator="freq"),
]


class OffsetReminder(BaseModel):
    kind: Literal["offset"]
    offset: str  # e.g. "-2h", "-1d", "-30m"


class AbsoluteReminder(BaseModel):
    kind: Literal["absolute"]
    at: IsoDateTime


ReminderTime = Annotated[
    Union[OffsetReminder, AbsoluteReminder], Field(discriminator="kind")
]


# ── The seven entity input models ──────────────────────────────────────────────


class TodoIn(BaseModel):
    type: Literal["todo"]
    title: Title
    due_at: IsoDateTime
    completed: bool = False


class AppointmentIn(BaseModel):
    type: Literal["appointment"]
    title: Title
    date_time: IsoDateTime
    location: Optional[str] = None
    contact: ContactDetails = Field(default_factory=ContactDetails)
    things_to_bring: list[str] = Field(default_factory=list)
    completed: bool = False


class HabitIn(BaseModel):
    type: Literal["habit"]
    title: Title
    recurrence: RecurrenceRule
    completion_log: dict[str, bool] = Field(default_factory=dict)


class RoutineIn(BaseModel):
    type: Literal["routine"]
    title: Title
    due_at: IsoDateTime
    reminders: list[ReminderTime] = Field(default_factory=list)
    completed: bool = False


class ReservationIn(BaseModel):
    type: Literal["reservation"]
    title: Title
    subtype: Literal["hotel", "flight", "tour", "activity", "restaurant"]
    date_time: IsoDateTime
    location: Optional[str] = None
    details: Union[str, dict[str, Any], None] = None
    reservation_number: Optional[str] = None


class EventIn(BaseModel):
    type: Literal["event"]
    title: Title
    start_at: IsoDateTime
    end_at: IsoDateTime
    details: Optional[str] = None

    @model_validator(mode="after")
    def _end_after_start(self) -> "EventIn":
        s, e = rec.parse_iso(self.start_at), rec.parse_iso(self.end_at)
        if s and e and e < s:
            raise ValueError("end_at must be greater than or equal to start_at")
        return self


class StoryIn(BaseModel):
    type: Literal["story"]
    title: Title
    item_refs: list[str] = Field(default_factory=list)  # reservation/event ids only


CreateEntity = Annotated[
    Union[TodoIn, AppointmentIn, HabitIn, RoutineIn, ReservationIn, EventIn, StoryIn],
    Field(discriminator="type"),
]

MODEL_BY_TYPE: dict[str, type[BaseModel]] = {
    "todo": TodoIn,
    "appointment": AppointmentIn,
    "habit": HabitIn,
    "routine": RoutineIn,
    "reservation": ReservationIn,
    "event": EventIn,
    "story": StoryIn,
}

# Fields the server owns — never accepted from the client on update.
_SERVER_FIELDS = {"id", "created_at", "updated_at"}


# ── Story reference integrity ──────────────────────────────────────────────────


def _validate_story_refs(user_id: str, refs: list[str]) -> None:
    """Every ref must resolve to an existing reservation/event owned by the user.
    Duplicates are allowed (an item may appear once); refs to other types are not.
    """
    for ref in refs:
        target = dynamo.get_entity(user_id, ref)
        if target is None:
            raise HTTPException(status_code=400, detail=f"story references unknown item: {ref}")
        if target.get("type") not in ("reservation", "event"):
            raise HTTPException(
                status_code=400,
                detail=f"story items must be reservations or events, not {target.get('type')}: {ref}",
            )


# ── Routes ──────────────────────────────────────────────────────────────────────


@router.get("")
def list_items(
    type: Optional[str] = None,
    user: dict = Depends(require_auth),
):
    return dynamo.list_entities(user["sub"], entity_type=type)


@router.get("/{item_id}")
def get_item(item_id: str, user: dict = Depends(require_auth)):
    item = dynamo.get_entity(user["sub"], item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@router.post("", status_code=201)
def create_item(body: CreateEntity = Body(...), user: dict = Depends(require_auth)):
    data = body.model_dump()
    if data["type"] == "story":
        _validate_story_refs(user["sub"], data.get("item_refs", []))
    return dynamo.create_entity(user["sub"], data)


@router.put("/{item_id}")
def update_item(
    item_id: str,
    updates: dict[str, Any] = Body(...),
    user: dict = Depends(require_auth),
):
    existing = dynamo.get_entity(user["sub"], item_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Item not found")

    item_type = existing["type"]
    if "type" in updates and updates["type"] != item_type:
        raise HTTPException(status_code=400, detail="item type is immutable")

    # Merge partial updates over the existing record, then re-validate the whole
    # document against its type so per-type invariants still hold.
    merged = {**existing, **updates, "type": item_type}
    for f in _SERVER_FIELDS:
        merged.pop(f, None)
    try:
        validated = MODEL_BY_TYPE[item_type](**merged)
    except Exception as exc:  # pydantic ValidationError → 400
        raise HTTPException(status_code=400, detail=str(exc))

    data = validated.model_dump()
    if item_type == "story":
        _validate_story_refs(user["sub"], data.get("item_refs", []))

    updated = dynamo.update_entity(user["sub"], item_id, data)
    if updated is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return updated


class HabitLog(BaseModel):
    date: str  # "YYYY-MM-DD"
    completed: bool = True


@router.post("/{item_id}/log")
def log_habit(item_id: str, body: HabitLog, user: dict = Depends(require_auth)):
    """Record a habit occurrence as completed/not for a given date."""
    updated = dynamo.log_habit_occurrence(user["sub"], item_id, body.date, body.completed)
    if updated is None:
        raise HTTPException(status_code=404, detail="Habit not found")
    return updated


@router.get("/{item_id}/timeline")
def story_timeline(item_id: str, user: dict = Depends(require_auth)):
    """Derived chronological timeline of a story's reservations and events."""
    result = dynamo.story_timeline(user["sub"], item_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Story not found")
    return result


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: str, user: dict = Depends(require_auth)):
    dynamo.delete_entity(user["sub"], item_id)
    return Response(status_code=204)

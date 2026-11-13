"""Pydantic models for the coo data model.

Mirrors ``frontend/src/types/coo.ts`` exactly — same camelCase field names, same
nullability, extra fields forbidden. Every stored record carries a ``kind``
discriminator and an ``id``; ``Entity`` is the discriminated union over ``kind``.

Validation is deliberately light (shapes, enums, date formats, sizes). Ownership
checks that need the caller's identity (e.g. FileRef keys under ``u/<sub>/``)
live in the routes, not here.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

# ── Scalar types ────────────────────────────────────────────────────────────

ISODate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
LocalDateTime = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")]
# Full ISO 8601 with zone; kept loose (the server overwrites updatedAt anyway).
Timestamp = Annotated[str, Field(min_length=1, max_length=40)]
Id = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]

Title = Annotated[str, Field(max_length=300)]
Short = Annotated[str, Field(max_length=300)]
Long = Annotated[str, Field(max_length=5000)]
# Task notes are rich text (sanitized HTML from the editor) or legacy plain text.
RichText = Annotated[str, Field(max_length=20000)]
Tiny = Annotated[str, Field(max_length=100)]

SubjectType = Literal["person", "car"]
ContactGroup = Literal["health", "cars", "other"]
Area = Literal["health", "identity", "car"]
StepKind = Literal["plain", "schedule", "renew", "pickup"]
DocKind = Literal["car", "health", "identity"]
TripTaskKind = Literal["book", "checkin"]
ReservationType = Literal["flight", "stay", "car", "activity", "hike", "train", "other"]

EntityKind = Literal[
    "person",
    "car",
    "contact",
    "routine",
    "assignment",
    "task",
    "document",
    "trip",
    "reservation",
]

ENTITY_KINDS: tuple[str, ...] = (
    "person",
    "car",
    "contact",
    "routine",
    "assignment",
    "task",
    "document",
    "trip",
    "reservation",
)

# kind → CooState collection key
STATE_KEYS: dict[str, str] = {
    "person": "people",
    "car": "cars",
    "contact": "contacts",
    "routine": "routines",
    "assignment": "assignments",
    "task": "tasks",
    "document": "documents",
    "trip": "trips",
    "reservation": "reservations",
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


# ── Nested models ───────────────────────────────────────────────────────────


class FileRef(_Strict):
    key: Annotated[str, Field(min_length=1, max_length=1024)]
    name: Annotated[str, Field(min_length=1, max_length=255)]
    contentType: Annotated[str, Field(max_length=255)]
    size: Annotated[int, Field(ge=0)]


class DocTaskSpec(_Strict):
    docKind: DocKind
    docType: Short


class StepPlan(_Strict):
    title: Title
    offsetDays: int
    kind: StepKind
    prep: Long
    docTask: Optional[DocTaskSpec]


class MedicationSupply(_Strict):
    onHand: float
    asOf: ISODate
    perDay: float
    unit: Tiny
    perRefill: float
    refillsLeft: int
    orderLeadDays: int


class HistoryEntry(_Strict):
    date: ISODate
    text: Long


class Subtask(_Strict):
    id: Id
    title: Annotated[str, Field(min_length=1, max_length=300)]
    done: bool
    # Optional due date; missing on sub-tasks saved before dates existed.
    date: Optional[ISODate] = None


class AppointmentInfo(_Strict):
    time: Annotated[str, Field(pattern=r"^(\d{2}:\d{2})?$")]
    providerId: Optional[Id]
    providerNote: Long
    prep: Long


class DetailRow(_Strict):
    name: Short
    value: Long


# ── Entities ────────────────────────────────────────────────────────────────


class _Base(_Strict):
    id: Id
    createdAt: Timestamp
    updatedAt: Timestamp


class Person(_Base):
    kind: Literal["person"]
    name: Title
    birthYear: Optional[int]


class Car(_Base):
    kind: Literal["car"]
    makeModel: Title
    plate: Tiny
    odometer: Optional[float]


class Contact(_Base):
    kind: Literal["contact"]
    name: Title
    role: Short
    phone: Tiny
    group: ContactGroup
    notes: Long


class Routine(_Base):
    kind: Literal["routine"]
    area: Area
    template: Optional[Tiny]
    icon: Tiny
    title: Title
    description: Long
    dateLabel: Tiny
    plan: Annotated[list[StepPlan], Field(max_length=100)]
    followUps: Annotated[list[StepPlan], Field(max_length=100)]
    repeatMonths: Optional[int]
    countFrom: Literal["done", "due"]
    medication: bool


class Assignment(_Base):
    kind: Literal["assignment"]
    routineId: Id
    subjectType: SubjectType
    subjectId: Id
    date: Optional[ISODate]
    repeatMonths: Optional[int]
    done: bool
    contactId: Optional[Id]
    supply: Optional[MedicationSupply]
    history: Annotated[list[HistoryEntry], Field(max_length=1000)]
    # Per-assignee overrides of the routine's rules. None = use the routine's.
    # Defaults keep assignments saved before overrides existed valid.
    plan: Optional[Annotated[list[StepPlan], Field(max_length=50)]] = None
    countFrom: Optional[Literal["done", "due"]] = None


class Task(_Base):
    kind: Literal["task"]
    title: Title
    notes: RichText
    date: Optional[ISODate]
    order: float
    done: bool
    doneAt: Optional[Timestamp]
    subjectType: Optional[SubjectType]
    subjectId: Optional[Id]
    assignmentId: Optional[Id]
    stepKind: StepKind
    appointment: Optional[AppointmentInfo]
    tripId: Optional[Id]
    reservationId: Optional[Id]
    tripTask: Optional[TripTaskKind]
    docTask: Optional[DocTaskSpec]
    # Checklist inside the task. Defaults to [] so tasks saved before
    # sub-tasks existed stay valid.
    subtasks: Annotated[list[Subtask], Field(max_length=100)] = Field(default_factory=list)


class Document(_Base):
    kind: Literal["document"]
    docKind: DocKind
    subjectType: SubjectType
    subjectId: Id
    name: Title
    type: Short
    date: Optional[ISODate]
    validUntil: Optional[ISODate]
    idNumber: Short
    issuer: Short
    issueDate: Optional[ISODate]
    details: Annotated[list[DetailRow], Field(max_length=100)]
    front: Optional[FileRef]
    back: Optional[FileRef]
    providerId: Optional[Id]
    about: Long
    episode: Short
    file: Optional[FileRef]
    assignmentId: Optional[Id]
    pinned: bool
    archived: bool
    outdated: bool


class Trip(_Base):
    kind: Literal["trip"]
    name: Title
    destination: Short
    start: ISODate
    end: ISODate
    travelers: Annotated[list[Id], Field(max_length=100)]
    notes: Long

    @model_validator(mode="after")
    def _end_after_start(self) -> "Trip":
        if self.end < self.start:
            raise ValueError("trip end must be on or after start")
        return self


class Reservation(_Base):
    kind: Literal["reservation"]
    tripId: Id
    type: ReservationType
    title: Title
    start: LocalDateTime
    end: Optional[LocalDateTime]
    address: Long
    confirmation: Short
    link: Annotated[str, Field(max_length=2000)]
    files: Annotated[list[FileRef], Field(max_length=50)]
    status: Literal["booked", "planned"]
    bookBy: Optional[ISODate]
    details: Long
    checkinReminder: bool

    @model_validator(mode="after")
    def _end_after_start(self) -> "Reservation":
        if self.end is not None and self.end < self.start:
            raise ValueError("reservation end must be on or after start")
        return self


Entity = Annotated[
    Union[Person, Car, Contact, Routine, Assignment, Task, Document, Trip, Reservation],
    Field(discriminator="kind"),
]


# ── API shapes ──────────────────────────────────────────────────────────────


class EntityRef(_Strict):
    kind: EntityKind
    id: Id


class ChangeSet(_Strict):
    """POST /api/batch body. Puts are full records (upserts); deletes by ref."""

    put: list[Entity] = Field(default_factory=list)
    delete: list[EntityRef] = Field(default_factory=list)


def file_refs(entity: BaseModel) -> list[FileRef]:
    """Every FileRef embedded in an entity (documents and reservations)."""
    if isinstance(entity, Document):
        return [f for f in (entity.front, entity.back, entity.file) if f is not None]
    if isinstance(entity, Reservation):
        return list(entity.files)
    return []

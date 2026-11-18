"""Pydantic models for the coo data model, version 2.

Seven record kinds, all hanging off generic subjects:

    subject      a container: person, car, trip, ... (type from the registry)
    task         belongs to a subject (or none = general); ``parentId`` makes
                 it a subtask (one level only)
    document     any file(s) + metadata ``fields``; ``expiry`` only for
                 expiring categories
    reservation  belongs to a subject whose type allows reservations (trip)
    routine      a reusable template
    assignment   a routine applied to one subject
    contact      household-wide; ``links`` tie it to subjects with a role

These models fix the SHAPES (extra fields forbidden, dates, sizes, enums).
Everything the registry defines (subject attributes, document fields, which
kinds a subject allows, ...) and every cross-record rule (references exist,
subtask depth, same subject, uniqueness) is checked in ``integrity.py``
against the whole household. See data-structure.md.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional, Union

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StrictBool, StrictFloat, StrictInt, model_validator

from src import registry

SCHEMA_VERSION = 2

# ── Scalar types ────────────────────────────────────────────────────────────

ISODate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
LocalDateTime = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")]
# Full ISO 8601 with zone; kept loose (the server overwrites updatedAt anyway).
Timestamp = Annotated[str, Field(min_length=1, max_length=40)]
Id = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]

Title = Annotated[str, Field(min_length=1, max_length=300)]
Short = Annotated[str, Field(max_length=300)]
Long = Annotated[str, Field(max_length=5000)]
# Task notes are rich text (sanitized HTML from the editor) or plain text.
RichText = Annotated[str, Field(max_length=20000)]
Tiny = Annotated[str, Field(max_length=100)]

SubjectType = Annotated[str, AfterValidator(registry.check_subject_type)]
Category = Annotated[str, AfterValidator(registry.check_category)]
Area = Annotated[str, AfterValidator(registry.check_area)]
ReservationType = Annotated[str, AfterValidator(registry.check_reservation_type)]
StepKind = Literal["plain", "schedule", "renew", "pickup"]

# Registry-defined field values. Which keys exist and what each holds is
# checked against the field definitions in integrity.py.
FieldKey = Annotated[str, Field(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$")]
FieldValue = Union[
    None,
    StrictBool,
    StrictInt,
    StrictFloat,
    Annotated[str, Field(max_length=5000)],
    Annotated[list[Annotated[str, Field(max_length=300)]], Field(max_length=100)],
]
Fields = Annotated[dict[FieldKey, FieldValue], Field(max_length=100)]

EntityKind = Literal["subject", "task", "document", "reservation", "routine", "assignment", "contact"]
ENTITY_KINDS: tuple[str, ...] = ("subject", "task", "document", "reservation", "routine", "assignment", "contact")

# kind → collection key in GET /api/state
STATE_KEYS: dict[str, str] = {
    "subject": "subjects",
    "task": "tasks",
    "document": "documents",
    "reservation": "reservations",
    "routine": "routines",
    "assignment": "assignments",
    "contact": "contacts",
}


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


# ── Nested models ───────────────────────────────────────────────────────────


class FileRef(_Strict):
    key: Annotated[str, Field(min_length=1, max_length=1024)]
    name: Annotated[str, Field(min_length=1, max_length=255)]
    contentType: Annotated[str, Field(max_length=255)]
    size: Annotated[int, Field(ge=0)]


class DocumentFile(_Strict):
    """One file of a document; ``role`` is one of the category's fileRoles (front/back) or null."""

    role: Optional[Tiny]
    file: FileRef


class DocumentRequest(_Strict):
    """A task or routine step that asks for a document to be added."""

    category: Category
    type: Short


class StepPlan(_Strict):
    title: Annotated[str, Field(max_length=300)]
    offsetDays: int
    kind: StepKind
    prep: Long
    requestsDocument: Optional[DocumentRequest]


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


class AppointmentInfo(_Strict):
    time: Annotated[str, Field(pattern=r"^(\d{2}:\d{2})?$")]
    providerId: Optional[Id]
    providerNote: Long
    prep: Long


class CustomField(_Strict):
    label: Short
    value: Long


class AssignmentSource(_Strict):
    kind: Literal["assignment"]
    id: Id
    step: StepKind


class ReservationSource(_Strict):
    kind: Literal["reservation"]
    id: Id
    step: Literal["book", "checkin"]


TaskSource = Annotated[Union[AssignmentSource, ReservationSource], Field(discriminator="kind")]


class AttachedTo(_Strict):
    kind: Literal["task", "reservation"]
    id: Id


class Expiry(_Strict):
    validUntil: ISODate
    # Replaced by a newer document; its expiry no longer drives anything.
    outdated: bool = False


class ContactLink(_Strict):
    subjectId: Id
    role: Short


class RoutineExtension(_Strict):
    medication: bool = False


# ── Entities ────────────────────────────────────────────────────────────────


class _Base(_Strict):
    id: Id
    createdAt: Timestamp
    updatedAt: Timestamp
    archived: bool = False


class Subject(_Base):
    kind: Literal["subject"]
    subjectType: SubjectType
    name: Title
    notes: Long = ""
    attributes: Fields = Field(default_factory=dict)


class Task(_Base):
    kind: Literal["task"]
    subjectId: Optional[Id]
    parentId: Optional[Id] = None
    title: Title
    notes: RichText = ""
    date: Optional[ISODate]
    order: float
    done: bool
    doneAt: Optional[Timestamp]
    source: Optional[TaskSource] = None
    appointment: Optional[AppointmentInfo] = None
    requestsDocument: Optional[DocumentRequest] = None

    @model_validator(mode="after")
    def _subtask_is_plain(self) -> "Task":
        if self.parentId is not None:
            if self.parentId == self.id:
                raise ValueError("a task can't be its own parent")
            if self.source is not None or self.appointment is not None:
                raise ValueError("a subtask can't have a source or an appointment")
        return self


class Document(_Base):
    kind: Literal["document"]
    subjectId: Id
    attachedTo: Optional[AttachedTo] = None
    category: Category
    type: Short
    title: Title
    date: Optional[ISODate] = None
    files: Annotated[list[DocumentFile], Field(max_length=20)] = Field(default_factory=list)
    fields: Fields = Field(default_factory=dict)
    customFields: Annotated[list[CustomField], Field(max_length=100)] = Field(default_factory=list)
    assignmentId: Optional[Id] = None
    pinned: bool = False
    expiry: Optional[Expiry] = None


class Reservation(_Base):
    kind: Literal["reservation"]
    subjectId: Id
    type: ReservationType
    title: Title
    start: LocalDateTime
    end: Optional[LocalDateTime]
    status: Literal["booked", "planned"]
    bookBy: Optional[ISODate]
    checkinReminder: bool
    fields: Fields = Field(default_factory=dict)

    @model_validator(mode="after")
    def _end_after_start(self) -> "Reservation":
        if self.end is not None and self.end < self.start:
            raise ValueError("reservation end must be on or after start")
        return self


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
    extension: Optional[RoutineExtension] = None


class Assignment(_Base):
    kind: Literal["assignment"]
    routineId: Id
    subjectId: Id
    date: Optional[ISODate]
    repeatMonths: Optional[int]
    done: bool
    contactId: Optional[Id]
    supply: Optional[MedicationSupply]
    history: Annotated[list[HistoryEntry], Field(max_length=1000)]
    # Per-assignee overrides of the routine's rules. None = use the routine's.
    plan: Optional[Annotated[list[StepPlan], Field(max_length=50)]] = None
    countFrom: Optional[Literal["done", "due"]] = None


class Contact(_Base):
    kind: Literal["contact"]
    name: Title
    role: Short = ""            # the contact's own title, e.g. "Orthopedist"
    phone: Tiny = ""
    email: Short = ""
    notes: Long = ""
    tags: Annotated[list[Tiny], Field(max_length=20)] = Field(default_factory=list)
    links: Annotated[list[ContactLink], Field(max_length=200)] = Field(default_factory=list)


Entity = Annotated[
    Union[Subject, Task, Document, Reservation, Routine, Assignment, Contact],
    Field(discriminator="kind"),
]


# ── API shapes ──────────────────────────────────────────────────────────────


class EntityRef(_Strict):
    kind: EntityKind
    id: Id


class Expectation(_Strict):
    """Optimistic concurrency: the write only applies if the stored record's
    ``updatedAt`` still equals this (null = the record must not exist yet)."""

    kind: EntityKind
    id: Id
    updatedAt: Optional[Timestamp]


class ChangeSet(_Strict):
    """POST /api/batch body. Puts are full records (upserts); deletes by ref."""

    put: list[Entity] = Field(default_factory=list)
    delete: list[EntityRef] = Field(default_factory=list)
    expect: list[Expectation] = Field(default_factory=list)


def file_refs(entity: BaseModel) -> list[FileRef]:
    """Every FileRef embedded in an entity (only documents hold files)."""
    if isinstance(entity, Document):
        return [f.file for f in entity.files]
    return []

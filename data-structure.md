# Personal Organizer — Data Structure (implemented)

> **Model:** a flat discriminated union of seven sibling entity types, tagged by
> `type`. This document is the **storage/persistence reference**. For the
> field-level type definitions and validation rules of each type, see
> [entity-model-proposal.md](entity-model-proposal.md), which the backend
> (`backend/src/routes/items.py`) and frontend (`frontend/src/types/organizer.ts`)
> both mirror exactly.
>
> This supersedes the previous hierarchical `event`/`item`/`kind` model.

---

## The seven types

Every item is exactly one of these, discriminated by `type`:

| `type` | Required fields (beyond `title`) | Notes |
|---|---|---|
| `todo` | `due_at`, `completed` | a single task |
| `appointment` | `date_time`, `contact`, `completed` | + `location`, `things_to_bring[]` |
| `habit` | `recurrence` | recurs indefinitely; `completion_log` (date→bool) |
| `routine` | `due_at`, `reminders[]`, `completed` | the ONLY multi-reminder type |
| `reservation` | `subtype`, `date_time` | `subtype ∈ {hotel, flight, tour, activity, restaurant}` |
| `event` | `start_at`, `end_at` | `end_at >= start_at` |
| `story` | `item_refs[]` | ordered refs to reservation/event ids only; timeline is derived |

Shared base on every entity: `id`, `type`, `title`, `created_at`, `updated_at`.

---

## Storage — DynamoDB single table

Partition key `userId`; the sort key (`SK`) carries a collection prefix.

```
ITEM#<id>                     → one entity document (all fields as attributes)
REMIDX#<fire_at>#<row_id>     → a flat reminder-index row (notification queries only)
```

- **`ITEM#`** — list all of a user's items with `begins_with(SK, "ITEM#")`; the
  `type` attribute discriminates. Sorting by date is done in the app.
- **`REMIDX#`** — a write-through projection, **never the source of truth**. The
  `SK` puts `fire_at` first so it sorts chronologically (ISO 8601 is
  lexicographically ordered). Re-synced on every entity write, deleted with the
  entity. See "Reminder index" below.

IDs are `<type>_<nanoid(6)>`, e.g. `todo_a1b2c3`, `story_x9y8z7` — self-describing
and collision-free across types.

---

## Reminder index (notification substrate)

`_index_entries` in `backend/src/db/dynamo.py` projects each entity's notification
triggers into `REMIDX#` rows:

- **routine** → one row per scheduled reminder. `{kind:"offset", offset:"-2h"}` is
  resolved against `due_at`; `{kind:"absolute", at:...}` is used verbatim.
- **todo / appointment / reservation / event** → a single row at the item's own
  date (`due_at` / `date_time` / `start_at`).
- **habit / story** → none.

Only routines contribute multiple rows — no other type gains a multi-reminder
capability (per the spec). Row shape:

```json
{ "id": "<row id>", "source_id": "<entity id>", "source_type": "<type>",
  "title": "<entity title>", "fire_at": "<ISO datetime>", "status": "pending" }
```

Query: `GET /api/reminders/upcoming?before=<ISO>&status=pending` → ordered by
`fire_at`.

---

## Derived views (not stored)

- **All items** — every entity, sorted by its relevant date (`due_at` /
  `date_time` / `start_at`); habits and stories sort last. Client:
  `frontend/src/lib/derive.sortedByDate`.
- **Story timeline** — resolve a story's `item_refs` to reservations/events and
  sort by start time (`reservation.date_time`, `event.start_at`); missing or
  wrong-type refs are skipped. Server: `GET /api/items/{id}/timeline`; client:
  `derive.storyTimeline`.
- **Upcoming reminders** — the reminder-index query above (client mirror:
  `derive.deriveReminders`).

---

## API surface

Auth (Cognito JWT → `user.sub`) and origin-verify are unchanged; `userId` always
comes from the JWT, never the body.

```
GET    /api/items                 (optional ?type=)
GET    /api/items/{id}
POST   /api/items                 body carries `type`; validated per type
PUT    /api/items/{id}            partial update; type is immutable
DELETE /api/items/{id}
POST   /api/items/{id}/log        habit: { date, completed } → completion_log
GET    /api/items/{id}/timeline   story timeline
GET    /api/reminders/upcoming    notification view
```

---

## Migration from the old model

`scripts/migrate_to_entities.py` flattens the previous hierarchical
`event`/`item` documents into these seven types (`container → story`,
`occurrence → appointment/event/habit`, embedded `reservation → top-level
reservation`, `list` + checklist items → `todo`s, …). It runs with `--dry-run`
and a mandatory `--backup`, and never drops data — templates and attachments
(which have no equivalent type) survive in the backup JSON. See
[entity-model-proposal.md §9](entity-model-proposal.md) for the full mapping.

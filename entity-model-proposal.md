# Entity Model Refactor — Proposal (for review before implementation)

> **Decision taken:** clean flat rewrite of the domain model into 7 sibling entity
> types (discriminated union tagged by `type`). Breaking API/MCP changes are
> acceptable. This document is the pre-implementation gate: it defines the concrete
> schema, the migration path for existing data, the affected files, and the
> assumptions made. Nothing is implemented yet.

---

## 1. Conventions

- **Field naming:** `snake_case` everywhere (API payloads, DynamoDB attributes,
  and — as the current frontend already does deliberately — the TS types). The
  spec is written in camelCase; the mapping is `dueDateTime → due_at`,
  `dateTime → date_time`, `startDateTime → start_at`, `endDateTime → end_at`,
  `contactDetails → contact`, `thingsToBring → things_to_bring`,
  `recurrenceDefinition → recurrence`, `completionLog → completion_log`,
  `scheduledReminders → reminders`, `reservationNumber → reservation_number`.
- **Discriminator:** `type`.
- **Timestamps / datetimes:** ISO 8601 strings. Date-time fields carry a time
  component; there are no date-only fields in the new model.
- **IDs:** `<type>_<nanoid(6)>`, e.g. `todo_a1b2c3`, `story_x9y8z7`.

## 2. Entity type enum

```ts
export const ENTITY_TYPES = [
  'todo', 'appointment', 'habit', 'routine', 'reservation', 'event', 'story',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
```

## 3. Shared base

Every entity has exactly these common fields; per-type fields are added on top.

```ts
interface BaseEntity {
  id: string;
  type: EntityType;
  title: string;          // required, non-empty
  created_at: string;     // ISO datetime, server-assigned
  updated_at: string;     // ISO datetime, server-assigned
}
```

`completed` is present only on the types the spec lists it for (`todo`,
`appointment`, `routine`). It is deliberately **not** hoisted into the base.

## 4. Sub-schemas

### RecurrenceRule (habit) — discriminated by `freq`

```ts
type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

type RecurrenceRule =
  | { freq: 'daily';        interval?: number }              // every `interval` days (default 1)
  | { freq: 'weekly';       interval?: number; days: Weekday[] } // weekly on specific weekdays
  | { freq: 'every_n_days'; n: number }                      // every N days
  | { freq: 'monthly';      interval?: number; day_of_month: number }; // monthly on a date (1–31)
```

### ReminderTime (routine only) — discriminated by `kind`

```ts
type ReminderTime =
  | { kind: 'offset';   offset: string }  // relative to due_at, e.g. "-2h", "-1d", "-30m"
  | { kind: 'absolute'; at: string };     // absolute ISO datetime
```

### ContactDetails (appointment)

```ts
interface ContactDetails {   // container is required; every field optional
  name?: string;
  phone?: string;
  email?: string;
}
```

## 5. The seven entities (concrete union)

```ts
interface Todo extends BaseEntity {
  type: 'todo';
  due_at: string;            // required
  completed: boolean;
}

interface Appointment extends BaseEntity {
  type: 'appointment';
  date_time: string;         // required
  location: string | null;
  contact: ContactDetails;   // required container (may be {})
  things_to_bring: string[];
  completed: boolean;
}

interface Habit extends BaseEntity {
  type: 'habit';
  recurrence: RecurrenceRule;              // required; no fixed due date
  completion_log: Record<string, boolean>; // "YYYY-MM-DD" -> completed
  // derived (not stored): current_streak, computed from completion_log + recurrence
}

interface Routine extends BaseEntity {
  type: 'routine';
  due_at: string;            // required
  reminders: ReminderTime[]; // 0..n — the ONLY multi-reminder type
  completed: boolean;
}

interface Reservation extends BaseEntity {
  type: 'reservation';
  subtype: 'hotel' | 'flight' | 'tour' | 'activity' | 'restaurant'; // required, validated
  date_time: string;         // required
  location: string | null;
  details: string | Record<string, unknown> | null; // generic in v1
  reservation_number: string | null;
}

interface Event extends BaseEntity {
  type: 'event';
  start_at: string;          // required
  end_at: string;            // required, must be >= start_at
  details: string | null;
}

interface Story extends BaseEntity {
  type: 'story';
  item_refs: string[];       // ordered ids of reservation/event entities ONLY
  // derived (not stored): timeline — refs resolved and sorted by start time
  //   (reservation.date_time, event.start_at); missing/deleted refs skipped
}

export type Entity =
  | Todo | Appointment | Habit | Routine | Reservation | Event | Story;
```

The Python/Pydantic layer mirrors this as a `Field(discriminator="type")` union
of seven `BaseModel`s, so FastAPI validates the right shape per `type` and
rejects unknown discriminators.

## 6. Validation rules (enforced on create + edit)

| Type | Rules |
|---|---|
| all | `title` non-empty |
| todo, routine | `due_at` required and parseable |
| appointment, reservation | `date_time` required and parseable |
| event | `start_at`, `end_at` required; `end_at >= start_at` |
| reservation | `subtype ∈ {hotel, flight, tour, activity, restaurant}` |
| habit | `recurrence` valid for its `freq` (e.g. weekly requires ≥1 weekday; monthly `day_of_month` 1–31; `every_n_days` n ≥ 1) |
| story | every `item_refs[i]` resolves to an existing entity **owned by the same user** whose `type` is `reservation` or `event`; refs to any other type are rejected |

## 7. Storage (DynamoDB single table)

- Keep partition key `userId`. New sort key: `ITEM#<id>`; the `type` discriminator
  and all per-type fields are stored as attributes.
  - list all: `begins_with(SK, "ITEM#")`, then sort in-app by relevant date.
  - Story timeline resolves refs with `get_item` per ref (small N) or a batch get.
- **Keep** the `reminders_index` projection (`REMIDX#<fire_at>#<id>`) — the
  notification hooks depend on it. It is fed by:
  - each `routine.reminders[]` entry (offsets resolved against `due_at`), and
  - one entry per dated non-routine item at its single datetime
    (`todo.due_at`, `appointment.date_time`, `event.start_at`,
    `reservation.date_time`).
  This honors req #5: only routines contribute multiple reminders; nothing else
  gains a multi-reminder capability.
- **Retire** `TMPL#` templates, embedded checklists, and the shopping projection
  (no equivalent in the 7-type model). Data is preserved via migration (§9), not
  silently dropped.

## 8. API surface (breaking change accepted)

Replaces `/api/events`, `/api/templates`, `/api/views/*`. Auth (Cognito JWT →
`user.sub`) and `origin_verify` are unchanged; `userId` still always comes from
the JWT.

```
GET    /api/items                 # optional ?type= filter; returns all entities
GET    /api/items/{id}
POST   /api/items                 # body carries `type`; validated per type
PUT    /api/items/{id}            # partial update, per-type re-validation
DELETE /api/items/{id}
POST   /api/items/{id}/log        # habit: { date, completed } -> completion_log
GET    /api/stories/{id}/timeline # derived, sorted chronological view
GET    /api/reminders/upcoming    # from reminders_index (notification view)
```

The MCP server tools (`mcp-server/src/tools.py`, `client.py`, `resources.py`) are
rewritten to this surface: `create_item`, `update_item`, `list_items`,
`delete_item`, `log_habit`, `get_story_timeline`, `upcoming_reminders`.

## 9. Migration path for existing data

There are **no flat "generic todo" records** to migrate — existing data is
already structured `EventDocument`s. Migration therefore *flattens* the current
hierarchy into the 7 sibling types. A script
(`scripts/migrate_to_entities.py`) does this per user with `--dry-run`,
writes a full JSON `--backup` of all old rows first, and prints a mapping report.
**Nothing is dropped silently.**

Mapping (best-effort, never-drop):

| Existing | → New |
|---|---|
| `event.kind = container` (trip/project) | `story`; its embedded items are promoted to top-level records and referenced by `item_refs` (in `sort_order`) — only the promoted `reservation`/`event` ones become refs |
| `event.kind = occurrence`, no `end_date` | `appointment` (`date_time ← start_date`); if it has a `recurrence_rule` → `habit` instead |
| `event.kind = occurrence`, has `end_date` | `event` (`start_at ← start_date`, `end_at ← end_date`) |
| `event.kind = habit` | `habit` (`recurrence ← parse(recurrence_rule)`, else `every_n_days`) |
| `event.kind = list` | shell dropped (pure grouping, no dates); each `checklist_item` → `todo` |
| embedded `item.kind = task` | `todo` (`due_at ← due_at ∨ scheduled_at ∨ created_at`) |
| embedded `item.kind = reservation` | `reservation` (`subtype ← map(item.subtype)` into the 5 allowed, else `activity`; `date_time ← scheduled_at ∨ created_at`; `location ← address`; `reservation_number ← confirmation_ref`; `details ← notes/attrs`) |
| embedded `item.kind = entry` | `habit` if parent was a habit, else `todo` |
| embedded `item.kind = checklist_item` / `checklists[]` | each → `todo` (`title ← label`) |
| `reminders[]` (event/item level) | routine-mapped items keep them as `reminders[]`; otherwise collapse to the single reminders_index entry for that item; anything unmappable is recorded in the report |
| `TMPL#` templates | **not migrated** (no equivalent) — exported into the backup JSON so nothing is lost |

**Required-field gaps:** when a target requires a datetime the source lacks, the
script fills from the nearest available (`start_date → scheduled_at → created_at`)
and records the substitution in the report rather than writing an invalid record.

## 10. Assumptions (to confirm — spec deliverable #5)

1. **Story cardinality: many-to-many.** Refs live only on the story as an ordered
   array; reservations/events carry no back-pointer and may be referenced by 0..n
   stories. No cascade on delete — the timeline derivation skips missing refs.
2. **`contact` structure:** an always-present object `{ name?, phone?, email? }`,
   all fields optional (may be `{}`).
3. **`reservation.details` structure:** v1 is `string | object | null` (generic).
   Subtype-specific shapes (flight number/gate vs. room number) are deferred but
   the field is ready to hold them.
4. **Habit `completion_log`:** a `date → boolean` map; streak is derived, not
   stored.
5. **Reservations are not "completable"** (no `completed`), matching the spec.

## 11. Affected files

**Backend:** `routes/events.py` → `routes/items.py` (7-type union + validation);
`db/dynamo.py` (rewrite persistence, keep reminders_index, drop templates/
checklists/shopping); `routes/templates.py` + `routes/views.py` (retire/replace,
add story-timeline + reminders); `recurrence.py` (extend for habit recurrence +
routine offsets); `ids.py` (per-type prefixes); `app.py` (router wiring).

**Frontend:** `types/organizer.ts` (the union above); `components/EventForm.tsx`
→ per-type forms; `KindPicker` → 7-type picker; `EventList`/`EventDetail`/
`TimelineView` updated; new `StoryTimelineView`; `ChecklistEditor`/
`AttachmentEditor`/`AttrsEditor`/`ItemEditor` retired or repurposed;
`lib/derive.ts` (all-items sort + story timeline + reminders); `hooks/useEvents.ts`
→ `useItems`; `api/client.ts` (new endpoints).

**MCP:** `mcp-server/src/{tools,client,resources}.py` rewritten to the new API.

**Scripts/docs:** rewrite `scripts/seed_data.py`; add `scripts/migrate_to_entities.py`;
rewrite `data-structure.md`; touch `README.md`.

## 12. Feature-impact flags (spec Process)

Retired by the clean rewrite (called out so the loss is explicit, not silent):
**checklists**, **reusable templates + auto-apply**, the **shopping view**, the
**container→sub-item hierarchy** (replaced by Story references), and **attachments**.
Decision: all four are retired — attachment metadata is exported to the backup JSON
only, not carried onto the new records. Search/filter/timeline are **kept** but
rebuilt against the flat model.

---

## Proposed build order (after sign-off)

1. Backend types + validation (`routes/items.py`, Pydantic union).
2. Persistence rewrite (`db/dynamo.py`) + reminders_index.
3. Migration script + dry-run against seed data.
4. Frontend types + API client + per-type forms + story timeline.
5. MCP server tools.
6. Docs + seed rewrite.

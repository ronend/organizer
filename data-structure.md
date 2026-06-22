# Personal Organizer — Data Structure Specification

> **Purpose:** Implementation spec for a NoSQL document database (Firestore, MongoDB, or DynamoDB).  
> **Audience:** Claude Code / backend engineer implementing the data layer.

---

## Overview

Three top-level collections. Everything about an event — its items, reminders, checklists, and attachments — lives in a single document. External collections exist only for query performance (`reminders_index`) and reusability (`templates`).

```
collections/
├── events/            # One document per trip, routine, habit, list, todo, etc.
├── reminders_index/   # Flat projection of all reminders — for notification queries only
└── templates/         # Reusable checklist templates — not owned by any event
```

---

## Typing system

Every document and subdocument uses **two type fields**:

| Field | Type | Purpose | Values |
|---|---|---|---|
| `kind` | enum string | Drives **behavior** — rendering, reminder logic, recurrence | See enums below |
| `subtype` | free string | Drives **labeling** — user-visible category, never touched by business logic | Any string: `"flight"`, `"dental routine"`, `"passport renewal"`, `"medication"`, etc. |

### `event.kind` enum
```
container   – A trip, project, or life area with a date span. Holds items and sub-events.
occurrence  – A single appointment or deadline that may recur (dentist, car inspection).
habit       – Lightweight recurring entry driven entirely by reminders (medication, payments).
list        – No dates; items are check-off entries (grocery list, shopping list).
```

### `item.kind` enum
```
task            – Something to do. Has due_at, status, optional prereq chain.
reservation     – A booking with confirmation ref, cost, address (flight, hotel, activity).
entry           – A log entry or recurring action (medication dose, payment verification).
checklist_item  – Belongs to a checklist instance; has needs_purchase flag.
```

---

## Collection: `events`

### Document shape

```typescript
interface EventDocument {
  // ── Identity ──────────────────────────────────────────────
  id:               string;          // e.g. "evt_abc123"
  parent_id:        string | null;   // for sub-events (Day 1 of a trip)

  // ── Classification ────────────────────────────────────────
  kind:             EventKind;       // "container" | "occurrence" | "habit" | "list"
  subtype:          string;          // free string, e.g. "backpacking", "dental routine"
  tags:             string[];        // user-defined, e.g. ["travel", "health", "#urgent"]

  // ── Core fields ───────────────────────────────────────────
  title:            string;
  status:           string;          // "planned" | "active" | "done" | "cancelled" — extensible
  start_date:       string | null;   // ISO 8601 date "2026-07-14"
  end_date:         string | null;   // ISO 8601 date
  recurrence_rule:  string | null;   // RFC 5545 RRULE, e.g. "RRULE:FREQ=MONTHLY;INTERVAL=6"

  // ── Open extension ────────────────────────────────────────
  attrs:            Record<string, any>;  // anything that doesn't deserve a top-level field

  // ── Embedded subdocuments ─────────────────────────────────
  items:            Item[];
  reminders:        Reminder[];      // event-level reminders (not tied to a specific item)
  checklists:       ChecklistInstance[];
  attachments:      Attachment[];

  // ── Metadata ──────────────────────────────────────────────
  created_at:       string;          // ISO 8601 datetime
  updated_at:       string;
}
```

---

### Subdocument: `Item`

```typescript
interface Item {
  // ── Identity ──────────────────────────────────────────────
  id:               string;          // unique within the event, e.g. "itm_001"

  // ── Classification ────────────────────────────────────────
  kind:             ItemKind;        // "task" | "reservation" | "entry" | "checklist_item"
  subtype:          string;          // free string, e.g. "flight", "medication", "hike"
  tags:             string[];

  // ── Core fields ───────────────────────────────────────────
  title:            string;
  status:           string;          // "todo" | "confirmed" | "done" | "cancelled" — extensible
  scheduled_at:     string | null;   // ISO 8601 datetime — when this item happens
  due_at:           string | null;   // ISO 8601 datetime — when a task is due
  sort_order:       number;          // for manual ordering within an event

  // ── Reservation fields (used when kind = "reservation") ───
  confirmation_ref: string | null;   // booking/reservation/order number
  cost:             number | null;
  currency:         string | null;   // ISO 4217, e.g. "USD"
  address:          string | null;
  phone:            string | null;
  url:              string | null;   // booking or management URL
  login_hint:       string | null;   // username/email reminder (never store passwords)

  // ── Task fields ───────────────────────────────────────────
  prereq_ids:       string[];        // item IDs within the same event document

  // ── Open extension ────────────────────────────────────────
  attrs:            Record<string, any>;

  // ── Embedded reminders (belong to this item) ──────────────
  reminders:        Reminder[];
}
```

**`attrs` examples by subtype:**

```js
// subtype: "flight"
attrs: { airline: "Delta", flight_number: "DL442", seat: "14C", terminal: "B", gate: "B22" }

// subtype: "hike"
attrs: { distance_miles: 16, elevation_gain_ft: 3200, gear: ["dry bag", "trekking poles"], permit_required: true }

// subtype: "medication"
attrs: { dosage: "500mg", with_food: true, prescriber: "Dr. Levi", pharmacy: "CVS 86th St", refill_reminder_days: 7 }

// subtype: "hotel"
attrs: { check_in: "2026-07-14", check_out: "2026-07-18", room_type: "King", loyalty_number: "HH-XXXXX" }

// subtype: "lab test"
attrs: { lab_name: "Quest Diagnostics", fasting_required: true, tests: ["CBC", "A1C"], prereq_for_appt: "itm_007" }
```

---

### Subdocument: `Reminder`

Reminders are embedded in two places:
- `event.reminders[]` — applies to the whole event (e.g. "buy travel insurance 30 days before")
- `event.items[n].reminders[]` — applies to a specific item (e.g. "check in 24h before flight")

```typescript
interface Reminder {
  id:               string;          // unique within the event, e.g. "rem_r01"
  title:            string;
  status:           string;          // "pending" | "snoozed" | "done" | "skipped"

  // ── Timing ────────────────────────────────────────────────
  fire_at:          string;          // ISO 8601 datetime — computed absolute time
  offset_rule:      string | null;   // relative rule used to compute fire_at, e.g. "-30d", "-4w", "-2h"
  recurrence_rule:  string | null;   // RFC 5545 RRULE for repeating reminders

  // ── Context ───────────────────────────────────────────────
  notes:            string | null;   // free text shown in the notification
  url:              string | null;   // action URL shown in the notification
  login_hint:       string | null;

  // ── Extension ─────────────────────────────────────────────
  attrs:            Record<string, any>;
}
```

**`offset_rule` convention:**
```
"-30d"   = 30 days before parent's scheduled_at / start_date
"-4w"    = 4 weeks before
"-2h"    = 2 hours before
"+1d"    = 1 day after (for follow-up reminders)
"0"      = at the time of the event
```
The app resolves `offset_rule` against the parent's date to compute `fire_at` at creation time, and recomputes whenever the parent date changes.

---

### Subdocument: `ChecklistInstance`

```typescript
interface ChecklistInstance {
  id:               string;          // e.g. "cl_001"
  template_id:      string | null;   // reference to templates collection; null if ad-hoc
  name:             string;

  items:            ChecklistItem[];
}

interface ChecklistItem {
  id:               string;          // e.g. "cli_01"
  label:            string;
  checked:          boolean;
  needs_purchase:   boolean;         // surfaces this item in the shopping view
  purchased:        boolean;         // has been purchased, not yet packed/used
  notes:            string | null;
  sort_order:       number;
}
```

---

### Subdocument: `Attachment`

```typescript
interface Attachment {
  id:               string;          // e.g. "att_01"
  label:            string;          // human-readable name
  item_id:          string | null;   // if null, belongs to the event; otherwise to a specific item
  mime_type:        string | null;   // e.g. "application/pdf", "image/jpeg"
  url:              string | null;   // external URL (if not stored locally)
  storage_key:      string | null;   // internal storage path, e.g. "attachments/evt_abc123/dl442.pdf"
}
```

---

### Full event document example

```json
{
  "id": "evt_abc123",
  "parent_id": null,
  "kind": "container",
  "subtype": "backpacking",
  "tags": ["travel", "outdoors"],
  "title": "Zion trip — July 2026",
  "status": "planned",
  "start_date": "2026-07-14",
  "end_date": "2026-07-21",
  "recurrence_rule": null,
  "attrs": {
    "destination": "Zion NP, Utah",
    "budget": 2400,
    "currency": "USD"
  },
  "items": [
    {
      "id": "itm_001",
      "kind": "reservation",
      "subtype": "flight",
      "tags": [],
      "title": "DL 442 JFK → LAS",
      "status": "confirmed",
      "scheduled_at": "2026-07-14T08:30:00",
      "due_at": null,
      "sort_order": 1,
      "confirmation_ref": "XKQP7R",
      "cost": 380,
      "currency": "USD",
      "address": null,
      "phone": null,
      "url": "https://delta.com/manage",
      "login_hint": "me@email.com",
      "prereq_ids": [],
      "attrs": {
        "airline": "Delta",
        "flight_number": "DL442",
        "seat": "14C",
        "terminal": "B",
        "gate": "B22",
        "baggage_claim": "belt 4"
      },
      "reminders": [
        {
          "id": "rem_r01",
          "title": "Check in online",
          "status": "pending",
          "fire_at": "2026-07-13T08:30:00",
          "offset_rule": "-24h",
          "recurrence_rule": null,
          "notes": null,
          "url": "https://delta.com/checkin",
          "login_hint": null,
          "attrs": {}
        }
      ]
    },
    {
      "id": "itm_002",
      "kind": "reservation",
      "subtype": "hike",
      "tags": ["outdoors"],
      "title": "Zion Narrows — top-down",
      "status": "planned",
      "scheduled_at": "2026-07-16T07:00:00",
      "due_at": null,
      "sort_order": 2,
      "confirmation_ref": null,
      "cost": 0,
      "currency": null,
      "address": "Chamberlain Ranch trailhead, Zion NP",
      "phone": null,
      "url": null,
      "login_hint": null,
      "prereq_ids": ["itm_003"],
      "attrs": {
        "distance_miles": 16,
        "elevation_gain_ft": 500,
        "gear": ["dry bag", "water shoes", "trekking poles", "wetsuit"],
        "permit_required": false
      },
      "reminders": [
        {
          "id": "rem_r02",
          "title": "Reserve Chamberlain Ranch shuttle",
          "status": "pending",
          "fire_at": "2026-06-16T09:00:00",
          "offset_rule": "-30d",
          "recurrence_rule": null,
          "notes": "Call or book online. Limited spots.",
          "url": "https://zionpark.org/shuttle",
          "login_hint": "me@email.com",
          "attrs": {}
        },
        {
          "id": "rem_r03",
          "title": "Check gear bag",
          "status": "pending",
          "fire_at": "2026-07-13T18:00:00",
          "offset_rule": "-3d",
          "recurrence_rule": null,
          "notes": null,
          "url": null,
          "login_hint": null,
          "attrs": {}
        }
      ]
    },
    {
      "id": "itm_003",
      "kind": "task",
      "subtype": "parking reservation",
      "tags": [],
      "title": "Book Chamberlain Ranch parking",
      "status": "todo",
      "scheduled_at": null,
      "due_at": "2026-06-20T00:00:00",
      "sort_order": 3,
      "confirmation_ref": null,
      "cost": null,
      "currency": null,
      "address": null,
      "phone": "435-772-3256",
      "url": "https://zionpark.org/parking",
      "login_hint": null,
      "prereq_ids": [],
      "attrs": { "cost_estimate": 20 },
      "reminders": []
    }
  ],
  "reminders": [
    {
      "id": "rem_e01",
      "title": "Buy travel insurance",
      "status": "pending",
      "fire_at": "2026-06-14T09:00:00",
      "offset_rule": "-30d",
      "recurrence_rule": null,
      "notes": null,
      "url": null,
      "login_hint": null,
      "attrs": {}
    }
  ],
  "checklists": [
    {
      "id": "cl_001",
      "template_id": "tmpl_backpacking",
      "name": "Backpacking gear",
      "items": [
        { "id": "cli_01", "label": "Tent", "checked": false, "needs_purchase": false, "purchased": false, "notes": null, "sort_order": 1 },
        { "id": "cli_02", "label": "Sleeping bag", "checked": false, "needs_purchase": false, "purchased": false, "notes": null, "sort_order": 2 },
        { "id": "cli_03", "label": "Water filter", "checked": true, "needs_purchase": false, "purchased": false, "notes": null, "sort_order": 3 },
        { "id": "cli_04", "label": "Sunscreen SPF 50", "checked": false, "needs_purchase": true, "purchased": false, "notes": "REI or drugstore", "sort_order": 4 }
      ]
    }
  ],
  "attachments": [
    {
      "id": "att_01",
      "label": "Flight confirmation PDF",
      "item_id": "itm_001",
      "mime_type": "application/pdf",
      "url": null,
      "storage_key": "attachments/evt_abc123/dl442.pdf"
    }
  ],
  "created_at": "2026-05-10T14:22:00Z",
  "updated_at": "2026-06-01T09:15:00Z"
}
```

---

### More event examples (abbreviated)

**Dental routine (`kind: "occurrence"`)**
```json
{
  "id": "evt_dent01",
  "kind": "occurrence",
  "subtype": "dental checkup",
  "title": "6-month dental cleaning",
  "status": "active",
  "start_date": "2026-09-15",
  "end_date": null,
  "recurrence_rule": "RRULE:FREQ=MONTHLY;INTERVAL=6",
  "attrs": { "dentist": "Dr. Park", "clinic": "Downtown Dental", "insurance": "Aetna" },
  "items": [
    {
      "id": "itm_d01",
      "kind": "reservation",
      "subtype": "appointment",
      "title": "Cleaning + X-rays — Dr. Park",
      "status": "confirmed",
      "scheduled_at": "2026-09-15T10:00:00",
      "confirmation_ref": "APT-8821",
      "address": "123 Main St, Suite 4B",
      "phone": "212-555-0100",
      "attrs": { "duration_min": 60 },
      "reminders": [
        { "id": "rem_d01", "title": "Schedule next cleaning", "fire_at": "2026-08-15T09:00:00", "offset_rule": "-30d", "status": "pending", "notes": null, "url": null, "login_hint": null, "recurrence_rule": null, "attrs": {} },
        { "id": "rem_d02", "title": "Appointment tomorrow — confirm", "fire_at": "2026-09-14T09:00:00", "offset_rule": "-1d", "status": "pending", "notes": null, "url": null, "login_hint": null, "recurrence_rule": null, "attrs": {} }
      ],
      "prereq_ids": [],
      "cost": 0, "currency": null, "due_at": null, "sort_order": 1, "login_hint": null, "url": null, "tags": []
    }
  ],
  "reminders": [],
  "checklists": [],
  "attachments": [],
  "tags": ["health"],
  "parent_id": null,
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-06-01T00:00:00Z"
}
```

**Grocery list (`kind: "list"`)**
```json
{
  "id": "evt_groc01",
  "kind": "list",
  "subtype": "groceries",
  "title": "Weekly groceries",
  "status": "active",
  "start_date": null,
  "end_date": null,
  "recurrence_rule": null,
  "attrs": { "store": "Whole Foods" },
  "items": [],
  "reminders": [],
  "checklists": [
    {
      "id": "cl_groc01",
      "template_id": "tmpl_groceries_staples",
      "name": "Staples",
      "items": [
        { "id": "cli_g01", "label": "Milk", "checked": false, "needs_purchase": true, "purchased": false, "notes": null, "sort_order": 1 },
        { "id": "cli_g02", "label": "Eggs", "checked": true, "needs_purchase": false, "purchased": true, "notes": null, "sort_order": 2 }
      ]
    }
  ],
  "attachments": [],
  "tags": ["home", "shopping"],
  "parent_id": null,
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-06-18T00:00:00Z"
}
```

**Daily medication (`kind: "habit"`)**
```json
{
  "id": "evt_med01",
  "kind": "habit",
  "subtype": "medication",
  "title": "Metformin 500mg — daily",
  "status": "active",
  "start_date": "2025-01-01",
  "end_date": null,
  "recurrence_rule": "RRULE:FREQ=DAILY",
  "attrs": { "prescriber": "Dr. Levi", "pharmacy": "CVS 86th St", "refill_count": 3 },
  "items": [
    {
      "id": "itm_med01",
      "kind": "entry",
      "subtype": "medication dose",
      "title": "Metformin 500mg",
      "status": "active",
      "scheduled_at": null,
      "due_at": null,
      "sort_order": 1,
      "attrs": { "dosage": "500mg", "with_food": true, "refill_reminder_days": 7 },
      "reminders": [
        { "id": "rem_med01", "title": "Take Metformin with breakfast", "fire_at": "2026-06-22T08:00:00", "offset_rule": null, "recurrence_rule": "RRULE:FREQ=DAILY;BYHOUR=8", "status": "pending", "notes": "Take with food", "url": null, "login_hint": null, "attrs": {} },
        { "id": "rem_med02", "title": "Refill prescription", "fire_at": "2026-07-01T09:00:00", "offset_rule": null, "recurrence_rule": "RRULE:FREQ=MONTHLY", "status": "pending", "notes": "CVS 212-555-0200", "url": null, "login_hint": null, "attrs": {} }
      ],
      "prereq_ids": [],
      "confirmation_ref": null, "cost": null, "currency": null,
      "address": null, "phone": null, "url": null, "login_hint": null, "tags": []
    }
  ],
  "reminders": [],
  "checklists": [],
  "attachments": [],
  "tags": ["health", "daily"],
  "parent_id": null,
  "created_at": "2025-01-01T00:00:00Z",
  "updated_at": "2026-06-01T00:00:00Z"
}
```

---

## Collection: `reminders_index`

A flat, write-through projection of every reminder across all event documents. **Never the source of truth** — the event document is. This collection exists solely for efficient "what fires next" queries.

### Document shape

```typescript
interface ReminderIndexEntry {
  id:               string;   // same id as the reminder inside its event document
  event_id:         string;
  item_id:          string | null;   // null if event-level reminder
  title:            string;
  fire_at:          string;          // ISO 8601 datetime — indexed
  recurrence_rule:  string | null;
  status:           string;          // "pending" | "snoozed" | "done" | "skipped"
}
```

### Sync rules

- **On reminder created:** insert a new index entry.
- **On reminder updated** (status, fire_at): update the index entry.
- **On event deleted:** delete all index entries with that `event_id`.
- **On event date changed:** recompute `fire_at` for all reminders with `offset_rule` and update index.

### Query pattern

```js
// Notification worker: fetch everything due in the next hour
db.reminders_index
  .where("status", "==", "pending")
  .where("fire_at", "<=", oneHourFromNow)
  .orderBy("fire_at")
```

---

## Collection: `templates`

Reusable checklist templates. Referenced by `template_id` inside `ChecklistInstance` but never embedded. A template change does not affect existing checklist instances — instances are snapshots taken at creation time.

### Document shape

```typescript
interface TemplateDocument {
  id:                   string;      // e.g. "tmpl_backpacking"
  name:                 string;
  applies_to_subtype:   string | null;  // if set, auto-apply when a new event matches this subtype
  auto_apply:           boolean;
  description:          string | null;
  tags:                 string[];
  items: TemplateItem[];
  created_at:           string;
  updated_at:           string;
}

interface TemplateItem {
  id:                       string;
  label:                    string;
  category:                 string | null;    // grouping label, e.g. "shelter", "health", "documents"
  needs_purchase:           boolean;
  sort_order:               number;
  default_reminder_offset:  string | null;    // e.g. "-2w" — used when instantiating the checklist
  notes:                    string | null;
}
```

### Template document example

```json
{
  "id": "tmpl_backpacking",
  "name": "Backpacking trip",
  "applies_to_subtype": "backpacking",
  "auto_apply": true,
  "description": "Standard gear and prep checklist for overnight backpacking",
  "tags": ["travel", "outdoors"],
  "items": [
    { "id": "ti_01", "label": "Tent", "category": "shelter", "needs_purchase": false, "sort_order": 1, "default_reminder_offset": null, "notes": null },
    { "id": "ti_02", "label": "Sleeping bag", "category": "shelter", "needs_purchase": false, "sort_order": 2, "default_reminder_offset": null, "notes": null },
    { "id": "ti_03", "label": "Water filter", "category": "water", "needs_purchase": false, "sort_order": 3, "default_reminder_offset": null, "notes": null },
    { "id": "ti_04", "label": "Sunscreen SPF 50", "category": "health", "needs_purchase": true, "sort_order": 4, "default_reminder_offset": "-2w", "notes": "SPF 50+ for high elevation" },
    { "id": "ti_05", "label": "Trekking poles", "category": "gear", "needs_purchase": false, "sort_order": 5, "default_reminder_offset": null, "notes": null },
    { "id": "ti_06", "label": "National Park pass or entrance fee", "category": "documents", "needs_purchase": true, "sort_order": 6, "default_reminder_offset": "-14d", "notes": "America the Beautiful pass works" }
  ],
  "created_at": "2026-01-01T00:00:00Z",
  "updated_at": "2026-01-01T00:00:00Z"
}
```

---

## Derived / computed views

These are **not stored collections** — they are client-side or server-side queries over `events`:

### Shopping list
All items across all active events that need purchasing:
```js
// pseudo-query
events.all()
  .flatMap(e => [
    ...e.checklists.flatMap(cl =>
      cl.items.filter(i => i.needs_purchase && !i.purchased)
        .map(i => ({ ...i, event_title: e.title, checklist_name: cl.name }))
    )
  ])
  .sortBy("event_title")
```

### Upcoming reminders (UI view)
```js
reminders_index
  .where("status", "==", "pending")
  .where("fire_at", ">=", now)
  .orderBy("fire_at")
  .limit(50)
  // then fetch parent event docs in batch for context
```

### Today's habits
```js
events
  .where("kind", "==", "habit")
  .where("status", "==", "active")
  // filter items whose recurrence_rule matches today
```

---

## ID generation

| Entity | Format | Example |
|---|---|---|
| Event | `evt_` + nanoid(8) | `evt_abc12345` |
| Item | `itm_` + nanoid(6) | `itm_a1b2c3` |
| Reminder | `rem_` + nanoid(6) | `rem_x9y8z7` |
| Checklist instance | `cl_` + nanoid(6) | `cl_p1q2r3` |
| Checklist item | `cli_` + nanoid(6) | `cli_m4n5o6` |
| Attachment | `att_` + nanoid(6) | `att_d7e8f9` |
| Template | `tmpl_` + slug | `tmpl_backpacking` |
| Reminder index entry | same id as the reminder | `rem_x9y8z7` |

IDs within embedded arrays (items, reminders, checklist items) must be unique **globally**, not just within their parent, to make the `reminders_index` sync unambiguous.

---

## Indexing recommendations

### Firestore
```
events:            (status), (kind), (tags), (start_date), (parent_id)
reminders_index:   (status, fire_at) — composite, used by notification worker
templates:         (applies_to_subtype), (auto_apply)
```

### MongoDB
```js
db.events.createIndex({ status: 1 })
db.events.createIndex({ kind: 1 })
db.events.createIndex({ tags: 1 })
db.events.createIndex({ start_date: 1 })
db.events.createIndex({ parent_id: 1 })
db.events.createIndex({ "items.prereq_ids": 1 })

db.reminders_index.createIndex({ status: 1, fire_at: 1 })

db.templates.createIndex({ applies_to_subtype: 1 })
```

---

## Business logic notes for implementers

### Auto-applying templates
When a new event is created with a `subtype` that matches `template.applies_to_subtype` where `auto_apply: true`:
1. Fetch matching templates.
2. For each template, create a `ChecklistInstance` with items copied from `template.items`.
3. For any template item with `default_reminder_offset`, create a `Reminder` on the event with `fire_at` computed from `event.start_date` + offset.
4. Write index entries to `reminders_index` for each created reminder.

### Recomputing `fire_at` on date change
When `event.start_date` or `item.scheduled_at` changes:
1. Find all reminders in the event/item with a non-null `offset_rule`.
2. Recompute `fire_at = parent_date + offset_rule`.
3. Update the reminder in the event document.
4. Update the corresponding entry in `reminders_index`.

### Recurring events
`recurrence_rule` on an event is informational metadata. The app generates the **next occurrence** as a new event document (copying the template structure, not the state) when the current occurrence is marked done. Do not store all future occurrences upfront.

### `prereq_ids` resolution
Item prereqs are IDs of other items within the **same event document**. Resolve client-side:
```js
const item = event.items.find(i => i.id === targetId);
const prereqs = item.prereq_ids.map(pid => event.items.find(i => i.id === pid));
const allDone = prereqs.every(p => p.status === "done");
```

---

## Summary of design decisions

| Decision | Rationale |
|---|---|
| Items, reminders, checklists embedded in event doc | Always read together; one fetch = full context |
| `reminders_index` as a separate flat collection | Efficient "fires next" queries without full-collection scan |
| Templates referenced, not embedded | Templates mutate independently; instances are snapshots |
| `kind` (4-value enum) + `subtype` (free string) | `kind` drives app behavior; `subtype` is a user label that never needs a migration |
| `attrs {}` open extension field | Accommodates infinite item types without schema changes |
| `prereq_ids[]` as local item references | Resolved in a single document read, no cross-document joins |
| IDs globally unique across embedded arrays | Required for `reminders_index` sync to be unambiguous |
| Recurring events generate new documents per occurrence | Avoids unbounded future-occurrence pre-generation; clean state per cycle |
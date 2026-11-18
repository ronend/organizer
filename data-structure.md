# coo — Data Structure (storage + API reference)

Data model **version 2**. Shapes are defined in `backend/src/models.py`
(pydantic, extra fields forbidden); everything extensible — subject types,
their attributes, document categories and fields, reservation types, routine
areas — is defined in **`backend/src/registry.json`**; household-level rules
are enforced by `backend/src/integrity.py`. The frontend keeps a verbatim copy
of the registry (`frontend/src/lib/registry.json`).

## Model

```
Subject (person | car | trip | …  — subjectType from the registry)
 ├─ Task          subjectId (null = general); parentId → subtask (one level)
 ├─ Document      subjectId; files[]; fields{}; expiry (expiring categories)
 ├─ Reservation   subjectId (types that allow reservations: trip)
 ├─ Assignment    subjectId → Routine (reusable template)
 └─ Contact       household-wide; links[] → subjects, with a role
```

Every record: `kind`, `id` (`[A-Za-z0-9_-]{1,64}`), `createdAt`, `updatedAt`
(server-stamped), `archived`. Records point at a subject by `subjectId` only.

| kind | Key fields |
|------|------------|
| `subject` | `subjectType`, `name`, `notes`, `attributes{}` (registry `subjectTypes.<type>.attributes`) |
| `task` | `subjectId?`, `parentId?`, `title`, `notes` (rich text), `date?`, `order`, `done`, `doneAt?`, `source?` (`{kind:"assignment", id, step: plain/schedule/renew/pickup}` or `{kind:"reservation", id, step: book/checkin}`), `appointment?`, `requestsDocument?` (`{category, type}`) |
| `document` | `subjectId`, `attachedTo?` (`{kind: task/reservation, id}`), `category`, `type`, `title`, `date?`, `files[]` (`{role?, file: FileRef}`), `fields{}`, `customFields[]` (`{label, value}`), `assignmentId?`, `pinned`, `expiry?` (`{validUntil, outdated}`) |
| `reservation` | `subjectId`, `type` (registry), `title`, `start`, `end?` (local `YYYY-MM-DDTHH:mm`), `status` (booked/planned), `bookBy?`, `checkinReminder`, `fields{}` (address, confirmation, link, details) |
| `routine` | `area` (registry), `template?`, `icon`, `title`, `description`, `dateLabel`, `plan[]`, `followUps[]` (StepPlan), `repeatMonths?`, `countFrom`, `extension?` (`{medication}`) |
| `assignment` | `routineId`, `subjectId`, `date?`, `repeatMonths?`, `done`, `contactId?`, `supply?`, `history[]`, overrides `plan?`, `countFrom?` |
| `contact` | `name`, `role`, `phone`, `email`, `notes`, `tags[]` (e.g. health, cars, other), `links[]` (`{subjectId, role}`) |

### Registry

- `subjectTypes.<type>`: `attributes` (field definitions), `allows` (task,
  document, assignment, reservation), `documentCategories`, `routineAreas`,
  `rules` (e.g. `dateOrder`).
- `documentCategories.<cat>`: `types`, `defaultType`, `fields` + per-type
  `typeFields`, `fileRoles`, `expiring`, `area`, `datedByDefault`, `pin`, and
  save `rules` (`replaceOnLink`, `expiryDrivesRoutine`, `onePerType`, `renewal`).
- `reservationTypes`, `reservationFields`, `routineAreas`.

**Field definitions** (`{key, label, type, required?, unique?, …}`), types:
`text`, `secret` (masked in the UI), `longtext`, `url`, `number`
(`integer`?), `date`, `boolean`, `select` (`options`), `contact` (`tags`
filter), `subject` / `subjects` (`subjectType` filter). Unknown keys are
refused; ad-hoc document metadata goes in `customFields`.

A new subject type, category, field or reservation type is a registry edit —
no model change, no migration. Never delete a field definition that stored
records use; mark it `"deprecated": true`.

### Validation (server side)

1. **Shape** (`models.py`) → `422`: extra fields, types, enums, dates, sizes,
   registry keys (subjectType, category, area, reservation type); a subtask
   can't have a `source` or `appointment`.
2. **Household** (`integrity.py`, on every write, against the state the write
   would produce) → `400` listing the problems:
   - registry fields match their definitions (required, unique per subject
     type, select options, references to contacts/subjects of the right type)
   - the subject type allows the object; documents use one of its categories,
     assignments one of its routine areas; the document type, file roles and
     `expiry` fit the category
   - references exist and agree: `subjectId`, `parentId`, `source` (same
     subject), `attachedTo` (same subject), `assignmentId` (same subject,
     category's area), `routineId`, `contactId`, providers, contact `links`
   - subtasks: the parent exists and isn't a subtask, same subject; a task
     with subtasks can't become one, and moving it requires moving them
   - **deletes**: a record still referenced can't be deleted — delete or
     update the referencing records in the same batch
3. **Files**: every `FileRef.key` must be under `u/<sub>/` → `403`.
4. **Concurrency**: optional expectations (`expect`) → `409` when stale.

## Storage — DynamoDB single table

Table `DYNAMO_TABLE`, `PAY_PER_REQUEST`, partition key `userId` (Cognito
`sub`), sort key `SK`:

```
SK = V2#<kind>#<id>       one item per v2 record, fields verbatim (camelCase)
SK = COO#<kind>#<id>      version 1 records — read only by the migration,
                          kept untouched for rollback
SK = ITEM#… / REMIDX#…    the model before that — ignored
```

Writes are `TransactWriteItems` in chunks of ≤100 (atomic per chunk);
expectations become conditions in the same transaction.

- **Numbers**: floats are stored as `Decimal`; on read, integral values come
  back as ints and the rest as floats.
- **Timestamps**: on every put the server sets `updatedAt` to the current UTC
  time (`2026-11-08T10:00:00.000Z`) and keeps the client's `createdAt`.

## API

All data routes require a Cognito access token (`Authorization: Bearer …`) and
come through CloudFront (`x-origin-verify`).

### `GET /api/state`

```jsonc
{ "schemaVersion": 2,
  "subjects": [], "tasks": [], "documents": [], "reservations": [],
  "routines": [], "assignments": [], "contacts": [],
  "needsMigration": false }   // true: only version 1 rows exist → POST /api/migrate
```

### `POST /api/batch`

```jsonc
// request — puts are FULL records (upserts); deletes are refs
{ "put": [ { "kind": "task", "id": "t_…", … } ],
  "delete": [ { "kind": "task", "id": "t_…" } ],
  "expect": [ { "kind": "task", "id": "t_…", "updatedAt": "2026-11-08T10:00:00.000Z" } ] }  // optional

// response
{ "ok": true, "updatedAt": "2026-11-08T10:00:00.000Z" }
```

- At most **500** operations per batch; a record may appear once.
- `expect`: the write only applies if each listed record's stored `updatedAt`
  still matches (`null` = must not exist) → `409` otherwise. Records listed
  but not written are checked too.
- Deleting a record that doesn't exist is a no-op.

### `POST /api/documents`

The one way to create or update a document of any category on any subject;
the app and the MCP server both use it. The server applies the document rules
(`backend/src/documents.py`), then the same household checks as a batch.

```jsonc
// request
{
  "document": {                 // fields to set; without an existing id → create
    "subjectId": "c_…", "category": "car", "title": "GEICO insurance card",
    "type": "ID card", "expiry": { "validUntil": "2027-04-25" },
    "files": [ { "role": null, "file": { "key": "u/<sub>/…", "name": "card.pdf", "contentType": "application/pdf", "size": 1234 } } ],
    "fields": { }
  },
  "renewal": { "remindDays": 60 },   // optional: renewal reminders from the expiry
  "closeTaskId": "t_…",               // optional: a task to mark done
  "duplicates": "allow",              // or "reject" (409 for a 2nd active doc of a one-per-type category)
  "today": "2026-11-17",              // caller's local date for step planning
  "expectUpdatedAt": "…"              // optional when editing → 409 if it changed
}

// response — `changes` is everything written, already stamped
{ "document": { … }, "changes": { "put": [ … ], "delete": [ … ] },
  "summary": { "archivedOlder": [], "closedTasks": [], "linkedRoutine": "…",
               "renewalRoutine": "…", "remindersPlannedFrom": "…", "routineMovedTo": "…" } }
```

- New: `subjectId`, `category`, `title` required; `type` defaults to the
  category's, `pinned` to its pin default, `date` to today when
  `datedByDefault`. Update (existing `id`): only the given fields change;
  `subjectId` and `category` can't. `null` clears `date`, `expiry`,
  `assignmentId`, `attachedTo`.
- `400` invalid, `404` missing subject/assignment/task, `403` file outside your
  storage, `409` duplicate (`{detail, existing: [{id, title, validUntil,
  assignmentId, routine}]}`) or stale.

### `GET /api/registry`

The registry (`backend/src/registry.json`).

### `POST /api/migrate`

```jsonc
// request
{ "dryRun": true }
// response
{ "migrated": false, "counts": { "subject": 8, … }, "notes": [], "errors": [] }
```

Maps the caller's version 1 rows to version 2 (`backend/src/migration.py`),
validates every result (shape + household checks) and only then writes them.
Version 1 rows stay untouched. `409` if the caller already has v2 rows; `422`
with `errors` (nothing written) if anything fails validation. Operators can run
the same thing with `scripts/migrate_to_v2.py` (offline over an export, or for
one user).

#### Version 1 → 2 mapping

| Version 1 | Version 2 |
|---|---|
| `person` / `car` / `trip` | `subject` (`person`: birthYear; `car`: name = makeModel, plate, odometer; `trip`: destination, start, end, travelers, notes) |
| `subjectType` + `subjectId` | `subjectId` (ids are kept) |
| `task.subtasks[]` | tasks with `parentId` (id `<task>-<subtask>`), the parent's subject |
| `task.assignmentId` + `stepKind` | `source {kind:"assignment", id, step}` |
| `task.tripId` / `reservationId` / `tripTask` | `subjectId` = the trip, `source {kind:"reservation", id, step}` |
| `docTask` | `requestsDocument {category, type}` |
| `document.docKind` / `name` | `category` / `title` |
| `front` / `back` / `file` | `files[]` with role front / back / null |
| `idNumber`, `issuer`, `issueDate`, `providerId`, `about`, `episode` | `fields.*` (custom field if the category doesn't define it) |
| `details[]` | registry field when the label matches, else `customFields` |
| `validUntil` + `outdated` | `expiry` (expiring categories; else a custom field) |
| `reservation.files[]` | `attachment` documents `attachedTo` the reservation (id `<reservation>-f<n>`) |
| `reservation` address / confirmation / link / details | `fields` (a non-URL link moves to details) |
| `contact.group` | `tags`; `links` from assignments, appointments and health providers |
| `routine.medication` | `extension.medication` |

### Files

User files (document scans, reservation attachments) live in the private
bucket `coo-files-<accountId>` (`FilesBucket`, env `FILES_BUCKET`), under
`u/<sub>/<uuid4>/<sanitized file name>`. The browser uploads and downloads
directly from S3 with presigned URLs (the bucket's CORS allows the app origin and
`http://localhost:5173`). Records only store `FileRef`s:

```ts
{ key: string; name: string; contentType: string; size: number }
```

#### `POST /api/files/upload-url`

```jsonc
// request
{ "name": "Passport scan.pdf", "contentType": "application/pdf", "size": 183422 }

// response
{ "file": { "key": "u/<sub>/<uuid>/Passport_scan.pdf", "name": "Passport scan.pdf",
            "contentType": "application/pdf", "size": 183422 },
  "uploadUrl": "https://coo-files-<acct>.s3.<region>.amazonaws.com/u/…?X-Amz-…" }
```

- Then `PUT uploadUrl` with the file as the body and the **same**
  `Content-Type` header (it is part of the signature). Valid 15 minutes.
- `size` > 20 MB → `400`. An empty `contentType` becomes
  `application/octet-stream` (use `file.contentType` for the PUT).
- The file name is sanitized for the key (`[A-Za-z0-9._-]`, ≤ 100 chars); the
  original name is kept in `file.name`.
- The returned `file` is what goes into a document's `files[]` (every file is
  a document; reservation attachments are documents `attachedTo` the
  reservation), saved via `/api/documents` or `/api/batch`.

#### `POST /api/files/urls`

```jsonc
// request (≤ 100 keys)
{ "keys": ["u/<sub>/<uuid>/Passport_scan.pdf"] }

// response — presigned GET URLs, valid 1 hour
{ "urls": { "u/<sub>/<uuid>/Passport_scan.pdf": "https://coo-files-…?X-Amz-…" } }
```

- Any key outside the caller's `u/<sub>/` prefix → `403` for the whole request.

Objects are not deleted when a record stops referencing them (no server-side
garbage collection yet).

### Link titles

#### `POST /api/link-preview`

```jsonc
// request
{ "url": "https://www.alltrails.com/trail/…" }
// response — title is null when it can't be found or the URL is refused
{ "url": "https://www.alltrails.com/trail/…", "title": "Sintra Ridge Loop | AllTrails" }
```

Used by the task notes editor to offer replacing a bare URL with the page's
title. The server fetches the page (the browser can't, because of CORS), so it
only follows http/https on default ports, refuses hosts that resolve to
non-public addresses, re-checks every redirect (max 3), reads at most 256 KB of
HTML and times out quickly. Title order: `og:title`, `twitter:title`, `<title>`.

### Auth

`POST /api/auth/token` (`{code}` → `{accessToken, idToken, expiresIn}`) exchanges
the Cognito hosted-UI authorization code; it is guarded only by origin-verify.

---

## AWS resource names

The app was renamed from "organizer" to "coo", but AWS logical IDs and physical
names (`OrganizerTable`, `OrganizerFunction`, the `organizer-users` pool, the
`organizer-<accountId>` hosted-UI domain, `/organizer/origin-secret`, the
`organizer-app` stack) keep the legacy prefix on purpose: renaming them would
replace the Cognito pool, the table and the hosted-UI domain. Only new resources
(`coo-files-<accountId>`) use the new name.

"""Saving documents — the one implementation of the document rules.

``POST /api/documents`` (routes/documents.py) is the single way to create or
update a document of any category on any subject; the app and the MCP server
both call it. ``save_document`` works on the caller's loaded state and returns
the records to put/delete, so the route can write them in one batch.

Rules (each enabled per category in registry.json):

- the subject must exist and be allowed to hold the category; the type must be
  one of the category's types; a new document may only fill the fields the
  category uses (``features``)
- linking a routine: it must belong to the same subject and the category's
  routine area. On a new link, ``replaceOnLink`` archives the older document of
  the same type on that routine. A new document on a routine closes the
  routine's open "add the document" tasks for this category.
- ``expiryDrivesRoutine``: a newly linked document with an expiry moves the
  routine to that date and re-plans its open steps; editing the expiry of an
  already linked document shifts the routine and its open steps by the same
  number of days (as the app always did).
- ``renewal`` (request option): with an expiry and no linked routine, creates
  a renewal routine with reminder steps planned back from the expiry.
- ``duplicates="reject"`` + ``onePerType``: refuses a second active document
  of the same type (unless linked to a routine), so callers must choose.
"""

from __future__ import annotations

import secrets
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from src import registry

# Document fields each registry feature unlocks.
FEATURE_FIELDS: dict[str, tuple[str, ...]] = {
    "idNumber": ("idNumber",),
    "issuer": ("issuer",),
    "issueDate": ("issueDate",),
    "validUntil": ("validUntil",),
    "details": ("details",),
    "front": ("front",),
    "back": ("back",),
    "date": ("date",),
    "provider": ("providerId",),
    "about": ("about",),
    "episode": ("episode",),
    "file": ("file",),
}
ALWAYS_FIELDS = ("name", "type", "assignmentId", "pinned", "archived", "outdated")

DOC_DEFAULTS: dict[str, Any] = {
    "date": None,
    "validUntil": None,
    "idNumber": "",
    "issuer": "",
    "issueDate": None,
    "details": [],
    "front": None,
    "back": None,
    "providerId": None,
    "about": "",
    "episode": "",
    "file": None,
    "assignmentId": None,
    "pinned": False,
    "archived": False,
    "outdated": False,
}
EDITABLE = set(DOC_DEFAULTS) | {"name", "type"}


class DocumentError(Exception):
    """Invalid request (→ 400)."""


class NotFound(DocumentError):
    """A referenced record doesn't exist (→ 404)."""


class Duplicate(DocumentError):
    """An active document of this type already exists (→ 409)."""

    def __init__(self, message: str, existing: list[dict]):
        super().__init__(message)
        self.existing = existing


# ── small helpers ───────────────────────────────────────────────────────────


def now_stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_id(prefix: str) -> str:
    chars = "0123456789abcdefghijklmnopqrstuvwxyz"
    return f"{prefix}_" + "".join(chars[b % 36] for b in secrets.token_bytes(9))


_order_seq = 0


def next_order() -> int:
    """Monotonic default order so new tasks land after existing ones (as the app)."""
    global _order_seq
    _order_seq = max(_order_seq + 1, int(time.time() * 1000))
    return _order_seq


def _add_days(d: str, n: int) -> str:
    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()


def _diff_days(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _base(prefix: str) -> dict:
    stamp = now_stamp()
    return {"id": new_id(prefix), "createdAt": stamp, "updatedAt": stamp}


def make_task(today: str, **fields: Any) -> dict:
    task = {
        "kind": "task",
        **_base("t"),
        "title": "",
        "notes": "",
        "date": today,
        "order": next_order(),
        "done": False,
        "doneAt": None,
        "subjectType": None,
        "subjectId": None,
        "assignmentId": None,
        "stepKind": "plain",
        "appointment": None,
        "tripId": None,
        "reservationId": None,
        "tripTask": None,
        "docTask": None,
        "subtasks": [],
    }
    task.update(fields)
    return task


def _step(title: str, offset: int, kind: str = "plain", doc_task: Optional[dict] = None) -> dict:
    return {"title": title, "offsetDays": offset, "kind": kind, "prep": "", "docTask": doc_task}


def plan_cycle(routine: dict, assignment: dict, due: str, today: str) -> list[dict]:
    """Steps for one cycle ending on ``due``; past dates move to today (as planCycle)."""
    plan = assignment.get("plan") if assignment.get("plan") is not None else routine.get("plan", [])
    out = []
    for p in sorted(plan, key=lambda p: p["offsetDays"]):
        when = max(_add_days(due, p["offsetDays"]), today)
        out.append(
            make_task(
                today,
                title=p["title"],
                date=when,
                subjectType=assignment["subjectType"],
                subjectId=assignment["subjectId"],
                assignmentId=assignment["id"],
                stepKind=p["kind"],
                docTask=p.get("docTask"),
                notes=f"Prep: {p['prep']}" if p.get("prep") else "",
            )
        )
    return out


class _Tx:
    """Pending puts/deletes over a loaded state (like the app's Tx)."""

    def __init__(self, state: dict):
        self.state = state
        self.puts: dict[str, dict] = {}
        self.dels: dict[str, dict] = {}

    def put(self, e: dict) -> dict:
        k = f"{e['kind']}#{e['id']}"
        self.dels.pop(k, None)
        self.puts[k] = e
        return e

    def delete(self, e: dict) -> None:
        k = f"{e['kind']}#{e['id']}"
        self.puts.pop(k, None)
        self.dels[k] = {"kind": e["kind"], "id": e["id"]}

    def get(self, e: dict) -> dict:
        return self.puts.get(f"{e['kind']}#{e['id']}", e)

    def tasks(self) -> list[dict]:
        out = {t["id"]: t for t in self.state.get("tasks", [])}
        for e in self.puts.values():
            if e["kind"] == "task":
                out[e["id"]] = e
        for d in self.dels.values():
            if d["kind"] == "task":
                out.pop(d["id"], None)
        return list(out.values())


def _by_id(state: dict, coll: str, id_: Optional[str]) -> Optional[dict]:
    if not id_:
        return None
    return next((x for x in state.get(coll, []) if x.get("id") == id_), None)


# ── routine rules ───────────────────────────────────────────────────────────


def _replan_to(tx: _Tx, routine: dict, a: dict, due: str, doc_kind: str, today: str) -> dict:
    """Move the assignment to ``due`` and replace its open, unbooked steps."""
    moved = tx.put({**tx.get(a), "date": due, "done": False})
    for t in tx.tasks():
        if (
            t.get("assignmentId") == a["id"]
            and not t.get("done")
            and not t.get("appointment")
            and (t.get("docTask") or {}).get("docKind") != doc_kind
        ):
            tx.delete(t)
    fresh = plan_cycle(routine, moved, due, today)
    for t in fresh:
        tx.put(t)
    return {"routineMovedTo": due, "steps": [{"title": t["title"], "date": t["date"]} for t in fresh]}


def _shift(tx: _Tx, routine: dict, a: dict, new_date: str, today: str) -> dict:
    """Shift the assignment and its open steps by the date change (as setAssignmentDate)."""
    cur = tx.get(a)
    tx.put({**cur, "date": new_date, "done": False})
    open_ = [t for t in tx.tasks() if t.get("assignmentId") == a["id"] and not t.get("done") and not t.get("appointment")]
    if not cur.get("date"):
        if not open_:
            for t in plan_cycle(routine, {**cur, "date": new_date}, new_date, today):
                tx.put(t)
    else:
        delta = _diff_days(cur["date"], new_date)
        if delta:
            for t in open_:
                if t.get("date"):
                    tx.put({**t, "date": _add_days(t["date"], delta)})
    return {"routineMovedTo": new_date}


def _renewal(tx: _Tx, doc: dict, cat: dict, remind_days: int, today: str) -> dict:
    """A renewal routine + assignment + steps for a document (as renewalRoutineForId)."""
    t = doc["type"]
    is_passport = t == "Passport"
    label = "document" if t == "Other" else ("ID card" if t == "City or state ID" else t.lower())
    plan = [_step("Submit passport renewal" if is_passport else f"Renew {label}", -remind_days, "renew")]
    if is_passport:
        plan.insert(0, _step("Check renewal requirements and get a photo", -(remind_days + 30)))
    routine = tx.put(
        {
            "kind": "routine",
            **_base("r"),
            "area": cat["area"],
            "template": None,
            "icon": cat["icon"],
            "title": f"{doc['name'] if t == 'Other' else t} renewal",
            "description": f"Renewal reminders for {doc['name']}.",
            "dateLabel": "Expires",
            "plan": plan,
            "followUps": [_step(f"Add the new {label} to documents", 0, "plain", {"docKind": doc["docKind"], "docType": t})],
            "repeatMonths": None,
            "countFrom": "due",
            "medication": False,
        }
    )
    a = tx.put(
        {
            "kind": "assignment",
            **_base("a"),
            "routineId": routine["id"],
            "subjectType": doc["subjectType"],
            "subjectId": doc["subjectId"],
            "date": doc["validUntil"],
            "repeatMonths": None,
            "done": False,
            "contactId": None,
            "supply": None,
            "history": [],
            "plan": None,
            "countFrom": None,
        }
    )
    tasks = plan_cycle(routine, a, doc["validUntil"], today)
    for x in tasks:
        tx.put(x)
    doc["assignmentId"] = a["id"]
    return {
        "renewalRoutine": routine["title"],
        "remindersPlannedFrom": min((x["date"] for x in tasks), default=doc["validUntil"]),
        "steps": [{"title": x["title"], "date": x["date"]} for x in tasks],
    }


# ── save ────────────────────────────────────────────────────────────────────


def save_document(
    state: dict,
    fields: dict,
    *,
    renewal: Optional[dict] = None,
    close_task_id: Optional[str] = None,
    duplicates: str = "allow",
    today: Optional[str] = None,
) -> tuple[list[dict], list[dict], dict, dict]:
    """Create or update one document. ``fields`` holds only what the caller set.

    Returns (puts, deletes, document, summary).
    """
    today = today or date.today().isoformat()
    doc_id = fields.get("id")
    prev = _by_id(state, "documents", doc_id)

    if prev:
        for k in ("subjectType", "subjectId", "docKind"):
            if k in fields and fields[k] != prev[k]:
                raise DocumentError(f"{k} can't be changed on an existing document")
        doc = {**prev, **{k: v for k, v in fields.items() if k in EDITABLE}}
    else:
        missing = [k for k in ("subjectType", "subjectId", "docKind") if not fields.get(k)]
        if missing:
            raise DocumentError(f"A new document needs {', '.join(missing)}")
        stamp = now_stamp()
        doc = {
            "kind": "document",
            "id": doc_id or new_id("d"),
            "createdAt": stamp,
            "updatedAt": stamp,
            "subjectType": fields["subjectType"],
            "subjectId": fields["subjectId"],
            "docKind": fields["docKind"],
            **DOC_DEFAULTS,
            "type": None,
            "name": "",
        }

    st_key, kind = doc["subjectType"], doc["docKind"]
    if st_key not in registry.subject_types():
        raise DocumentError(f"Unknown subject type {st_key!r}")
    if kind not in registry.categories():
        raise DocumentError(f"Unknown document category {kind!r}")
    cat = registry.category(kind)
    try:
        registry.check_doc_for_subject(kind, st_key)
    except ValueError as e:
        raise DocumentError(str(e)[0].upper() + str(e)[1:]) from None
    subject = _by_id(state, registry.subject_type(st_key)["collection"], doc["subjectId"])
    if not subject:
        raise NotFound(f"No {registry.subject_type(st_key)['label'].lower()} with id {doc['subjectId']!r}")
    who = registry.subject_name(st_key, subject)

    if not prev:
        # Only the category's fields may be filled on a new document.
        allowed = set(ALWAYS_FIELDS) | {f for feat in cat["features"] for f in FEATURE_FIELDS.get(feat, ())}
        extra = sorted(
            k for k, v in fields.items() if k in DOC_DEFAULTS and k not in allowed and v != DOC_DEFAULTS[k]
        )
        if extra:
            raise DocumentError(f"{cat['label']} documents don't use: {', '.join(extra)}")
        for k in DOC_DEFAULTS:
            if k in fields:
                doc[k] = fields[k]
        if "pinned" not in fields:
            doc["pinned"] = bool(cat["pin"]["default"])
        if "date" in cat["features"] and "date" not in fields:
            doc["date"] = today
        doc["type"] = fields.get("type") or cat["defaultType"]
        doc["name"] = fields.get("name") or ""

    doc["name"] = (doc.get("name") or "").strip()
    if not doc["name"]:
        raise DocumentError("A document needs a name")
    if (not prev or doc["type"] != prev["type"]) and doc["type"] not in cat["types"]:
        raise DocumentError(f"Unknown {cat['label'].lower()} document type {doc['type']!r}. Use one of: {', '.join(cat['types'])}")
    if doc.get("archived"):
        doc["pinned"] = False

    if doc.get("providerId"):
        c = _by_id(state, "contacts", doc["providerId"])
        if not c:
            raise NotFound(f"No contact with id {doc['providerId']!r}")
        groups = cat.get("providerGroups")
        if groups and c.get("group") not in groups:
            raise DocumentError(f"{c['name']} isn't a {' or '.join(groups)} contact")

    routine = None
    a = _by_id(state, "assignments", doc.get("assignmentId"))
    if doc.get("assignmentId"):
        if not a:
            raise NotFound(f"No routine assignment with id {doc['assignmentId']!r}")
        routine = _by_id(state, "routines", a["routineId"])
        if a["subjectType"] != st_key or a["subjectId"] != doc["subjectId"]:
            raise DocumentError(f"That routine isn't assigned to {who}")
        if not routine or routine["area"] != cat["area"]:
            raise DocumentError(f"Link a {cat['area']} routine to a {cat['label'].lower()} document")

    close_task = _by_id(state, "tasks", close_task_id)
    if close_task_id and not close_task:
        raise NotFound(f"No task with id {close_task_id!r}")

    is_new = prev is None
    if is_new and duplicates == "reject" and cat.get("onePerType") and doc["type"] not in cat.get("onePerTypeExempt", []) and not a:
        current = [
            d for d in state.get("documents", [])
            if d.get("docKind") == kind and d.get("subjectId") == doc["subjectId"] and d.get("subjectType") == st_key
            and d.get("type") == doc["type"] and not d.get("archived") and not d.get("outdated")
        ]
        if current:
            existing = []
            for d in current:
                da = _by_id(state, "assignments", d.get("assignmentId"))
                dr = _by_id(state, "routines", da["routineId"]) if da else None
                existing.append({"id": d["id"], "name": d["name"], "validUntil": d.get("validUntil"),
                                 "assignmentId": da["id"] if da else None, "routine": dr["title"] if dr else None})
            raise Duplicate(f"{who} already has an active {doc['type'].lower()}", existing)

    tx = _Tx(state)
    summary: dict[str, Any] = {}
    stamp = now_stamp()

    linked_now = bool(a) and (is_new or (prev or {}).get("assignmentId") != doc["assignmentId"])
    if linked_now and cat.get("replaceOnLink"):
        archived = [
            tx.put({**o, "archived": True, "pinned": False})
            for o in state.get("documents", [])
            if o["id"] != doc["id"] and o.get("assignmentId") == a["id"] and o.get("type") == doc["type"] and not o.get("archived")
        ]
        if archived:
            summary["archivedOlder"] = [o["name"] for o in archived]
    if a and is_new:
        closed = [
            tx.put({**t, "done": True, "doneAt": stamp})
            for t in state.get("tasks", [])
            if t.get("assignmentId") == a["id"] and not t.get("done") and (t.get("docTask") or {}).get("docKind") == kind
        ]
        if closed:
            summary["closedTasks"] = [t["title"] for t in closed]
    if close_task and not close_task.get("done"):
        tx.put({**tx.get(close_task), "done": True, "doneAt": stamp})
        summary.setdefault("closedTasks", []).append(close_task["title"])

    if a and routine and cat.get("expiryDrivesRoutine") and doc.get("validUntil") and not doc.get("outdated") and not routine.get("medication"):
        if linked_now:
            if doc["validUntil"] != a.get("date"):
                summary.update(_replan_to(tx, routine, a, doc["validUntil"], kind, today))
        elif prev and prev.get("validUntil") and prev["validUntil"] != doc["validUntil"]:
            new_date = _add_days(a["date"], _diff_days(prev["validUntil"], doc["validUntil"])) if a.get("date") else doc["validUntil"]
            summary.update(_shift(tx, routine, a, new_date, today))

    if renewal is not None and not a:
        if not cat.get("renewal"):
            raise DocumentError(f"{cat['label']} documents don't have renewal reminders")
        if doc.get("validUntil"):
            days = renewal.get("remindDays")
            days = registry.remind_days_default(kind, doc["type"]) if days is None else days
            summary.update(_renewal(tx, doc, cat, days, today))
        else:
            summary["note"] = "No renewal reminder: it needs an expiry date."

    if routine:
        summary["linkedRoutine"] = routine["title"]
    tx.put(doc)
    summary["document"] = {"id": doc["id"], "subject": who, "name": doc["name"], "type": doc["type"], "created": is_new}
    return list(tx.puts.values()), list(tx.dels.values()), doc, summary

"""Saving documents — the one implementation of the document rules (v2).

``POST /api/documents`` (routes/documents.py) creates or updates any document
on any subject; the app and the MCP server both call it. ``save_document``
works on the caller's loaded household and returns the records to put and
delete. Shapes, registry fields and references are then checked by the same
household checks as every batch (src/integrity.py) before anything is written.

Rules (each enabled per category in registry.json ``rules``):

- linking a routine: on a new link, ``replaceOnLink`` archives the older
  document of the same type on that routine. A new document on a routine
  closes the routine's open tasks that request a document of this category.
- ``expiryDrivesRoutine``: a newly linked document with an expiry moves the
  routine to that date and re-plans its open steps; editing the expiry of an
  already linked document shifts the routine and its open steps by the same
  number of days.
- ``renewal`` (request option): with an expiry and no linked routine, creates
  a renewal routine with reminder steps planned back from the expiry.
- ``duplicates="reject"`` + ``onePerType``: refuses a second active document
  of the same type (unless linked to a routine), so callers must choose.

Defaults for a new document come from the category: ``type`` (defaultType),
``pinned`` (pin.default) and ``date`` (today, if datedByDefault).
"""

from __future__ import annotations

import secrets
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from src import registry

EDITABLE = (
    "title", "type", "date", "files", "fields", "customFields", "assignmentId", "pinned",
    "archived", "attachedTo", "expiry",
)
FIXED = ("subjectId", "category")
NULLABLE = ("date", "expiry", "assignmentId", "attachedTo")


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
    return {"id": new_id(prefix), "createdAt": stamp, "updatedAt": stamp, "archived": False}


def _step(title: str, offset: int, kind: str = "plain", request: Optional[dict] = None) -> dict:
    return {"title": title, "offsetDays": offset, "kind": kind, "prep": "", "requestsDocument": request}


def plan_cycle(routine: dict, assignment: dict, due: str, today: str) -> list[dict]:
    """Step tasks for one cycle ending on ``due``; past dates move to today."""
    plan = assignment.get("plan") if assignment.get("plan") is not None else routine.get("plan", [])
    out = []
    for p in sorted(plan, key=lambda p: p["offsetDays"]):
        out.append({
            "kind": "task",
            **_base("t"),
            "subjectId": assignment["subjectId"],
            "parentId": None,
            "title": p["title"],
            "notes": f"Prep: {p['prep']}" if p.get("prep") else "",
            "date": max(_add_days(due, p["offsetDays"]), today),
            "order": next_order(),
            "done": False,
            "doneAt": None,
            "source": {"kind": "assignment", "id": assignment["id"], "step": p["kind"]},
            "appointment": None,
            "requestsDocument": p.get("requestsDocument"),
        })
    return out


class _Tx:
    """Pending puts/deletes over a loaded household."""

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


def _from_assignment(t: dict, a_id: str) -> bool:
    src = t.get("source") or {}
    return src.get("kind") == "assignment" and src.get("id") == a_id


# ── routine rules ───────────────────────────────────────────────────────────


def _replan_to(tx: _Tx, routine: dict, a: dict, due: str, category: str, today: str) -> dict:
    """Move the assignment to ``due`` and replace its open, unbooked steps (and their subtasks)."""
    moved = tx.put({**tx.get(a), "date": due, "done": False})
    tasks = tx.tasks()
    for t in tasks:
        if (
            _from_assignment(t, a["id"]) and not t.get("done") and not t.get("appointment")
            and (t.get("requestsDocument") or {}).get("category") != category
        ):
            for child in tasks:
                if child.get("parentId") == t["id"]:
                    tx.delete(child)
            tx.delete(t)
    fresh = plan_cycle(routine, moved, due, today)
    for t in fresh:
        tx.put(t)
    return {"routineMovedTo": due, "steps": [{"title": t["title"], "date": t["date"]} for t in fresh]}


def _shift(tx: _Tx, routine: dict, a: dict, new_date: str, today: str) -> dict:
    """Shift the assignment and its open steps by the date change."""
    cur = tx.get(a)
    tx.put({**cur, "date": new_date, "done": False})
    open_ = [t for t in tx.tasks() if _from_assignment(t, a["id"]) and not t.get("done") and not t.get("appointment")]
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
    """A renewal routine + assignment + steps for an expiring document."""
    t = doc["type"]
    valid_until = doc["expiry"]["validUntil"]
    is_passport = t == "Passport"
    label = "document" if t == "Other" else ("ID card" if t == "City or state ID" else t.lower())
    plan = [_step("Submit passport renewal" if is_passport else f"Renew {label}", -remind_days, "renew")]
    if is_passport:
        plan.insert(0, _step("Check renewal requirements and get a photo", -(remind_days + 30)))
    routine = tx.put({
        "kind": "routine",
        **_base("r"),
        "area": cat["area"],
        "template": None,
        "icon": cat["icon"],
        "title": f"{doc['title'] if t == 'Other' else t} renewal",
        "description": f"Renewal reminders for {doc['title']}.",
        "dateLabel": "Expires",
        "plan": plan,
        "followUps": [_step(f"Add the new {label} to documents", 0, "plain", {"category": doc["category"], "type": t})],
        "repeatMonths": None,
        "countFrom": "due",
        "extension": None,
    })
    a = tx.put({
        "kind": "assignment",
        **_base("a"),
        "routineId": routine["id"],
        "subjectId": doc["subjectId"],
        "date": valid_until,
        "repeatMonths": None,
        "done": False,
        "contactId": None,
        "supply": None,
        "history": [],
        "plan": None,
        "countFrom": None,
    })
    tasks = plan_cycle(routine, a, valid_until, today)
    for x in tasks:
        tx.put(x)
    doc["assignmentId"] = a["id"]
    return {
        "renewalRoutine": routine["title"],
        "remindersPlannedFrom": min((x["date"] for x in tasks), default=valid_until),
        "steps": [{"title": x["title"], "date": x["date"]} for x in tasks],
    }


def _valid_until(doc: Optional[dict]) -> Optional[str]:
    exp = (doc or {}).get("expiry")
    return exp["validUntil"] if exp and not exp.get("outdated") else None


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
    prev = _by_id(state, "documents", fields.get("id"))

    if prev:
        for k in FIXED:
            if k in fields and fields[k] != prev[k]:
                raise DocumentError(f"{k} can't be changed on an existing document")
        doc = {**prev, **{k: v for k, v in fields.items() if k in EDITABLE}}
    else:
        missing = [k for k in ("subjectId", "category") if not fields.get(k)]
        if missing:
            raise DocumentError(f"A new document needs {', '.join(missing)}")
        cat0 = registry.categories().get(fields["category"])
        if not cat0:
            raise DocumentError(f"Unknown document category {fields['category']!r}")
        stamp = now_stamp()
        doc = {
            "kind": "document",
            "id": fields.get("id") or new_id("d"),
            "createdAt": stamp,
            "updatedAt": stamp,
            "archived": False,
            "subjectId": fields["subjectId"],
            "attachedTo": None,
            "category": fields["category"],
            "type": cat0["defaultType"],
            "title": "",
            "date": today if cat0.get("datedByDefault") else None,
            "files": [],
            "fields": {},
            "customFields": [],
            "assignmentId": None,
            "pinned": bool(cat0["pin"]["default"]),
            "expiry": None,
        }
        # Copy what the caller set; null only counts for fields where it means "none".
        doc.update({k: v for k, v in fields.items() if k in EDITABLE and (v is not None or k in NULLABLE)})
        if not doc.get("type"):
            doc["type"] = cat0["defaultType"]

    cat = registry.category(doc["category"])
    rules = cat["rules"]
    subject = _by_id(state, "subjects", doc["subjectId"])
    if not subject:
        raise NotFound(f"No subject with id {doc['subjectId']!r}")
    who = subject["name"]

    doc["title"] = (doc.get("title") or "").strip()
    if not doc["title"]:
        raise DocumentError("A document needs a title")
    # Empty values don't need storing.
    doc["fields"] = {k: v for k, v in (doc.get("fields") or {}).items() if v not in (None, "", [])}
    if doc.get("archived"):
        doc["pinned"] = False

    a = _by_id(state, "assignments", doc.get("assignmentId"))
    routine = _by_id(state, "routines", a["routineId"]) if a else None
    if doc.get("assignmentId") and not a:
        raise NotFound(f"No routine assignment with id {doc['assignmentId']!r}")

    close_task = _by_id(state, "tasks", close_task_id)
    if close_task_id and not close_task:
        raise NotFound(f"No task with id {close_task_id!r}")

    is_new = prev is None
    if (
        is_new and duplicates == "reject" and rules.get("onePerType")
        and doc["type"] not in rules.get("onePerTypeExempt", []) and not a
    ):
        current = [
            d for d in state.get("documents", [])
            if d.get("category") == doc["category"] and d.get("subjectId") == doc["subjectId"]
            and d.get("type") == doc["type"] and not d.get("archived") and not (d.get("expiry") or {}).get("outdated")
        ]
        if current:
            existing = []
            for d in current:
                da = _by_id(state, "assignments", d.get("assignmentId"))
                dr = _by_id(state, "routines", da["routineId"]) if da else None
                existing.append({"id": d["id"], "title": d["title"], "validUntil": (d.get("expiry") or {}).get("validUntil"),
                                 "assignmentId": da["id"] if da else None, "routine": dr["title"] if dr else None})
            raise Duplicate(f"{who} already has an active {doc['type'].lower()}", existing)

    tx = _Tx(state)
    summary: dict[str, Any] = {}
    stamp = now_stamp()

    linked_now = bool(a) and (is_new or (prev or {}).get("assignmentId") != doc["assignmentId"])
    if linked_now and rules.get("replaceOnLink"):
        archived = [
            tx.put({**o, "archived": True, "pinned": False})
            for o in state.get("documents", [])
            if o["id"] != doc["id"] and o.get("assignmentId") == a["id"] and o.get("type") == doc["type"] and not o.get("archived")
        ]
        if archived:
            summary["archivedOlder"] = [o["title"] for o in archived]
    if a and is_new:
        closed = [
            tx.put({**t, "done": True, "doneAt": stamp})
            for t in state.get("tasks", [])
            if _from_assignment(t, a["id"]) and not t.get("done")
            and (t.get("requestsDocument") or {}).get("category") == doc["category"]
        ]
        if closed:
            summary["closedTasks"] = [t["title"] for t in closed]
    if close_task and not close_task.get("done"):
        tx.put({**tx.get(close_task), "done": True, "doneAt": stamp})
        summary.setdefault("closedTasks", []).append(close_task["title"])

    vu = _valid_until(doc)
    if a and routine and rules.get("expiryDrivesRoutine") and vu and not (routine.get("extension") or {}).get("medication"):
        prev_vu = _valid_until(prev)
        if linked_now:
            if vu != a.get("date"):
                summary.update(_replan_to(tx, routine, a, vu, doc["category"], today))
        elif prev_vu and prev_vu != vu:
            new_date = _add_days(a["date"], _diff_days(prev_vu, vu)) if a.get("date") else vu
            summary.update(_shift(tx, routine, a, new_date, today))

    if renewal is not None and not a:
        if not rules.get("renewal"):
            raise DocumentError(f"{cat['label']} documents don't have renewal reminders")
        if vu:
            days = renewal.get("remindDays")
            days = registry.remind_days_default(doc["category"], doc["type"]) if days is None else days
            summary.update(_renewal(tx, doc, cat, days, today))
        else:
            summary["note"] = "No renewal reminder: it needs an expiry date."

    if routine:
        summary["linkedRoutine"] = routine["title"]
    tx.put(doc)
    summary["document"] = {"id": doc["id"], "subject": who, "title": doc["title"], "type": doc["type"], "created": is_new}
    return list(tx.puts.values()), list(tx.dels.values()), doc, summary

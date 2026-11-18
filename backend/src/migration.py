"""Version 1 → version 2 migration (pure; no AWS).

``migrate(v1_state)`` takes a version 1 household (people, cars, contacts,
routines, assignments, tasks, documents, trips, reservations — as stored under
``COO#``) and returns ``(v2_records, report)``. Nothing is dropped silently:
anything that doesn't map cleanly is noted in ``report["notes"]``.

Ids are kept, so every reference still resolves. New records get stable ids
derived from their source (subtask ``<task>-<subtask>``, reservation file
``<reservation>-f<n>``), so running it twice gives the same result.

Mapping (see data-structure.md for the full table):
- person / car / trip → subject (attributes per the registry)
- task.subtasks[] → tasks with parentId; task trip/reservation/assignment
  links → subjectId + source; docTask → requestsDocument
- document → category/title/files[]/fields/customFields/expiry
- reservation.files[] → attachment documents attachedTo the reservation;
  address/confirmation/link/details → fields
- contact.group → tags; links from every reference to the contact
- routine.medication → extension; docTask → requestsDocument
"""

from __future__ import annotations

import re
from typing import Any, Optional

from src import registry

V1_COLLECTIONS = ("people", "cars", "contacts", "routines", "assignments", "tasks", "documents", "trips", "reservations")
_URL = re.compile(r"^https?://\S+$", re.I)


def _base(rec: dict, kind: str, id_: Optional[str] = None) -> dict:
    return {"kind": kind, "id": id_ or rec["id"], "createdAt": rec["createdAt"], "updatedAt": rec["updatedAt"], "archived": False}


def _compact(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", [])}


def _request(doc_task: Optional[dict]) -> Optional[dict]:
    return {"category": doc_task["docKind"], "type": doc_task["docType"]} if doc_task else None


def _steps(plan: Optional[list]) -> Optional[list]:
    if plan is None:
        return None
    return [
        {"title": p["title"], "offsetDays": p["offsetDays"], "kind": p["kind"], "prep": p["prep"], "requestsDocument": _request(p.get("docTask"))}
        for p in plan
    ]


def migrate(v1: dict[str, list[dict]]) -> tuple[list[dict], dict[str, Any]]:
    out: list[dict] = []
    notes: list[str] = []
    counts: dict[str, int] = {}

    def emit(rec: dict) -> None:
        out.append(rec)
        counts[rec["kind"]] = counts.get(rec["kind"], 0) + 1

    people = {p["id"] for p in v1.get("people", [])}
    subjects: dict[str, str] = {}  # id → subjectType

    # ── subjects ────────────────────────────────────────────────────────────
    for p in v1.get("people", []):
        subjects[p["id"]] = "person"
        emit({**_base(p, "subject"), "subjectType": "person", "name": p["name"], "notes": "",
              "attributes": _compact({"birthYear": p.get("birthYear")})})
    for c in v1.get("cars", []):
        subjects[c["id"]] = "car"
        emit({**_base(c, "subject"), "subjectType": "car", "name": c["makeModel"], "notes": "",
              "attributes": _compact({"plate": c.get("plate"), "odometer": c.get("odometer")})})
    for t in v1.get("trips", []):
        subjects[t["id"]] = "trip"
        travelers = [i for i in t.get("travelers", []) if i in people]
        if len(travelers) != len(t.get("travelers", [])):
            notes.append(f"trip {t['id']}: dropped travelers that aren't people: {sorted(set(t['travelers']) - set(travelers))}")
        emit({**_base(t, "subject"), "subjectType": "trip", "name": t["name"], "notes": t.get("notes", ""),
              "attributes": _compact({"destination": t.get("destination"), "start": t["start"], "end": t["end"], "travelers": travelers})})

    # ── routines / assignments ──────────────────────────────────────────────
    for r in v1.get("routines", []):
        emit({**_base(r, "routine"), "area": r["area"], "template": r.get("template"), "icon": r["icon"], "title": r["title"],
              "description": r["description"], "dateLabel": r["dateLabel"], "plan": _steps(r["plan"]),
              "followUps": _steps(r["followUps"]), "repeatMonths": r["repeatMonths"], "countFrom": r["countFrom"],
              "extension": {"medication": True} if r.get("medication") else None})
    for a in v1.get("assignments", []):
        emit({**_base(a, "assignment"), "routineId": a["routineId"], "subjectId": a["subjectId"], "date": a["date"],
              "repeatMonths": a["repeatMonths"], "done": a["done"], "contactId": a["contactId"], "supply": a["supply"],
              "history": a["history"], "plan": _steps(a.get("plan")), "countFrom": a.get("countFrom")})

    # ── reservations (+ their files → attachment documents) ─────────────────
    for r in v1.get("reservations", []):
        fields = _compact({"address": r.get("address"), "confirmation": r.get("confirmation"), "details": r.get("details")})
        link = (r.get("link") or "").strip()
        if link:
            if _URL.match(link):
                fields["link"] = link
            else:
                fields["details"] = (fields.get("details", "") + f"\n\nLink: {link}").strip()
                notes.append(f"reservation {r['id']}: link {link!r} isn't an http(s) URL; moved to details")
        emit({**_base(r, "reservation"), "subjectId": r["tripId"], "type": r["type"], "title": r["title"],
              "start": r["start"], "end": r["end"], "status": r["status"], "bookBy": r["bookBy"],
              "checkinReminder": r["checkinReminder"], "fields": fields})
        for i, f in enumerate(r.get("files", []), 1):
            emit({**_base(r, "document", f"{r['id']}-f{i}"), "subjectId": r["tripId"],
                  "attachedTo": {"kind": "reservation", "id": r["id"]}, "category": "attachment", "type": "File",
                  "title": f["name"][:300], "date": None, "files": [{"role": None, "file": f}], "fields": {},
                  "customFields": [], "assignmentId": None, "pinned": False, "expiry": None})

    # ── tasks (+ subtasks) ──────────────────────────────────────────────────
    reservations = {r["id"]: r for r in v1.get("reservations", [])}
    for t in v1.get("tasks", []):
        subject_id = t.get("subjectId")
        source = None
        if t.get("reservationId"):
            res = reservations.get(t["reservationId"])
            if res:
                subject_id = res["tripId"]
                source = {"kind": "reservation", "id": res["id"], "step": t.get("tripTask") or "book"}
            else:
                notes.append(f"task {t['id']}: its reservation {t['reservationId']} is gone; kept as a plain task")
        elif t.get("tripId"):
            subject_id = t["tripId"]
        if t.get("assignmentId"):
            source = {"kind": "assignment", "id": t["assignmentId"], "step": t.get("stepKind") or "plain"}
        elif t.get("stepKind") not in (None, "plain"):
            notes.append(f"task {t['id']}: a {t['stepKind']} step without a routine; kept as a plain task")
        if t.get("subjectId") and subject_id != t["subjectId"]:
            notes.append(f"task {t['id']}: had subject {t['subjectId']} and trip {subject_id}; moved to the trip")
        emit({**_base(t, "task"), "subjectId": subject_id, "parentId": None, "title": t["title"] or "Untitled",
              "notes": t.get("notes", ""), "date": t["date"], "order": t["order"], "done": t["done"], "doneAt": t["doneAt"],
              "source": source, "appointment": t.get("appointment"), "requestsDocument": _request(t.get("docTask"))})
        for i, st in enumerate(t.get("subtasks", [])):
            emit({**_base(t, "task", f"{t['id']}-{st['id']}"[:64]), "subjectId": subject_id, "parentId": t["id"],
                  "title": st["title"], "notes": "", "date": st.get("date"),
                  "order": st["order"] if st.get("order") is not None else t["order"] + (i + 1) / 1000,
                  "done": st["done"], "doneAt": st.get("doneAt"), "source": None, "appointment": None, "requestsDocument": None})

    # ── documents ───────────────────────────────────────────────────────────
    for d in v1.get("documents", []):
        cat_key = d["docKind"]
        defs = registry.category_fields(cat_key, d["type"])
        by_label = {f["label"].lower(): f["key"] for f in defs}
        keys = {f["key"] for f in defs}
        fields: dict[str, Any] = {}
        for k in ("idNumber", "issuer", "issueDate", "providerId", "about", "episode"):
            if d.get(k) and k in keys:
                fields[k] = d[k]
            elif d.get(k):
                notes.append(f"document {d['id']}: {k} isn't a {cat_key} field; kept as a custom field")
        custom = []
        for row in d.get("details", []):
            key = by_label.get(row["name"].strip().lower())
            if key and key not in fields:
                fields[key] = row["value"]
            else:
                custom.append({"label": row["name"], "value": row["value"]})
        for k in ("idNumber", "issuer", "issueDate", "providerId", "about", "episode"):
            if d.get(k) and k not in keys:
                custom.append({"label": k, "value": str(d[k])})
        files = [{"role": role, "file": d[src]} for src, role in (("front", "front"), ("back", "back"), ("file", None)) if d.get(src)]
        expiry = None
        if d.get("validUntil"):
            if registry.category(cat_key).get("expiring"):
                expiry = {"validUntil": d["validUntil"], "outdated": bool(d.get("outdated"))}
            else:
                custom.append({"label": "Valid until", "value": d["validUntil"]})
                notes.append(f"document {d['id']}: {cat_key} documents don't expire; validUntil kept as a custom field")
        elif d.get("outdated"):
            notes.append(f"document {d['id']}: marked outdated without an expiry; flag dropped")
        emit({**_base(d, "document"), "archived": bool(d.get("archived")), "subjectId": d["subjectId"], "attachedTo": None,
              "category": cat_key, "type": d["type"], "title": d["name"] or "Untitled", "date": d.get("date"),
              "files": files, "fields": fields, "customFields": custom, "assignmentId": d.get("assignmentId"),
              "pinned": bool(d.get("pinned")), "expiry": expiry})

    # ── contacts (+ links from every reference) ─────────────────────────────
    linked: dict[str, dict[str, None]] = {}

    def link(contact_id: Optional[str], subject_id: Optional[str]) -> None:
        if contact_id and subject_id and subject_id in subjects:
            linked.setdefault(contact_id, {})[subject_id] = None

    for a in v1.get("assignments", []):
        link(a.get("contactId"), a["subjectId"])
    for t in v1.get("tasks", []):
        link((t.get("appointment") or {}).get("providerId"), t.get("subjectId"))
    for d in v1.get("documents", []):
        link(d.get("providerId"), d["subjectId"])
    for c in v1.get("contacts", []):
        emit({**_base(c, "contact"), "name": c["name"], "role": c.get("role", ""), "phone": c.get("phone", ""), "email": "",
              "notes": c.get("notes", ""), "tags": [c["group"]] if c.get("group") else [],
              "links": [{"subjectId": s, "role": c.get("role", "")} for s in linked.get(c["id"], {})]})

    return out, {"counts": counts, "notes": notes}


def to_state(records: list[dict]) -> dict[str, list[dict]]:
    from src.integrity import COLLECTIONS

    state: dict[str, list[dict]] = {c: [] for c in COLLECTIONS.values()}
    for r in records:
        state[COLLECTIONS[r["kind"]]].append(r)
    return state


def group_v1(items: list[dict]) -> dict[str, list[dict]]:
    """Version 1 items (as stored) → the v1 state shape."""
    coll = {"person": "people", "car": "cars", "contact": "contacts", "routine": "routines", "assignment": "assignments",
            "task": "tasks", "document": "documents", "trip": "trips", "reservation": "reservations"}
    state: dict[str, list[dict]] = {c: [] for c in V1_COLLECTIONS}
    for it in items:
        if it.get("kind") in coll:
            state[coll[it["kind"]]].append(it)
    return state

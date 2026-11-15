"""Creating identity and health documents from MCP.

Mirrors the app's ID and health document forms (frontend/src/dialogs/DocDialogs.tsx)
and the save rules in frontend/src/lib/ops.ts (saveDocument, renewalRoutineForId):

- IDs: type-specific detail fields; linking to an existing renewal routine
  archives the older ID of the same type on that routine and closes its open
  "add the new document" task; otherwise, with an expiry date, a renewal
  routine is created with steps planned back from the expiry (the app's
  "Remind me to renew it", on by default).
- Health documents: provider from contacts, episode, optional linked routine
  (closes that routine's open "file the document" task).

Files and ID images can't be attached over MCP; add them in the app.
"""

from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Any, Optional

from .logic import ToolError, _norm, find_subject, new_id, now_iso, parse_date, today

ID_TYPES = [
    "Passport",
    "Driver license",
    "City or state ID",
    "Birth certificate",
    "Social Security card",
    "Visa or residence card",
    "Other",
]
HEALTH_TYPES = ["Result", "Referral", "Prescription", "Visit summary", "Imaging", "Vaccination record", "Insurance", "Other"]

ID_FIELDS = {
    "Passport": ["Full name", "Nationality", "Place of birth", "Date of birth"],
    "Driver license": ["Full name", "Class", "Restrictions and endorsements", "Date of birth"],
    "City or state ID": ["Full name", "Date of birth"],
    "Birth certificate": ["Full name", "Place of birth", "Date of birth"],
    "Social Security card": ["Full name"],
    "Visa or residence card": ["Full name", "Category", "Nationality"],
    "Other": [],
}

# Friendly names Claude (or the user) may use for a type.
_ID_ALIASES = {
    "license": "Driver license",
    "drivers license": "Driver license",
    "driver's license": "Driver license",
    "driving license": "Driver license",
    "city id": "City or state ID",
    "state id": "City or state ID",
    "id card": "City or state ID",
    "ssn": "Social Security card",
    "social security": "Social Security card",
    "visa": "Visa or residence card",
    "residence card": "Visa or residence card",
    "green card": "Visa or residence card",
}
_HEALTH_ALIASES = {
    "lab result": "Result",
    "lab results": "Result",
    "results": "Result",
    "summary": "Visit summary",
    "visit": "Visit summary",
    "scan": "Imaging",
    "mri": "Imaging",
    "x-ray": "Imaging",
    "xray": "Imaging",
    "vaccination": "Vaccination record",
    "vaccine": "Vaccination record",
}


def remind_default(doc_type: str) -> int:
    return {"Passport": 180, "Driver license": 60, "City or state ID": 60}.get(doc_type, 90)


# ── matching helpers ────────────────────────────────────────────────────────


def match_choice(value: str, choices: list[str], aliases: dict[str, str], what: str) -> str:
    q = _norm(value)
    for c in choices:
        if _norm(c) == q:
            return c
    if q in aliases:
        return aliases[q]
    hits = [c for c in choices if q and q in _norm(c)]
    if len(hits) == 1:
        return hits[0]
    raise ToolError(f"Unknown {what} {value!r}. Use one of: {', '.join(choices)}.")


def find_person(state: dict, query: str) -> dict:
    kind, subject = find_subject(state, query)
    if kind != "person":
        raise ToolError(f"{query!r} is a car; documents here belong to people.")
    return subject


def find_contact(state: dict, query: str, groups: tuple[str, ...]) -> dict:
    pool = [c for c in state.get("contacts", []) if c.get("group") in groups]
    q = _norm(query)
    exact = [c for c in pool if _norm(c["name"]) == q]
    hits = exact or [c for c in pool if q and (q in _norm(c["name"]) or q in _norm(c.get("role", "")))]
    if len(hits) == 1:
        return hits[0]
    names = ", ".join(c["name"] for c in pool) or "none"
    if not hits:
        raise ToolError(f"No contact matches {query!r}. Contacts: {names}. Add new contacts in the app.")
    raise ToolError(f"{query!r} matches several contacts ({', '.join(c['name'] for c in hits)}); be more specific.")


def find_assignment(state: dict, person: dict, area: str, query: str) -> tuple[dict, dict]:
    routines = {r["id"]: r for r in state.get("routines", [])}
    mine = [
        (a, routines[a["routineId"]])
        for a in state.get("assignments", [])
        if a.get("subjectType") == "person"
        and a.get("subjectId") == person["id"]
        and a.get("routineId") in routines
        and routines[a["routineId"]].get("area") == area
    ]
    q = _norm(query)
    exact = [x for x in mine if _norm(x[1]["title"]) == q]
    hits = exact or [x for x in mine if q and q in _norm(x[1]["title"])]
    if len(hits) == 1:
        return hits[0]
    titles = ", ".join(r["title"] for _, r in mine) or "none"
    if not hits:
        raise ToolError(f"{person['name']} has no {area} routine matching {query!r}. Their {area} routines: {titles}.")
    raise ToolError(f"{query!r} matches several of {person['name']}'s routines; be more specific.")


# ── record builders (same shapes as frontend/src/lib/ops.ts) ────────────────


def _base(prefix: str) -> dict:
    stamp = now_iso()
    return {"id": new_id(prefix), "createdAt": stamp, "updatedAt": stamp}


_order_seq = 0


def _next_order() -> int:
    global _order_seq
    _order_seq = max(_order_seq + 1, int(time.time() * 1000))
    return _order_seq


def make_task(**fields: Any) -> dict:
    task = {
        "kind": "task",
        **_base("t"),
        "title": "",
        "notes": "",
        "date": today().isoformat(),
        "order": _next_order(),
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


def make_document(**fields: Any) -> dict:
    doc = {
        "kind": "document",
        **_base("d"),
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
    doc.update(fields)
    return doc


def _step(title: str, offset: int, kind: str = "plain", doc_task: Optional[dict] = None) -> dict:
    return {"title": title, "offsetDays": offset, "kind": kind, "prep": "", "docTask": doc_task}


def plan_cycle(routine: dict, assignment: dict, due: str) -> list[dict]:
    """Steps for one cycle ending on `due`; past dates are moved to today."""
    plan = assignment.get("plan") if assignment.get("plan") is not None else routine.get("plan", [])
    t0 = today()
    due_d = date.fromisoformat(due)
    out = []
    for p in sorted(plan, key=lambda p: p["offsetDays"]):
        when = max(due_d + timedelta(days=p["offsetDays"]), t0)
        out.append(
            make_task(
                title=p["title"],
                date=when.isoformat(),
                subjectType=assignment["subjectType"],
                subjectId=assignment["subjectId"],
                assignmentId=assignment["id"],
                stepKind=p["kind"],
                docTask=p.get("docTask"),
                notes=f"Prep: {p['prep']}" if p.get("prep") else "",
            )
        )
    return out


def _renewal_for_id(doc: dict, remind_days: int) -> tuple[list[dict], dict, Optional[str]]:
    """Renewal routine + assignment + steps for an ID (mirrors renewalRoutineForId)."""
    doc_type = doc["type"]
    is_passport = doc_type == "Passport"
    label = "document" if doc_type == "Other" else ("ID card" if doc_type == "City or state ID" else doc_type.lower())
    plan = [_step("Submit passport renewal" if is_passport else f"Renew {label}", -remind_days, "renew")]
    if is_passport:
        plan.insert(0, _step("Check renewal requirements and get a photo", -(remind_days + 30)))
    routine = {
        "kind": "routine",
        **_base("r"),
        "area": "identity",
        "template": None,
        "icon": "idcard",
        "title": f"{doc['name'] if doc_type == 'Other' else doc_type} renewal",
        "description": f"Renewal reminders for {doc['name']}.",
        "dateLabel": "Expires",
        "plan": plan,
        "followUps": [
            _step(f"Add the new {label} to documents", 0, "plain", {"docKind": "identity", "docType": doc_type})
        ],
        "repeatMonths": None,
        "countFrom": "due",
        "medication": False,
    }
    assignment = {
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
    tasks = plan_cycle(routine, assignment, doc["validUntil"]) if doc["validUntil"] else []
    first = min((t["date"] for t in tasks), default=doc["validUntil"])
    return [routine, assignment, *tasks], assignment, first


def _close_doc_tasks(state: dict, assignment_id: str, doc_kind: str) -> list[dict]:
    stamp = now_iso()
    return [
        {**t, "done": True, "doneAt": stamp}
        for t in state.get("tasks", [])
        if t.get("assignmentId") == assignment_id
        and not t.get("done")
        and (t.get("docTask") or {}).get("docKind") == doc_kind
    ]


def _clip(s: Optional[str], n: int) -> str:
    return (s or "").strip()[:n]


# ── public builders ─────────────────────────────────────────────────────────


def new_id_document(
    state: dict,
    person: str,
    doc_type: str,
    name: Optional[str] = None,
    id_number: Optional[str] = None,
    issuer: Optional[str] = None,
    issue_date: Optional[str] = None,
    expiry_date: Optional[str] = None,
    details: Optional[dict[str, str]] = None,
    renewal_routine: Optional[str] = None,
    remind: bool = True,
    remind_days: Optional[int] = None,
    keep_handy: bool = False,
    keep_both: bool = False,
) -> tuple[list[dict], dict]:
    p = find_person(state, person)
    t = match_choice(doc_type, ID_TYPES, _ID_ALIASES, "ID type")

    # Suggested fields for the type come first (matched case-insensitively),
    # then anything else given. Empty values are dropped, as in the app.
    given = {_norm(k): (k.strip(), (v or "").strip()) for k, v in (details or {}).items()}
    rows = []
    for field in ID_FIELDS[t]:
        hit = given.pop(_norm(field), None)
        if hit and hit[1]:
            rows.append({"name": field, "value": hit[1][:5000]})
    rows += [{"name": k[:300], "value": v[:5000]} for k, v in given.values() if k and v]

    doc = make_document(
        docKind="identity",
        subjectType="person",
        subjectId=p["id"],
        name=_clip(name, 300) or f"{p['name']}’s {t.lower()}",
        type=t,
        idNumber=_clip(id_number, 300),
        issuer=_clip(issuer, 300),
        issueDate=parse_date(issue_date) if issue_date else None,
        validUntil=parse_date(expiry_date) if expiry_date else None,
        details=rows,
        pinned=bool(keep_handy),
    )

    # A second active ID of the same type is usually a renewal. Make the
    # caller say which: replace it (link its routine) or keep both.
    if not renewal_routine and not keep_both and t != "Other":
        current = [
            d for d in state.get("documents", [])
            if d.get("docKind") == "identity" and d.get("subjectId") == p["id"]
            and d.get("type") == t and not d.get("archived") and not d.get("outdated")
        ]
        if current:
            routines = {r["id"]: r for r in state.get("routines", [])}
            assignments = {a["id"]: a for a in state.get("assignments", [])}
            parts = []
            for d in current:
                a = assignments.get(d.get("assignmentId") or "")
                r = routines.get(a["routineId"]) if a else None
                parts.append(
                    f"{d['name']!r} (expires {d.get('validUntil') or 'unknown'}"
                    + (f", renewal routine {r['title']!r})" if r else ", no renewal routine)")
                )
            hint = next((p_ for p_ in parts if "renewal routine '" in p_), None)
            raise ToolError(
                f"{p['name']} already has an active {t.lower()}: {'; '.join(parts)}. "
                "If the new one replaces it, call again with renewal_routine set to that routine's title "
                "(the old one is archived and the routine moves to the new expiry). "
                "To add it alongside, call again with keep_both=true."
                + ("" if hint else " The current one has no renewal routine, so use keep_both=true and archive the old one in the app.")
            )

    puts: list[dict] = []
    summary: dict[str, Any] = {}
    if renewal_routine:
        a, r = find_assignment(state, p, "identity", renewal_routine)
        doc["assignmentId"] = a["id"]
        archived = [
            {**o, "archived": True, "pinned": False}
            for o in state.get("documents", [])
            if o.get("assignmentId") == a["id"] and o.get("type") == t and not o.get("archived")
        ]
        closed = _close_doc_tasks(state, a["id"], "identity")
        puts += archived + closed
        summary["linkedRoutine"] = r["title"]
        # The routine now tracks the new document's expiry: move its date and
        # re-plan its open, not-yet-booked steps (as completing a renewal does).
        if doc["validUntil"] and doc["validUntil"] != a.get("date"):
            moved = {**a, "date": doc["validUntil"], "done": False}
            stale = [
                {"kind": "task", "id": x["id"]}
                for x in state.get("tasks", [])
                if x.get("assignmentId") == a["id"] and not x.get("done") and not x.get("appointment")
                and not (x.get("docTask") or {}).get("docKind") == "identity"
            ]
            fresh = plan_cycle(r, moved, doc["validUntil"])
            puts += [moved, *fresh]
            summary["routineMovedTo"] = doc["validUntil"]
            summary["steps"] = [{"title": x["title"], "date": x["date"]} for x in fresh]
            summary["_delete"] = stale
        if archived:
            summary["archivedOlder"] = [o["name"] for o in archived]
        if closed:
            summary["closedTasks"] = [x["title"] for x in closed]
    elif remind:
        if doc["validUntil"]:
            days = remind_days if remind_days is not None else remind_default(t)
            if days < 0 or days > 3650:
                raise ToolError("remind_days must be between 0 and 3650.")
            records, a, first = _renewal_for_id(doc, days)
            doc["assignmentId"] = a["id"]
            puts += records
            summary["renewalRoutine"] = records[0]["title"]
            summary["remindersPlannedFrom"] = first
            summary["steps"] = [{"title": x["title"], "date": x["date"]} for x in records[2:]]
        else:
            summary["note"] = "No renewal reminder: it needs an expiry date."

    puts.insert(0, doc)
    summary.update(
        {
            "document": {
                "id": doc["id"],
                "person": p["name"],
                "name": doc["name"],
                "type": t,
                "expires": doc["validUntil"],
                "details": [r["name"] for r in rows],
                "keepHandy": doc["pinned"],
            },
            "images": "Front and back images can be added in the coo app.",
        }
    )
    return puts, summary


def new_health_document(
    state: dict,
    person: str,
    name: str,
    doc_type: Optional[str] = None,
    on: Optional[str] = None,
    provider: Optional[str] = None,
    about: Optional[str] = None,
    episode: Optional[str] = None,
    routine: Optional[str] = None,
    keep_handy: bool = False,
) -> tuple[list[dict], dict]:
    p = find_person(state, person)
    title = _clip(name, 300)
    if not title:
        raise ToolError("A health document needs a name.")
    t = match_choice(doc_type, HEALTH_TYPES, _HEALTH_ALIASES, "document type") if doc_type else "Other"

    provider_id = None
    provider_name = None
    if provider:
        c = find_contact(state, provider, ("health", "other"))
        provider_id, provider_name = c["id"], c["name"]

    # Reuse an existing episode's spelling when it matches.
    ep = _clip(episode, 300)
    if ep:
        existing = {
            _norm(d["episode"]): d["episode"]
            for d in state.get("documents", [])
            if d.get("subjectId") == p["id"] and d.get("episode")
        }
        ep = existing.get(_norm(ep), ep)

    doc = make_document(
        docKind="health",
        subjectType="person",
        subjectId=p["id"],
        name=title,
        type=t,
        date=parse_date(on) if on else today().isoformat(),
        providerId=provider_id,
        about=_clip(about, 5000),
        episode=ep,
        pinned=bool(keep_handy),
    )
    puts: list[dict] = [doc]
    summary: dict[str, Any] = {}
    if routine:
        a, r = find_assignment(state, p, "health", routine)
        doc["assignmentId"] = a["id"]
        closed = _close_doc_tasks(state, a["id"], "health")
        puts += closed
        summary["linkedRoutine"] = r["title"]
        if closed:
            summary["closedTasks"] = [x["title"] for x in closed]
    summary["document"] = {
        "id": doc["id"],
        "person": p["name"],
        "name": doc["name"],
        "type": t,
        "date": doc["date"],
        "provider": provider_name,
        "episode": doc["episode"] or None,
        "keepHandy": doc["pinned"],
    }
    summary["file"] = "Attach the file itself in the coo app if you have one."
    return puts, summary

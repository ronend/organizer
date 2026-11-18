"""Pure helpers over a coo household (data model v2, no I/O) — used by the MCP tools.

Kept separate from tools.py so they can be exercised without an MCP server or
the API. Shapes follow frontend/src/types/coo.ts / backend/src/models.py:
every person, car, trip, ... is a ``subject``; tasks point at a subject by
``subjectId`` (null = general); a subtask is a task with ``parentId``; why a
task exists is its ``source`` (a routine step or a reservation's booking /
check-in).
"""

from __future__ import annotations

import os
import secrets
import string
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

# Steps whose completion runs a flow in the app (booking, next cycle, refill).
FLOW_STEP_KINDS = {"schedule", "renew", "pickup"}

_B36 = string.digits + string.ascii_lowercase


class ToolError(ValueError):
    """A user-facing refusal or lookup failure."""


# ── time ────────────────────────────────────────────────────────────────────


def _tz():
    """Household time zone for "today" (env COO_TIMEZONE, IANA name; default UTC)."""
    name = os.environ.get("COO_TIMEZONE", "").strip()
    if name:
        try:
            from zoneinfo import ZoneInfo

            return ZoneInfo(name)
        except Exception:
            pass
    return timezone.utc


def today() -> date:
    return datetime.now(_tz()).date()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_date(value: str) -> str:
    """Validate a 'YYYY-MM-DD' string and return it."""
    try:
        if len(value) != 10:
            raise ValueError
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise ToolError(f"Invalid date {value!r}; use YYYY-MM-DD.")


def new_id(prefix: str) -> str:
    return f"{prefix}_" + "".join(secrets.choice(_B36) for _ in range(12))


# ── lookups ─────────────────────────────────────────────────────────────────


def _norm(s: str) -> str:
    return " ".join((s or "").lower().split())


def _plate(s: str) -> str:
    return "".join(ch for ch in (s or "").upper() if ch.isalnum())


def subject_label(sub: dict) -> str:
    """Name, plus the plate for subjects that have one: "Toyota Yaris (LMN 7305)"."""
    plate = (sub.get("attributes") or {}).get("plate")
    return f"{sub['name']} ({plate})" if plate else sub["name"]


def find_subject(state: dict, query: str, types: Optional[set[str]] = None) -> dict:
    """Resolve a name, a plate, a trip destination or an id to a subject (optionally of some types)."""
    pool = [x for x in state.get("subjects", []) if not types or x["subjectType"] in types]
    q = _norm(query)

    def plate(x: dict) -> str:
        return _plate(str((x.get("attributes") or {}).get("plate") or ""))

    hits = [
        x for x in pool
        if x["id"] == query or _norm(x["name"]) == q or _norm(subject_label(x)) == q
        or (plate(x) and _plate(query) and plate(x) == _plate(query))
    ]
    if not hits:
        hits = [
            x for x in pool
            if q and (q in _norm(x["name"]) or q in _norm(str((x.get("attributes") or {}).get("destination") or "")))
        ]
    if len(hits) == 1:
        return hits[0]
    kinds = sorted({x["subjectType"] for x in pool})
    known = "; ".join(f"{k}: {', '.join(subject_label(x) for x in pool if x['subjectType'] == k)}" for k in kinds) or "none"
    if not hits:
        raise ToolError(f"Nothing matches {query!r}. Known — {known}.")
    raise ToolError(f"{query!r} is ambiguous ({', '.join(subject_label(x) for x in hits)}); be more specific.")


def find_trip(state: dict, query: str) -> dict:
    return find_subject(state, query, {"trip"})


def find_task(state: dict, task_id: str) -> dict:
    # Sub-task ids from before data model v2 looked like "<task>~<sub>"; the
    # migration turned those sub-tasks into tasks with id "<task>-<sub>".
    ids = [task_id, task_id.replace("~", "-")] if "~" in task_id else [task_id]
    for t in state.get("tasks", []):
        if t["id"] in ids:
            return t
    raise ToolError(f"No task with id {task_id!r}. Use get_agenda to see task ids.")


def _index(state: dict, key: str) -> dict[str, dict]:
    return {r["id"]: r for r in state.get(key, [])}


def step_kind(task: dict) -> str:
    src = task.get("source") or {}
    return src.get("step", "plain") if src.get("kind") == "assignment" else "plain"


def who(task: dict, subjects: dict) -> str:
    sub = subjects.get(task.get("subjectId") or "")
    if not sub:
        return "General"
    return f"Trip: {sub['name']}" if sub["subjectType"] == "trip" else subject_label(sub)


def _routine_title(task: dict, assignments: dict, routines: dict) -> Optional[str]:
    src = task.get("source") or {}
    if src.get("kind") != "assignment" or src.get("id") not in assignments:
        return None
    r = routines.get(assignments[src["id"]].get("routineId"))
    return r["title"] if r else None


def _attributes_view(sub: dict, subjects: dict) -> dict:
    """Attributes with subject references shown as names (e.g. a trip's travelers)."""
    out = {}
    for k, v in (sub.get("attributes") or {}).items():
        if isinstance(v, list) and all(isinstance(i, str) and i in subjects for i in v):
            out[k] = [subjects[i]["name"] for i in v]
        elif isinstance(v, str) and v in subjects:
            out[k] = subjects[v]["name"]
        else:
            out[k] = v
    return out


# ── views ───────────────────────────────────────────────────────────────────


def agenda(state: dict, filter: Optional[str] = None, on: Optional[date] = None) -> dict:
    """Open tasks bucketed into overdue / today / next_7_days / later.

    Top-level tasks are listed with their subtasks; dated open subtasks of open
    tasks are also rows of their own (with ``subtaskOf``).
    """
    on = on or today()
    subjects = _index(state, "subjects")
    routines = _index(state, "routines")
    assignments = _index(state, "assignments")
    tasks_by_id = _index(state, "tasks")
    children: dict[str, list[dict]] = {}
    for t in state.get("tasks", []):
        if t.get("parentId"):
            children.setdefault(t["parentId"], []).append(t)

    def visible(t: dict) -> bool:
        if t.get("done"):
            return False
        if not t.get("parentId"):
            return True
        parent = tasks_by_id.get(t["parentId"])
        return bool(t.get("date")) and bool(parent) and not parent.get("done")

    tasks = [t for t in state.get("tasks", []) if visible(t)]

    f = (filter or "everything").strip()
    if _norm(f) in ("everything", "all", ""):
        label = "everything"
    elif _norm(f) == "general":
        label = "general"
        tasks = [t for t in tasks if not t.get("subjectId")]
    else:
        sub = find_subject(state, f)
        label = who({"subjectId": sub["id"]}, subjects)
        tasks = [t for t in tasks if t.get("subjectId") == sub["id"]]

    buckets: dict[str, list] = {"overdue": [], "today": [], "next_7_days": [], "later": []}
    tasks.sort(key=lambda t: (t.get("date") is None, t.get("date") or "", t.get("order", 0)))
    for t in tasks:
        row: dict[str, Any] = {
            "id": t["id"],
            "title": t["title"],
            "date": t.get("date"),
            "who": who(t, subjects),
            "routine": _routine_title(t, assignments, routines),
            "appointment": t.get("appointment") is not None,
        }
        if t.get("appointment") and t["appointment"].get("time"):
            row["time"] = t["appointment"]["time"]
        if step_kind(t) != "plain":
            row["stepKind"] = step_kind(t)
        if (t.get("source") or {}).get("kind") == "reservation":
            row["tripTask"] = t["source"]["step"]
        if t.get("parentId"):
            row["subtaskOf"] = tasks_by_id[t["parentId"]]["title"]
        kids = sorted(children.get(t["id"], []), key=lambda c: c.get("order", 0))
        if kids:
            row["subtasks"] = [{"id": c["id"], "title": c["title"], "done": c["done"], "date": c.get("date")} for c in kids]

        if not t.get("date"):
            buckets["later"].append(row)
            continue
        delta = (date.fromisoformat(t["date"]) - on).days
        if delta < 0:
            buckets["overdue"].append(row)
        elif delta == 0:
            buckets["today"].append(row)
        elif delta <= 7:
            buckets["next_7_days"].append(row)
        else:
            buckets["later"].append(row)

    return {"today": on.isoformat(), "filter": label, **buckets}


def subjects_view(state: dict) -> dict:
    """Every subject grouped by type (people, cars, trips, ...), with attributes."""
    subjects = _index(state, "subjects")
    out: dict[str, list] = {}
    for x in sorted(state.get("subjects", []), key=lambda x: (x["subjectType"], _norm(x["name"]))):
        if x.get("archived"):
            continue
        out.setdefault(x["subjectType"], []).append(
            {"id": x["id"], "name": x["name"], "attributes": _attributes_view(x, subjects)}
        )
    return out


def routines(state: dict) -> list[dict]:
    subjects = _index(state, "subjects")
    out = []
    for r in sorted(state.get("routines", []), key=lambda r: (r["area"], _norm(r["title"]))):
        assignees = []
        for a in state.get("assignments", []):
            if a.get("routineId") != r["id"]:
                continue
            sub = subjects.get(a["subjectId"])
            plan = a.get("plan") if a.get("plan") is not None else r.get("plan", [])
            assignees.append(
                {
                    "assignmentId": a["id"],
                    "subject": subject_label(sub) if sub else "(unknown)",
                    "date": a.get("date"),
                    "repeatMonths": a.get("repeatMonths"),
                    "countFrom": a.get("countFrom") or r.get("countFrom"),
                    "customSteps": a.get("plan") is not None,
                    "steps": [{"title": p["title"], "daysBefore": -p["offsetDays"], "kind": p["kind"]} for p in plan],
                    "done": a.get("done", False),
                }
            )
        assignees.sort(key=lambda x: (x["date"] is None, x["date"] or ""))
        out.append(
            {
                "id": r["id"],
                "title": r["title"],
                "area": r["area"],
                "dateLabel": r.get("dateLabel"),
                "defaultRepeatMonths": r.get("repeatMonths"),
                "defaultCountFrom": r.get("countFrom"),
                "defaultSteps": [
                    {"title": p["title"], "daysBefore": -p["offsetDays"], "kind": p["kind"]} for p in r.get("plan", [])
                ],
                "medication": bool((r.get("extension") or {}).get("medication")),
                "assignees": assignees,
            }
        )
    return out


def _trip(x: dict) -> dict:
    a = x.get("attributes") or {}
    return {"destination": a.get("destination", ""), "start": a.get("start", ""), "end": a.get("end", ""), "travelers": a.get("travelers", [])}


def _traveler_names(state: dict, trip: dict) -> list[str]:
    subjects = _index(state, "subjects")
    return [subjects[i]["name"] for i in _trip(trip)["travelers"] if i in subjects]


def trips(state: dict) -> list[dict]:
    counts: dict[str, int] = {}
    for res in state.get("reservations", []):
        counts[res["subjectId"]] = counts.get(res["subjectId"], 0) + 1
    all_trips = [x for x in state.get("subjects", []) if x["subjectType"] == "trip"]
    return [
        {
            "id": t["id"],
            "name": t["name"],
            **{k: _trip(t)[k] for k in ("destination", "start", "end")},
            "travelers": _traveler_names(state, t),
            "reservations": counts.get(t["id"], 0),
        }
        for t in sorted(all_trips, key=lambda t: _trip(t)["start"])
    ]


def trip_detail(state: dict, query: str) -> dict:
    trip = find_trip(state, query)
    reservations = sorted((r for r in state.get("reservations", []) if r["subjectId"] == trip["id"]), key=lambda r: r["start"])
    files_of: dict[str, list[str]] = {}
    for d in state.get("documents", []):
        at = d.get("attachedTo") or {}
        if at.get("kind") == "reservation":
            files_of.setdefault(at["id"], []).extend(f["file"]["name"] for f in d.get("files", []))
    open_tasks = [
        {"id": t["id"], "title": t["title"], "date": t.get("date"),
         "tripTask": (t.get("source") or {}).get("step") if (t.get("source") or {}).get("kind") == "reservation" else None}
        for t in state.get("tasks", [])
        if t.get("subjectId") == trip["id"] and not t.get("done") and not t.get("parentId")
    ]
    return {
        "id": trip["id"],
        "name": trip["name"],
        **{k: _trip(trip)[k] for k in ("destination", "start", "end")},
        "notes": trip.get("notes", ""),
        "travelers": _traveler_names(state, trip),
        "reservations": [
            {k: r.get(k) for k in ("id", "type", "title", "start", "end", "status", "bookBy", "checkinReminder")}
            | {k: (r.get("fields") or {}).get(k, "") for k in ("address", "confirmation", "link", "details")}
            | {"files": files_of.get(r["id"], [])}
            for r in reservations
        ],
        "files": [d["title"] for d in state.get("documents", []) if d["subjectId"] == trip["id"] and not d.get("attachedTo") and not d.get("archived")],
        "openTasks": open_tasks,
    }


# ── mutations (return the full records to put) ──────────────────────────────


def _task(title: str, **fields: Any) -> dict:
    stamp = now_iso()
    task = {
        "kind": "task",
        "id": new_id("t"),
        "createdAt": stamp,
        "updatedAt": stamp,
        "archived": False,
        "subjectId": None,
        "parentId": None,
        "title": title[:300],
        "notes": "",
        "date": today().isoformat(),
        "order": int(time.time() * 1000),
        "done": False,
        "doneAt": None,
        "source": None,
        "appointment": None,
        "requestsDocument": None,
    }
    task.update(fields)
    return task


def new_task(
    state: dict,
    title: str,
    on: Optional[str] = None,
    for_: Optional[str] = None,
    notes: Optional[str] = None,
    subtasks: Optional[list[str]] = None,
) -> list[dict]:
    """A task plus one task per subtask (same subject, parentId set)."""
    title = (title or "").strip()
    if not title:
        raise ToolError("A task needs a title.")
    subject_id = None
    if for_ and _norm(for_) not in ("general", "everyone", "household"):
        subject_id = find_subject(state, for_)["id"]
    parent = _task(title, subjectId=subject_id, notes=notes or "", date=parse_date(on) if on else today().isoformat())
    kids = [
        _task(t.strip(), subjectId=subject_id, parentId=parent["id"], date=None, order=i + 1)
        for i, t in enumerate([t for t in (subtasks or []) if t and t.strip()][:100])
    ]
    return [parent, *kids]


def completed_task(task: dict) -> dict:
    if task.get("done"):
        raise ToolError(f"{task['title']!r} is already done.")
    kind = step_kind(task)
    if kind in FLOW_STEP_KINDS:
        what = {
            "schedule": "it asks for the appointment date, time, provider and prep notes",
            "renew": "it asks for the new expiry / next due date and plans the next cycle",
            "pickup": "it asks for the quantity received and refills left",
        }[kind]
        raise ToolError(
            f"{task['title']!r} is a routine step that must be completed in the coo app ({what}). "
            "Tick its checkbox on the Agenda in the app."
        )
    src = task.get("source") or {}
    if src.get("kind") == "reservation" and src.get("step") == "book":
        raise ToolError(
            f"{task['title']!r} is a booking task; complete it in the coo app by saving the "
            "reservation as Booked (that closes the task)."
        )
    return {**task, "done": True, "doneAt": now_iso()}


def rescheduled_task(task: dict, on: str) -> dict:
    if task.get("appointment") is not None:
        raise ToolError(f"{task['title']!r} is a booked appointment; change its date in the coo app.")
    return {**task, "date": parse_date(on)}

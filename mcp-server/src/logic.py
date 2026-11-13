"""Pure helpers over a CooState dict (no I/O) — used by the MCP tools.

Kept separate from tools.py so they can be exercised without an MCP server or
the API. Shapes follow frontend/src/types/coo.ts (camelCase).
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


def car_label(car: dict) -> str:
    return f"{car.get('makeModel', '')} ({car.get('plate', '')})".strip()


def find_subject(state: dict, query: str) -> tuple[str, dict]:
    """Resolve a person name or a car make/model/plate to ("person"|"car", record)."""
    q = _norm(query)
    matches: list[tuple[str, dict]] = []
    for p in state.get("people", []):
        if p["id"] == query or _norm(p["name"]) == q:
            matches.append(("person", p))
    for c in state.get("cars", []):
        if (
            c["id"] == query
            or _norm(c["makeModel"]) == q
            or (_plate(query) and _plate(c["plate"]) == _plate(query))
            or _norm(car_label(c)) == q
        ):
            matches.append(("car", c))
    if not matches:
        # Fall back to a unique prefix/substring match on names.
        for p in state.get("people", []):
            if q and q in _norm(p["name"]):
                matches.append(("person", p))
        for c in state.get("cars", []):
            if q and q in _norm(c["makeModel"]):
                matches.append(("car", c))
    if len(matches) == 1:
        return matches[0]
    people = ", ".join(p["name"] for p in state.get("people", [])) or "none"
    cars = ", ".join(car_label(c) for c in state.get("cars", [])) or "none"
    if not matches:
        raise ToolError(f"No person or car matches {query!r}. People: {people}. Cars: {cars}.")
    names = ", ".join(r.get("name") or car_label(r) for _, r in matches)
    raise ToolError(f"{query!r} is ambiguous ({names}); be more specific.")


def find_trip(state: dict, query: str) -> dict:
    trips = state.get("trips", [])
    for t in trips:
        if t["id"] == query:
            return t
    q = _norm(query)
    exact = [t for t in trips if _norm(t["name"]) == q]
    if len(exact) == 1:
        return exact[0]
    partial = [t for t in trips if q and (q in _norm(t["name"]) or q in _norm(t["destination"]))]
    if len(partial) == 1:
        return partial[0]
    names = ", ".join(t["name"] for t in trips) or "none"
    if not partial and not exact:
        raise ToolError(f"No trip matches {query!r}. Trips: {names}.")
    raise ToolError(f"{query!r} matches several trips; be more specific. Trips: {names}.")


def find_task(state: dict, task_id: str) -> dict:
    for t in state.get("tasks", []):
        if t["id"] == task_id:
            return t
    raise ToolError(f"No task with id {task_id!r}. Use get_agenda to see task ids.")


def _index(state: dict, key: str) -> dict[str, dict]:
    return {r["id"]: r for r in state.get(key, [])}


def who(task: dict, people: dict, cars: dict, trips: dict) -> str:
    if task.get("subjectType") == "person" and task.get("subjectId") in people:
        return people[task["subjectId"]]["name"]
    if task.get("subjectType") == "car" and task.get("subjectId") in cars:
        return car_label(cars[task["subjectId"]])
    if task.get("tripId") and task["tripId"] in trips:
        return f"Trip: {trips[task['tripId']]['name']}"
    return "General"


# ── views ───────────────────────────────────────────────────────────────────


def agenda(state: dict, filter: Optional[str] = None, on: Optional[date] = None) -> dict:
    """Open tasks bucketed into overdue / today / next_7_days / later."""
    on = on or today()
    people = _index(state, "people")
    cars = _index(state, "cars")
    trips = _index(state, "trips")
    routines = _index(state, "routines")
    assignments = _index(state, "assignments")

    tasks = [t for t in state.get("tasks", []) if not t.get("done")]

    f = (filter or "everything").strip()
    if _norm(f) in ("everything", "all", ""):
        label = "everything"
    elif _norm(f) == "general":
        label = "general"
        tasks = [t for t in tasks if not t.get("subjectType") and not t.get("tripId")]
    else:
        try:
            stype, subject = find_subject(state, f)
            label = subject.get("name") or car_label(subject)
            tasks = [
                t for t in tasks if t.get("subjectType") == stype and t.get("subjectId") == subject["id"]
            ]
        except ToolError as subject_err:
            try:
                trip = find_trip(state, f)
            except ToolError:
                raise subject_err from None
            label = f"Trip: {trip['name']}"
            tasks = [t for t in tasks if t.get("tripId") == trip["id"]]

    buckets: dict[str, list] = {"overdue": [], "today": [], "next_7_days": [], "later": []}
    tasks.sort(key=lambda t: (t.get("date") is None, t.get("date") or "", t.get("order", 0)))
    for t in tasks:
        routine_title = None
        if t.get("assignmentId") and t["assignmentId"] in assignments:
            r = routines.get(assignments[t["assignmentId"]].get("routineId"))
            routine_title = r["title"] if r else None
        row: dict[str, Any] = {
            "id": t["id"],
            "title": t["title"],
            "date": t.get("date"),
            "who": who(t, people, cars, trips),
            "routine": routine_title,
            "appointment": t.get("appointment") is not None,
        }
        if t.get("appointment") and t["appointment"].get("time"):
            row["time"] = t["appointment"]["time"]
        if t.get("stepKind") and t["stepKind"] != "plain":
            row["stepKind"] = t["stepKind"]
        if t.get("subtasks"):
            row["subtasks"] = [
                {"title": s["title"], "done": s["done"], "date": s.get("date")} for s in t["subtasks"]
            ]

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


def people_and_cars(state: dict) -> dict:
    return {
        "people": [
            {"id": p["id"], "name": p["name"], "birthYear": p.get("birthYear")}
            for p in sorted(state.get("people", []), key=lambda p: _norm(p["name"]))
        ],
        "cars": [
            {"id": c["id"], "makeModel": c["makeModel"], "plate": c["plate"], "odometer": c.get("odometer")}
            for c in sorted(state.get("cars", []), key=lambda c: _norm(c["makeModel"]))
        ],
    }


def routines(state: dict) -> list[dict]:
    people = _index(state, "people")
    cars = _index(state, "cars")
    out = []
    for r in sorted(state.get("routines", []), key=lambda r: (r["area"], _norm(r["title"]))):
        assignees = []
        for a in state.get("assignments", []):
            if a.get("routineId") != r["id"]:
                continue
            if a["subjectType"] == "person":
                name = people.get(a["subjectId"], {}).get("name", "(unknown person)")
            else:
                car = cars.get(a["subjectId"])
                name = car_label(car) if car else "(unknown car)"
            plan = a.get("plan") if a.get("plan") is not None else r.get("plan", [])
            assignees.append(
                {
                    "assignmentId": a["id"],
                    "subject": name,
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
                "medication": r.get("medication", False),
                "assignees": assignees,
            }
        )
    return out


def _traveler_names(state: dict, trip: dict) -> list[str]:
    people = _index(state, "people")
    return [people[i]["name"] for i in trip.get("travelers", []) if i in people]


def trips(state: dict) -> list[dict]:
    counts: dict[str, int] = {}
    for res in state.get("reservations", []):
        counts[res["tripId"]] = counts.get(res["tripId"], 0) + 1
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "destination": t["destination"],
            "start": t["start"],
            "end": t["end"],
            "travelers": _traveler_names(state, t),
            "reservations": counts.get(t["id"], 0),
        }
        for t in sorted(state.get("trips", []), key=lambda t: t["start"])
    ]


def trip_detail(state: dict, query: str) -> dict:
    trip = find_trip(state, query)
    reservations = sorted(
        (r for r in state.get("reservations", []) if r["tripId"] == trip["id"]),
        key=lambda r: r["start"],
    )
    open_tasks = [
        {"id": t["id"], "title": t["title"], "date": t.get("date"), "tripTask": t.get("tripTask")}
        for t in state.get("tasks", [])
        if t.get("tripId") == trip["id"] and not t.get("done")
    ]
    return {
        **{k: trip[k] for k in ("id", "name", "destination", "start", "end", "notes")},
        "travelers": _traveler_names(state, trip),
        "reservations": [
            {
                k: r.get(k)
                for k in (
                    "id", "type", "title", "start", "end", "status", "bookBy",
                    "address", "confirmation", "link", "details", "checkinReminder",
                )
            }
            | {"files": [f["name"] for f in r.get("files", [])]}
            for r in reservations
        ],
        "openTasks": open_tasks,
    }


# ── mutations (return the full record to put) ───────────────────────────────


def new_task(
    state: dict,
    title: str,
    on: Optional[str] = None,
    for_: Optional[str] = None,
    notes: Optional[str] = None,
    subtasks: Optional[list[str]] = None,
) -> dict:
    title = (title or "").strip()
    if not title:
        raise ToolError("A task needs a title.")
    subject_type = subject_id = None
    if for_ and _norm(for_) not in ("general", "everyone", "household"):
        subject_type, subject = find_subject(state, for_)
        subject_id = subject["id"]
    stamp = now_iso()
    return {
        "kind": "task",
        "id": new_id("t"),
        "createdAt": stamp,
        "updatedAt": stamp,
        "title": title[:300],
        "notes": notes or "",
        "date": parse_date(on) if on else today().isoformat(),
        "order": int(time.time() * 1000),
        "done": False,
        "doneAt": None,
        "subjectType": subject_type,
        "subjectId": subject_id,
        "assignmentId": None,
        "stepKind": "plain",
        "appointment": None,
        "tripId": None,
        "reservationId": None,
        "tripTask": None,
        "docTask": None,
        "subtasks": [
            {"id": new_id("st"), "title": s.strip()[:300], "done": False, "date": None}
            for s in (subtasks or [])
            if s and s.strip()
        ][:100],
    }


def completed_task(task: dict) -> dict:
    if task.get("done"):
        raise ToolError(f"{task['title']!r} is already done.")
    if task.get("stepKind") in FLOW_STEP_KINDS:
        what = {
            "schedule": "it asks for the appointment date, time, provider and prep notes",
            "renew": "it asks for the new expiry / next due date and plans the next cycle",
            "pickup": "it asks for the quantity received and refills left",
        }[task["stepKind"]]
        raise ToolError(
            f"{task['title']!r} is a routine step that must be completed in the coo app ({what}). "
            "Open the task in the app and use its primary action."
        )
    if task.get("tripTask") == "book":
        raise ToolError(
            f"{task['title']!r} is a booking task; complete it in the coo app by saving the "
            "reservation as Booked (that closes the task)."
        )
    return {**task, "done": True, "doneAt": now_iso()}


def rescheduled_task(task: dict, on: str) -> dict:
    if task.get("appointment") is not None:
        raise ToolError(
            f"{task['title']!r} is a booked appointment; change its date in the coo app."
        )
    return {**task, "date": parse_date(on)}

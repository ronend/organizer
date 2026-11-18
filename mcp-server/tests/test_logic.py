"""Agenda, subjects, routines, trips and the task tools on data model v2.
Records the tools write are checked with the backend's models and household
checks."""

import asyncio
from datetime import date

import pytest

from src import logic
from src.logic import ToolError
from tests.conftest import check_records


def subject(state, name):
    return next(s for s in state["subjects"] if s["name"] == name)


def rows(view):
    return [r for b in ("overdue", "today", "next_7_days", "later") for r in view[b]]


# ── lookups ─────────────────────────────────────────────────────────────────


def test_find_subject(state):
    assert logic.find_subject(state, "alex")["subjectType"] == "person"
    assert logic.find_subject(state, "kdr4821")["name"] == "Honda Civic"
    assert logic.find_subject(state, "Toyota Yaris (LMN 7305)")["name"] == "Toyota Yaris"
    assert logic.find_trip(state, "portugal")["name"] == "Lisbon and Sintra"  # by destination
    with pytest.raises(ToolError, match="Nothing matches"):
        logic.find_subject(state, "Zed")


def test_old_subtask_ids_still_resolve(state):
    sub = next(t for t in state["tasks"] if t["parentId"])
    old = sub["id"].replace(f"{sub['parentId']}-", f"{sub['parentId']}~", 1)
    assert logic.find_task(state, old)["id"] == sub["id"]


# ── views ───────────────────────────────────────────────────────────────────


def test_agenda_rows(state):
    view = logic.agenda(state, on=date.today())
    all_rows = rows(view)
    ids = {r["id"] for r in all_rows}
    # Top-level open tasks are all there; done ones aren't.
    for t in state["tasks"]:
        if not t["parentId"]:
            assert (t["id"] in ids) == (not t["done"]), t["title"]
    parent = next(r for r in all_rows if r.get("subtasks"))
    assert {"id", "title", "done", "date"} <= set(parent["subtasks"][0])
    # A dated open sub-task of an open task is a row of its own.
    dated = [r for r in all_rows if r.get("subtaskOf")]
    assert all(r["date"] for r in dated)
    trip_rows = [r for r in all_rows if r["who"].startswith("Trip: ")]
    assert trip_rows and all(r.get("tripTask") in ("book", "checkin") for r in trip_rows)


def test_agenda_filters(state):
    alex = rows(logic.agenda(state, "Alex"))
    assert alex and all(r["who"] == "Alex" for r in alex)
    trip = logic.agenda(state, "Lisbon")
    assert trip["filter"] == "Trip: Lisbon and Sintra" and rows(trip)
    general = rows(logic.agenda(state, "general"))
    assert all(r["who"] == "General" for r in general)


def test_subjects_view_resolves_references(state):
    view = logic.subjects_view(state)
    assert {"person", "car", "trip"} <= set(view)
    lisbon = next(t for t in view["trip"] if t["name"].startswith("Lisbon"))
    assert "Alex" in lisbon["attributes"]["travelers"]
    assert next(c for c in view["car"] if c["name"] == "Honda Civic")["attributes"]["plate"] == "KDR 4821"


def test_routines_and_trips(state):
    rs = logic.routines(state)
    ins = next(r for r in rs if r["title"] == "Car insurance")
    assert {a["subject"] for a in ins["assignees"]} == {"Honda Civic (KDR 4821)", "Toyota Yaris (LMN 7305)"}
    assert any(r["medication"] for r in rs)
    trips = logic.trips(state)
    assert trips[0]["start"] <= trips[-1]["start"] and all(t["reservations"] >= 1 for t in trips)
    detail = logic.trip_detail(state, "Lisbon")
    flight = next(r for r in detail["reservations"] if r["type"] == "flight")
    assert flight["confirmation"] and isinstance(flight["files"], list)
    assert any(r["files"] for r in detail["reservations"])  # ticket attachments


# ── task tools ──────────────────────────────────────────────────────────────


def test_new_task_with_subtasks_passes_backend_checks(state):
    records = logic.new_task(state, "Plan the garage clean-out", "2026-12-01", "Civic", "Before winter", ["Sort tools", "  ", "Call recycling"])
    parent, *kids = records
    civic = subject(state, "Honda Civic")
    assert parent["subjectId"] == civic["id"] and parent["parentId"] is None
    assert [k["title"] for k in kids] == ["Sort tools", "Call recycling"]
    assert all(k["parentId"] == parent["id"] and k["subjectId"] == civic["id"] for k in kids)
    assert check_records(state, records) == []


def test_task_for_a_trip(state):
    (t,) = logic.new_task(state, "Buy adapters", None, "Lisbon")
    assert t["subjectId"] == subject(state, "Lisbon and Sintra")["id"]
    assert check_records(state, [t]) == []


def test_complete_and_reschedule(state):
    plain = next(t for t in state["tasks"] if not t["done"] and not t["source"] and not t["parentId"] and not t["appointment"])
    done = logic.completed_task(plain)
    assert done["done"] and done["doneAt"]
    sub = next(t for t in state["tasks"] if t["parentId"] and not t["done"])
    assert logic.completed_task(sub)["done"]
    moved = logic.rescheduled_task(sub, "2027-01-02")
    assert moved["date"] == "2027-01-02"
    assert check_records(state, [done, moved]) == []


def test_flow_steps_are_refused(state):
    step = next(t for t in state["tasks"] if (t["source"] or {}).get("step") == "schedule" and not t["done"])
    with pytest.raises(ToolError, match="must be completed in the coo app"):
        logic.completed_task(step)
    booking = next(t for t in state["tasks"] if (t["source"] or {}).get("step") == "book" and not t["done"])
    with pytest.raises(ToolError, match="booking task"):
        logic.completed_task(booking)
    appt = next(t for t in state["tasks"] if t["appointment"])
    with pytest.raises(ToolError, match="booked appointment"):
        logic.rescheduled_task(appt, "2027-01-01")


def test_tools_registered():
    from mcp.server.fastmcp import FastMCP
    from src.tools import register_tools

    mcp = FastMCP("coo-test")
    register_tools(mcp)
    names = {t.name for t in asyncio.run(mcp.list_tools())}
    assert names == {
        "get_agenda", "list_subjects", "list_routines", "list_trips", "get_trip",
        "add_task", "complete_task", "reschedule_task", "list_document_types", "add_document",
    }


def test_add_task_tool_writes_task_and_subtasks(state, monkeypatch):
    from mcp.server.fastmcp import FastMCP
    from src import client
    from src.tools import register_tools

    written = []

    async def get_state(token):
        return state

    async def batch(token, put=None, delete=None):
        written.extend(put or [])
        return {"ok": True}

    monkeypatch.setattr(client, "get_state", get_state)
    monkeypatch.setattr(client, "batch", batch)
    mcp = FastMCP("coo-test")
    register_tools(mcp)
    asyncio.run(mcp.call_tool("add_task", {"title": "Holiday cards", "who": "general", "subtasks": ["Buy stamps", "Addresses"]}))
    assert [w["title"] for w in written] == ["Holiday cards", "Buy stamps", "Addresses"]
    assert all(w["parentId"] == written[0]["id"] for w in written[1:])

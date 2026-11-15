"""add_id_document / add_health_document: records match the backend models
and follow the app's rules. Uses the household captured from the frontend
(backend/tests/fixtures/frontend_state.json)."""

import asyncio
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mcp-server"))

from src import documents  # noqa: E402
from src.logic import ToolError  # noqa: E402

COLL = {
    "person": "people", "car": "cars", "contact": "contacts", "routine": "routines",
    "assignment": "assignments", "task": "tasks", "document": "documents",
    "trip": "trips", "reservation": "reservations",
}


@pytest.fixture()
def state():
    ents = json.loads((ROOT / "backend/tests/fixtures/frontend_state.json").read_text())
    st = {v: [] for v in COLL.values()}
    for e in ents:
        st[COLL[e["kind"]]].append(e)
    return st


def test_passport_with_reminders(state):
    expiry = (date.today() + timedelta(days=400)).isoformat()
    puts, summary = documents.new_id_document(
        state, "Noa", "passport", id_number="X1234567", issuer="U.S. Department of State",
        expiry_date=expiry, details={"nationality": "United States", "Hair": "Brown"}, keep_handy=True,
        keep_both=True,  # Noa already has a passport in the demo
    )
    kinds = [p["kind"] for p in puts]
    assert kinds[:3] == ["document", "routine", "assignment"] and kinds.count("task") == 2
    doc = puts[0]
    assert doc["name"] == "Noa’s passport" and doc["type"] == "Passport" and doc["pinned"]
    assert doc["details"] == [{"name": "Nationality", "value": "United States"}, {"name": "Hair", "value": "Brown"}]
    assert doc["assignmentId"] == puts[2]["id"] and puts[2]["date"] == expiry
    steps = {s["title"]: s["date"] for s in summary["steps"]}
    assert steps["Submit passport renewal"] == (date.fromisoformat(expiry) - timedelta(days=180)).isoformat()
    assert steps["Check renewal requirements and get a photo"] == (date.fromisoformat(expiry) - timedelta(days=210)).isoformat()
    assert summary["renewalRoutine"] == "Passport renewal"


def test_past_steps_clamped_to_today(state):
    expiry = (date.today() + timedelta(days=30)).isoformat()
    puts, _ = documents.new_id_document(state, "Ben", "driver license", expiry_date=expiry)
    tasks = [p for p in puts if p["kind"] == "task"]
    assert [t["date"] for t in tasks] == [date.today().isoformat()]
    assert tasks[0]["title"] == "Renew driver license" and tasks[0]["stepKind"] == "renew"


def test_link_existing_routine_archives_older(state):
    # Alex has a passport linked to a "Passport renewal" routine in the demo.
    alex = next(p for p in state["people"] if p["name"] == "Alex")
    old = next(d for d in state["documents"] if d["subjectId"] == alex["id"] and d["type"] == "Passport" and not d["archived"])
    puts, summary = documents.new_id_document(state, "Alex", "Passport", expiry_date="2036-05-01", renewal_routine="passport renewal")
    archived = [p for p in puts if p["kind"] == "document" and p["id"] == old["id"]]
    assert archived and archived[0]["archived"] is True and archived[0]["pinned"] is False
    assert puts[0]["assignmentId"] == old["assignmentId"]
    assert not any(p["kind"] == "routine" for p in puts)
    assert summary["linkedRoutine"] == "Passport renewal"


def test_existing_same_type_requires_a_choice(state):
    with pytest.raises(ToolError) as e:
        documents.new_id_document(state, "Noa", "Passport", expiry_date="2034-01-01")
    msg = str(e.value)
    assert "already has an active passport" in msg and "renewal routine 'Passport renewal'" in msg
    assert "renewal_routine" in msg and "keep_both" in msg


def test_replacing_moves_routine_and_replans(state):
    noa = next(p for p in state["people"] if p["name"] == "Noa")
    old = next(d for d in state["documents"] if d["subjectId"] == noa["id"] and d["type"] == "Passport")
    a = next(x for x in state["assignments"] if x["id"] == old["assignmentId"])
    old_open = [t["id"] for t in state["tasks"] if t.get("assignmentId") == a["id"] and not t["done"]]
    new_expiry = (date.today() + timedelta(days=3650)).isoformat()
    puts, summary = documents.new_id_document(state, "Noa", "Passport", expiry_date=new_expiry, renewal_routine="Passport renewal")
    moved = next(p for p in puts if p["kind"] == "assignment")
    assert moved["id"] == a["id"] and moved["date"] == new_expiry
    assert {d["id"] for d in summary["_delete"]} == set(old_open)
    new_steps = [p for p in puts if p["kind"] == "task" and p["assignmentId"] == a["id"] and not p["done"]]
    assert sorted(t["date"] for t in new_steps) == sorted(
        (date.fromisoformat(new_expiry) - timedelta(days=n)).isoformat() for n in (210, 180)
    )
    assert any(p["kind"] == "document" and p["id"] == old["id"] and p["archived"] for p in puts)
    assert summary["routineMovedTo"] == new_expiry


def test_no_expiry_means_no_reminder(state):
    puts, summary = documents.new_id_document(state, "Maya", "Social Security card", id_number="123-45-6789")
    assert [p["kind"] for p in puts] == ["document"] and "needs an expiry" in summary["note"]


def test_remind_false(state):
    puts, _ = documents.new_id_document(state, "Maya", "visa", expiry_date="2030-01-01", remind=False)
    assert [p["kind"] for p in puts] == ["document"] and puts[0]["type"] == "Visa or residence card"


def test_health_document(state):
    puts, summary = documents.new_health_document(
        state, "alex", "Physio progress note", doc_type="visit", provider="kim", about="Knee range of motion improved",
        episode="knee INJURY",
    )
    doc = puts[0]
    assert doc["type"] == "Visit summary" and doc["episode"] == "Knee injury"
    assert summary["document"]["provider"] == "Dr. Paul Kim" and doc["date"] == date.today().isoformat()


def test_health_document_closes_file_task(state):
    # Make an open "Upload the lab results" task on Alex's lab routine, then file the result.
    alex = next(p for p in state["people"] if p["name"] == "Alex")
    routine = next(r for r in state["routines"] if r["title"] == "Recurring lab tests")
    a = next(x for x in state["assignments"] if x["routineId"] == routine["id"] and x["subjectId"] == alex["id"])
    state["tasks"].append(documents.make_task(title="Upload the lab results", assignmentId=a["id"],
                                              docTask={"docKind": "health", "docType": "Result"}))
    puts, summary = documents.new_health_document(state, "Alex", "Blood panel", doc_type="Result", routine="lab")
    assert summary["closedTasks"] == ["Upload the lab results"]
    assert puts[0]["assignmentId"] == a["id"]


@pytest.mark.parametrize(
    "call,msg",
    [
        (lambda s: documents.new_id_document(s, "Honda Civic", "Passport"), "is a car"),
        (lambda s: documents.new_id_document(s, "Nobody", "Passport"), "No person or car"),
        (lambda s: documents.new_id_document(s, "Alex", "Library card"), "Unknown ID type"),
        (lambda s: documents.new_id_document(s, "Alex", "Passport", expiry_date="May 1"), "Invalid date"),
        (lambda s: documents.new_id_document(s, "Alex", "Passport", renewal_routine="Dental"), "no identity routine"),
        (lambda s: documents.new_health_document(s, "Alex", "X", provider="Dr. Nobody"), "No contact"),
        (lambda s: documents.new_health_document(s, "Alex", "  "), "needs a name"),
    ],
)
def test_errors(state, call, msg):
    with pytest.raises(ToolError) as e:
        call(state)
    assert msg in str(e.value)


def test_records_pass_backend_validation(state):
    expiry = (date.today() + timedelta(days=500)).isoformat()
    puts1, _ = documents.new_id_document(state, "Noa", "City or state ID", expiry_date=expiry, details={"Full name": "Noa M"})
    puts2, _ = documents.new_health_document(state, "Noa", "Asthma review", doc_type="Visit summary", provider="Haddad")
    # Run the backend validation in a subprocess so its `src` package doesn't clash with ours.
    import subprocess
    payload = json.dumps(puts1 + puts2)
    code = (
        "import json,sys,os; os.environ.setdefault('DYNAMO_TABLE','x');"
        "from pydantic import TypeAdapter; from src.models import Entity;"
        "ta=TypeAdapter(Entity); [ta.validate_python(r) for r in json.loads(sys.stdin.read())]; print('ok')"
    )
    out = subprocess.run([sys.executable, "-c", code], input=payload, capture_output=True, text=True, cwd=ROOT / "backend")
    assert out.stdout.strip() == "ok", out.stderr[-2000:]


def test_tools_registered():
    from mcp.server.fastmcp import FastMCP
    from src.tools import register_tools

    mcp = FastMCP("coo-test")
    register_tools(mcp)
    names = {t.name for t in asyncio.run(mcp.list_tools())}
    assert {"add_id_document", "add_health_document"} <= names

"""add_document / list_document_types: requests built from the household
captured from the frontend (backend/tests/fixtures/frontend_state.json) and
the shared registry (backend/src/registry.json), then run through the
backend's own document rules and model validation."""

import asyncio
import json
import subprocess
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
REG = json.loads((ROOT / "backend/src/registry.json").read_text())


@pytest.fixture()
def state():
    ents = json.loads((ROOT / "backend/tests/fixtures/frontend_state.json").read_text())
    st = {v: [] for v in COLL.values()}
    for e in ents:
        st[COLL[e["kind"]]].append(e)
    return st


def build(state, subject, **kw):
    return documents.build_request(state, REG, subject, **kw)


def run_backend(state, body):
    """Apply a request with the backend's save_document and validate every record it writes."""
    code = (
        "import json,sys; from pydantic import TypeAdapter;"
        "from src import documents; from src.models import Entity;"
        "inp=json.loads(sys.stdin.read()); b=inp['body'];"
        "puts,dels,doc,summary=documents.save_document(inp['state'], b['document'], renewal=b.get('renewal'),"
        " duplicates=b.get('duplicates','allow'), today=b.get('today'));"
        "ta=TypeAdapter(Entity); [ta.validate_python(p) for p in puts];"
        "print(json.dumps({'document':doc,'summary':summary,'kinds':[p['kind'] for p in puts]}))"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], input=json.dumps({"state": state, "body": body}),
        capture_output=True, text=True, cwd=ROOT / "backend",
    )
    assert out.returncode == 0, out.stderr[-3000:]
    return json.loads(out.stdout)


# ── car ─────────────────────────────────────────────────────────────────────


def test_car_insurance_card(state):
    body, ctx = build(state, "yaris", name="GEICO insurance card", doc_type="insurance card", valid_until="2027-04-25")
    yaris = next(c for c in state["cars"] if c["makeModel"] == "Toyota Yaris")
    assert body["document"] == {
        "subjectType": "car", "subjectId": yaris["id"], "docKind": "car", "type": "ID card",
        "name": "GEICO insurance card", "validUntil": "2027-04-25",
    }
    assert "renewal" not in body and ctx["subject"] == "Toyota Yaris (LMN 7305)"
    got = run_backend(state, body)
    assert got["kinds"] == ["document"] and got["document"]["pinned"] is True


def test_car_by_plate_and_routine(state):
    body, ctx = build(state, "kdr 4821", name="Insurance card 2027", routine="insurance")
    assert body["document"]["docKind"] == "car" and ctx["routine"] == "Car insurance"
    got = run_backend(state, body)
    assert got["summary"]["archivedOlder"] == ["Insurance card"] and got["summary"]["linkedRoutine"] == "Car insurance"


def test_car_fields_outside_category_are_refused_by_the_api(state):
    body, _ = build(state, "Civic", name="Card", id_number="123")
    code = (
        "import json,sys; from src import documents;"
        "inp=json.loads(sys.stdin.read());"
        "\ntry:\n documents.save_document(inp['state'], inp['body']['document'])\n"
        "except documents.DocumentError as e:\n print(e)"
    )
    out = subprocess.run([sys.executable, "-c", code], input=json.dumps({"state": state, "body": body}),
                         capture_output=True, text=True, cwd=ROOT / "backend")
    assert "don't use: idNumber" in out.stdout, out.stderr


# ── people: category inference ──────────────────────────────────────────────


def test_person_category_from_type(state):
    assert build(state, "Maya", doc_type="passport")[0]["document"]["docKind"] == "identity"
    assert build(state, "Maya", name="Blood panel", doc_type="lab results")[0]["document"]["docKind"] == "health"
    with pytest.raises(ToolError, match="Say which kind of document"):
        build(state, "Maya", name="Thing", doc_type="Other")  # both categories have Other
    assert build(state, "Maya", name="Thing", category="Health", doc_type="Other")[0]["document"]["docKind"] == "health"


def test_category_must_fit_subject(state):
    with pytest.raises(ToolError, match="A car can hold: car"):
        build(state, "Civic", category="identity", doc_type="Passport")


# ── identity ────────────────────────────────────────────────────────────────


def test_passport_request_and_reminders(state):
    expiry = (date.today() + timedelta(days=400)).isoformat()
    body, _ = build(state, "Noa", doc_type="passport", id_number="X1234567", valid_until=expiry,
                    details={"nationality": "United States", "Hair": "Brown"}, pin=True, keep_both=True)
    doc = body["document"]
    assert doc["name"] == "Noa’s passport" and doc["pinned"] is True
    assert doc["details"] == [{"name": "Nationality", "value": "United States"}, {"name": "Hair", "value": "Brown"}]
    assert body["renewal"] == {} and body["duplicates"] == "allow"
    got = run_backend(state, body)
    steps = {s["title"]: s["date"] for s in got["summary"]["steps"]}
    assert steps["Submit passport renewal"] == (date.fromisoformat(expiry) - timedelta(days=180)).isoformat()
    assert got["summary"]["renewalRoutine"] == "Passport renewal"


def test_duplicate_id_is_refused_with_instructions(state):
    body, _ = build(state, "Noa", doc_type="Passport", valid_until="2034-01-01")
    assert body["duplicates"] == "reject"
    code = (
        "import json,sys; from src import documents;"
        "inp=json.loads(sys.stdin.read()); b=inp['body'];"
        "\ntry:\n documents.save_document(inp['state'], b['document'], renewal=b.get('renewal'), duplicates=b['duplicates'])\n"
        "except documents.Duplicate as e:\n print(json.dumps({'detail': str(e), 'existing': e.existing}))"
    )
    out = subprocess.run([sys.executable, "-c", code], input=json.dumps({"state": state, "body": body}),
                         capture_output=True, text=True, cwd=ROOT / "backend")
    err = json.loads(out.stdout)
    msg = documents.duplicate_message(err["detail"], err["existing"])
    assert "already has an active passport" in msg and "renewal routine 'Passport renewal'" in msg
    assert "`routine`" in msg and "keep_both" in msg


def test_replacing_via_routine_moves_it(state):
    new_expiry = (date.today() + timedelta(days=3650)).isoformat()
    body, _ = build(state, "Noa", doc_type="Passport", valid_until=new_expiry, routine="Passport renewal")
    assert "renewal" not in body and body["document"]["assignmentId"]
    got = run_backend(state, body)
    assert got["summary"]["routineMovedTo"] == new_expiry and got["summary"]["archivedOlder"]


def test_remind_false_and_remind_days(state):
    assert "renewal" not in build(state, "Maya", doc_type="visa", valid_until="2030-01-01", remind=False)[0]
    assert build(state, "Maya", doc_type="visa", valid_until="2030-01-01", remind_days=30)[0]["renewal"] == {"remindDays": 30}


# ── health ──────────────────────────────────────────────────────────────────


def test_health_document(state):
    body, ctx = build(state, "alex", name="Physio progress note", doc_type="visit", provider="kim",
                      about="Knee range of motion improved", episode="knee INJURY", on="2026-03-02")
    doc = body["document"]
    assert doc["docKind"] == "health" and doc["type"] == "Visit summary" and doc["episode"] == "Knee injury"
    assert doc["date"] == "2026-03-02" and ctx["provider"] == "Dr. Paul Kim" and "renewal" not in body
    got = run_backend(state, body)
    assert got["document"]["providerId"] == doc["providerId"]


# ── errors and registry view ────────────────────────────────────────────────


@pytest.mark.parametrize(
    "kw,msg",
    [
        ({"subject": "Nobody", "doc_type": "Passport"}, "Nothing matches"),
        ({"subject": "Alex", "doc_type": "Library card", "category": "identity"}, "Unknown identity document type"),
        ({"subject": "Alex", "doc_type": "Passport", "valid_until": "May 1"}, "Invalid date"),
        ({"subject": "Alex", "doc_type": "Passport", "routine": "Dental"}, "no identity routine"),
        ({"subject": "Alex", "name": "X", "category": "health", "provider": "Dr. Nobody"}, "No contact"),
        ({"subject": "Alex", "doc_type": "Passport", "remind_days": 5000}, "remind_days"),
    ],
)
def test_errors(state, kw, msg):
    with pytest.raises(ToolError) as e:
        documents.build_request(state, REG, **kw)
    assert msg in str(e.value)


def test_describe_registry():
    d = documents.describe_registry(REG)
    assert set(d) == set(REG["subjectTypes"])
    assert set(d["person"]["categories"]) == {"identity", "health"}
    car = d["car"]["categories"]["car"]
    assert car["parameters"] == ["valid_until"] and car["pin"] == "Keep in the glovebox (default on)"
    assert "Passport 180" in d["person"]["categories"]["identity"]["renewalReminders"]


def test_tools_registered():
    from mcp.server.fastmcp import FastMCP
    from src.tools import register_tools

    mcp = FastMCP("coo-test")
    register_tools(mcp)
    names = {t.name for t in asyncio.run(mcp.list_tools())}
    assert {"add_document", "list_document_types"} <= names
    assert not names & {"add_id_document", "add_health_document", "add_car_document"}


def test_add_document_tool_end_to_end(state, monkeypatch):
    """The tool resolves names, posts to the API, and turns a 409 into instructions."""
    from mcp.server.fastmcp import FastMCP
    from src import client
    from src.tools import register_tools

    sent = []

    async def get_state(token):
        return state

    async def get_registry(token):
        return REG

    async def save_document(token, body):
        sent.append(body)
        if body["document"]["docKind"] == "identity":
            raise client.ApiError("409", 409, "Noa already has an active passport",
                                  {"existing": [{"name": "Noa’s passport", "validUntil": "2029-05-04", "routine": "Passport renewal"}]})
        doc = {**body["document"], "id": "d_new", "pinned": True}
        return {"document": doc, "changes": {"put": [doc], "delete": []}, "summary": {}}

    monkeypatch.setattr(client, "get_state", get_state)
    monkeypatch.setattr(client, "get_registry", get_registry)
    monkeypatch.setattr(client, "save_document", save_document)
    mcp = FastMCP("coo-test")
    register_tools(mcp)

    out = asyncio.run(mcp.call_tool("add_document", {"subject": "Yaris", "name": "GEICO card", "type": "insurance card", "valid_until": "2027-04-25"}))
    text = out[0][0].text if isinstance(out, tuple) else out[0].text
    reply = json.loads(text)
    assert reply["document"]["subject"] == "Toyota Yaris (LMN 7305)" and reply["document"]["type"] == "ID card"
    assert sent[0]["document"]["docKind"] == "car"

    with pytest.raises(Exception) as e:
        asyncio.run(mcp.call_tool("add_document", {"subject": "Noa", "type": "Passport"}))
    assert "keep_both" in str(e.value) and "Passport renewal" in str(e.value)

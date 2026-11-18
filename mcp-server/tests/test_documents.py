"""add_document / list_document_types on data model v2: requests built from
the migrated household and the shared registry, run through the backend's
document rules, models and household checks."""

import asyncio
import json
from datetime import date, timedelta

import pytest

from src import documents
from src.logic import ToolError
from tests.conftest import REG, backend_error, run_backend


def build(state, subject, **kw):
    return documents.build_request(state, REG, subject, **kw)


def subject(state, name):
    return next(s for s in state["subjects"] if s["name"] == name)


# ── car ─────────────────────────────────────────────────────────────────────


def test_car_insurance_card(state):
    body, ctx = build(state, "yaris", name="GEICO insurance card", doc_type="insurance card", valid_until="2027-04-25")
    assert body["document"] == {
        "subjectId": subject(state, "Toyota Yaris")["id"], "category": "car", "type": "ID card",
        "title": "GEICO insurance card", "expiry": {"validUntil": "2027-04-25", "outdated": False},
    }
    assert "renewal" not in body and ctx["subject"] == "Toyota Yaris (LMN 7305)"
    got = run_backend(state, body)
    assert got["kinds"] == ["document"] and got["document"]["pinned"] is True


def test_car_by_plate_and_routine(state):
    body, ctx = build(state, "kdr 4821", name="Insurance card 2027", routine="insurance")
    assert body["document"]["category"] == "car" and ctx["routine"] == "Car insurance"
    got = run_backend(state, body)
    assert got["summary"]["archivedOlder"] == ["Insurance card"] and got["summary"]["linkedRoutine"] == "Car insurance"


def test_parameters_the_category_doesnt_use_are_refused(state):
    with pytest.raises(ToolError, match="Car documents don't use `id_number`"):
        build(state, "Civic", name="Card", id_number="123")
    with pytest.raises(ToolError, match="don't expire"):
        build(state, "Alex", name="Blood panel", category="health", valid_until="2030-01-01")


def test_files_on_a_trip(state):
    body, _ = build(state, "Lisbon", name="Itinerary")
    assert body["document"]["category"] == "attachment" and body["document"]["type"] == "File"
    assert run_backend(state, body)["document"]["subjectId"] == subject(state, "Lisbon and Sintra")["id"]


# ── people: category inference ──────────────────────────────────────────────


def test_person_category_from_type(state):
    assert build(state, "Maya", doc_type="passport")[0]["document"]["category"] == "identity"
    assert build(state, "Maya", name="Blood panel", doc_type="lab results")[0]["document"]["category"] == "health"
    with pytest.raises(ToolError, match="Say which kind of document"):
        build(state, "Maya", name="Thing", doc_type="Other")  # identity and health both have Other
    assert build(state, "Maya", name="Thing", category="Health", doc_type="Other")[0]["document"]["category"] == "health"
    assert build(state, "Maya", name="Scan", category="files")[0]["document"]["category"] == "attachment"


def test_category_must_fit_subject(state):
    with pytest.raises(ToolError, match="A car can hold: car"):
        build(state, "Civic", category="identity", doc_type="Passport")


# ── identity ────────────────────────────────────────────────────────────────


def test_passport_fields_details_and_reminders(state):
    expiry = (date.today() + timedelta(days=400)).isoformat()
    body, _ = build(state, "Noa", doc_type="passport", id_number="X1234567", issuer="U.S. Department of State",
                    valid_until=expiry, details={"nationality": "United States", "Hair": "Brown"}, pin=True, keep_both=True)
    doc = body["document"]
    assert doc["title"] == "Noa’s passport" and doc["pinned"] is True
    assert doc["fields"] == {"idNumber": "X1234567", "issuer": "U.S. Department of State", "nationality": "United States"}
    assert doc["customFields"] == [{"label": "Hair", "value": "Brown"}]
    assert body["renewal"] == {} and body["duplicates"] == "allow"
    got = run_backend(state, body)
    steps = {s["title"]: s["date"] for s in got["summary"]["steps"]}
    assert steps["Submit passport renewal"] == (date.fromisoformat(expiry) - timedelta(days=180)).isoformat()
    assert got["summary"]["renewalRoutine"] == "Passport renewal"


def test_duplicate_id_is_refused_with_instructions(state):
    body, _ = build(state, "Noa", doc_type="Passport", valid_until="2034-01-01")
    assert body["duplicates"] == "reject"
    err = backend_error(state, body)
    assert err["kind"] == "Duplicate"
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
    assert doc["category"] == "health" and doc["type"] == "Visit summary" and doc["date"] == "2026-03-02"
    assert doc["fields"]["episode"] == "Knee injury" and ctx["provider"] == "Dr. Paul Kim" and "renewal" not in body
    got = run_backend(state, body)
    assert got["document"]["fields"]["providerId"] == doc["fields"]["providerId"]


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
        ({"subject": "Lisbon", "name": "X", "routine": "anything"}, "aren't linked to routines"),
    ],
)
def test_errors(state, kw, msg):
    with pytest.raises(ToolError) as e:
        documents.build_request(state, REG, **kw)
    assert msg in str(e.value)


def test_describe_registry():
    d = documents.describe_registry(REG)
    assert set(d) == set(REG["subjectTypes"])
    assert set(d["person"]["categories"]) == {"identity", "health", "attachment"}
    car = d["car"]["categories"]["car"]
    assert car["parameters"] == ["date", "valid_until"] and car["pin"] == "Keep in the glovebox (default on)"
    ident = d["person"]["categories"]["identity"]
    assert "id_number" in ident["parameters"] and "Nationality" in ident["detailsPerType"]["Passport"]
    assert "Passport 180" in ident["renewalReminders"]
    assert d["car"]["attributes"] == ["Plate", "Odometer"]


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
        if body["document"]["category"] == "identity":
            raise client.ApiError("409", 409, "Noa already has an active passport",
                                  {"existing": [{"title": "Noa’s passport", "validUntil": "2029-05-04", "routine": "Passport renewal"}]})
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
    assert reply["document"]["subject"] == "Toyota Yaris (LMN 7305)" and reply["document"]["validUntil"] == "2027-04-25"
    assert sent[0]["document"]["category"] == "car"

    with pytest.raises(Exception) as e:
        asyncio.run(mcp.call_tool("add_document", {"subject": "Noa", "type": "Passport"}))
    assert "keep_both" in str(e.value) and "Passport renewal" in str(e.value)

"""add_subject, define_subject_type and delete_subject_type."""

import asyncio
import json

import pytest

from src import subjects
from src.logic import ToolError
from tests.conftest import REG, check_records

APARTMENT_RECORD = {
    "kind": "subjectType", "id": "apartment", "createdAt": "2026-11-01T00:00:00Z", "updatedAt": "2026-11-01T00:00:00Z",
    "archived": False, "label": "Apartment", "plural": "Apartments", "nameLabel": "Name", "namePlaceholder": "",
    "icon": "home", "allows": ["task", "document"], "documentCategories": ["attachment"], "routineAreas": [], "rules": [],
    "attributes": [
        {"key": "address", "label": "Address", "type": "longtext", "required": True},
        {"key": "rooms", "label": "Rooms", "type": "number", "integer": True},
        {"key": "kind", "label": "Kind", "type": "select", "options": ["Rented", "Owned"]},
        {"key": "landlord", "label": "Landlord", "type": "contact"},
        {"key": "tenants", "label": "Tenants", "type": "subjects", "subjectType": "person"},
    ],
}


def reg_with_apartment():
    info = {k: APARTMENT_RECORD[k] for k in ("label", "plural", "nameLabel", "namePlaceholder", "icon", "attributes",
                                             "allows", "documentCategories", "routineAreas", "rules")}
    return {**REG, "subjectTypes": {**REG["subjectTypes"], "apartment": {**info, "custom": True}}}


def test_subject_type_body_derives_keys():
    body = subjects.subject_type_body(
        REG, "Rental Apartment",
        attributes=[{"label": "Lease start", "type": "date"}, {"label": "Lease end", "type": "date"}, {"label": "Monthly rent", "type": "number"}],
        date_order=["Lease start", "lease end"],
    )
    assert body["key"] == "rental_apartment"
    assert [a["key"] for a in body["attributes"]] == ["leaseStart", "leaseEnd", "monthlyRent"]
    assert body["rules"] == [{"rule": "dateOrder", "fields": ["leaseStart", "leaseEnd"]}]


@pytest.mark.parametrize(
    "kw,msg",
    [
        ({"attributes": [{"label": "X", "type": "color"}]}, "Unknown attribute type"),
        ({"allows": ["pets"]}, "`allows` takes"),
        ({"document_categories": ["recipes"]}, "Unknown document categories"),
        ({"routine_areas": ["garden"]}, "Unknown routine areas"),
        ({"attributes": [{"type": "text"}]}, "needs a `label`"),
    ],
)
def test_subject_type_body_errors(kw, msg):
    with pytest.raises(ToolError, match=msg):
        subjects.subject_type_body(REG, "Apartment", **kw)


def test_new_subject_of_a_household_type(state):
    state["subjectTypes"] = [APARTMENT_RECORD]
    reg = reg_with_apartment()
    landlord = state["contacts"][0]["name"]
    rec = subjects.new_subject(state, reg, "Apartment", "Elm Street", {
        "Address": "12 Elm St", "rooms": "3", "Kind": "rented", "Landlord": landlord, "Tenants": ["Alex", "Maya"],
    })
    assert rec["subjectType"] == "apartment" and rec["attributes"]["rooms"] == 3 and rec["attributes"]["kind"] == "Rented"
    assert len(rec["attributes"]["tenants"]) == 2
    assert check_records(state, [rec]) == []


def test_new_built_in_subjects(state):
    car = subjects.new_subject(state, REG, "car", "Toyota RAV4", {"Plate": "RAV 4444", "Odometer": 12000})
    trip = subjects.new_subject(state, REG, "trip", "Ski week", {"Start": "2027-02-01", "End": "2027-02-07", "Travelers": "Alex, Noa"})
    assert car["attributes"] == {"plate": "RAV 4444", "odometer": 12000} and len(trip["attributes"]["travelers"]) == 2
    assert check_records(state, [car, trip]) == []


@pytest.mark.parametrize(
    "args,msg",
    [
        (("boat", "X", {}), "Unknown subject type"),
        (("car", "Civic 2", {"Odometer": 1}), "needs: Plate"),
        (("car", "Civic 2", {"Color": "red"}), "has no attribute 'Color'"),
        (("car", "Civic 2", {"Plate": "X1", "Odometer": "far"}), "must be a number"),
        (("trip", "T", {"Start": "May 1", "End": "2027-01-01"}), "Invalid date"),
        (("trip", "T", {"Start": "2027-01-01", "End": "2027-01-02", "Travelers": ["Zed"]}), "Nothing matches"),
        (("person", "  ", {}), "needs a name"),
    ],
)
def test_new_subject_errors(state, args, msg):
    with pytest.raises(ToolError, match=msg):
        subjects.new_subject(state, REG, *args)


def test_unique_plate_is_the_apis_job(state):
    # Name resolution is local; uniqueness is checked by the backend's household checks.
    dup = subjects.new_subject(state, REG, "car", "Another Civic", {"Plate": "KDR 4821"})
    assert any("already used" in e for e in check_records(state, [dup]))


def test_subject_tools(state, monkeypatch):
    from mcp.server.fastmcp import FastMCP
    from src import client
    from src.tools import register_tools

    calls = {}

    async def get_state(token):
        return state

    async def get_registry(token):
        return reg_with_apartment()

    async def batch(token, put=None, delete=None, expect=None):
        calls["batch"] = (put, expect)
        return {"ok": True}

    async def save_subject_type(token, body):
        calls["type"] = body
        return {"subjectType": {**APARTMENT_RECORD, **{k: v for k, v in body.items() if k != "key"}, "id": body["key"]}, "created": True}

    async def delete_subject_type(token, key):
        raise client.ApiError("400", 400, "subject type apartment is still referenced by subject s_1", {})

    for name, fn in [("get_state", get_state), ("get_registry", get_registry), ("batch", batch),
                     ("save_subject_type", save_subject_type), ("delete_subject_type", delete_subject_type)]:
        monkeypatch.setattr(client, name, fn)
    mcp = FastMCP("coo-test")
    register_tools(mcp)

    out = asyncio.run(mcp.call_tool("define_subject_type", {"label": "Apartment", "attributes": [{"label": "Address", "type": "longtext", "required": True}]}))
    text = out[0][0].text if isinstance(out, tuple) else out[0].text
    assert json.loads(text)["saved"] == "apartment" and calls["type"]["attributes"][0]["key"] == "address"

    asyncio.run(mcp.call_tool("add_subject", {"subject_type": "apartment", "name": "Elm", "attributes": {"Address": "12 Elm"}}))
    put, expect = calls["batch"]
    assert put[0]["subjectType"] == "apartment" and expect == [{"kind": "subject", "id": put[0]["id"], "updatedAt": None}]

    with pytest.raises(Exception, match="still referenced"):
        asyncio.run(mcp.call_tool("delete_subject_type", {"key": "apartment"}))

"""Household-defined subject types: POST/DELETE /api/subject-types, and that
every check treats them like built-in types."""

import pytest

from tests.samples import TS, samples
from tests.test_api import batch

APARTMENT = {
    "key": "apartment",
    "label": "Apartment",
    "nameLabel": "Address or nickname",
    "icon": "home",
    "attributes": [
        {"key": "address", "label": "Address", "type": "longtext", "required": True},
        {"key": "rooms", "label": "Rooms", "type": "number", "integer": True},
        {"key": "landlord", "label": "Landlord", "type": "contact"},
        {"key": "leaseStart", "label": "Lease start", "type": "date"},
        {"key": "leaseEnd", "label": "Lease end", "type": "date"},
        {"key": "tenants", "label": "Tenants", "type": "subjects", "subjectType": "person"},
    ],
    "rules": [{"rule": "dateOrder", "fields": ["leaseStart", "leaseEnd"]}],
}


def apartment(id_="ap_1", **attrs):
    return {"kind": "subject", "id": id_, "createdAt": TS, "updatedAt": TS, "archived": False,
            "subjectType": "apartment", "name": "Elm Street", "notes": "",
            "attributes": {"address": "12 Elm St", **attrs}}


@pytest.fixture()
def defined(client):
    res = client.post("/api/subject-types", json=APARTMENT)
    assert res.status_code == 200, res.text
    return res.json()["subjectType"]


def test_define_type_with_defaults(client, defined):
    assert defined["id"] == "apartment" and defined["plural"] == "Apartments"
    assert defined["allows"] == ["task", "document"] and defined["documentCategories"] == ["attachment"]
    reg = client.get("/api/registry").json()
    assert reg["subjectTypes"]["apartment"]["custom"] is True
    assert reg["subjectTypes"]["apartment"]["nameLabel"] == "Address or nickname"
    assert "person" in reg["subjectTypes"]
    assert client.get("/api/state").json()["subjectTypes"][0]["id"] == "apartment"


def test_subjects_of_the_type_follow_its_fields(client, sub, defined):
    r = samples(sub)
    assert batch(client, put=[r["person"], apartment(rooms=3, tenants=["p_ronen"])]).status_code == 200
    bad = [
        (apartment("ap_2", address=""), "address is required"),
        (apartment("ap_3", rooms=2.5), "rooms must be a whole number"),
        (apartment("ap_4", pool=True), "unknown field 'pool'"),
        (apartment("ap_5", leaseStart="2027-01-01", leaseEnd="2026-01-01"), "leaseEnd must be on or after leaseStart"),
        (apartment("ap_6", tenants=["ap_1"]), "must refer to a person"),
    ]
    for rec, msg in bad:
        res = batch(client, put=[rec])
        assert res.status_code == 400 and msg in res.text, (msg, res.text)


def test_what_the_type_allows(client, sub, defined):
    assert batch(client, put=[apartment()]).status_code == 200
    task = {"kind": "task", "id": "t_ap", "createdAt": TS, "updatedAt": TS, "archived": False, "subjectId": "ap_1",
            "parentId": None, "title": "Fix the faucet", "notes": "", "date": "2026-12-01", "order": 1, "done": False,
            "doneAt": None, "source": None, "appointment": None, "requestsDocument": None}
    assert batch(client, put=[task]).status_code == 200
    res = client.post("/api/documents", json={"document": {"subjectId": "ap_1", "category": "attachment", "title": "Lease"}})
    assert res.status_code == 200, res.text
    res = client.post("/api/documents", json={"document": {"subjectId": "ap_1", "category": "identity", "title": "Passport"}})
    assert res.status_code == 400 and "can't hold 'identity' documents" in res.text
    res_rec = {**samples(sub)["reservation"], "subjectId": "ap_1"}
    res = batch(client, put=[res_rec])
    assert res.status_code == 400 and "can't hold reservations" in res.text


def test_changing_the_type_rechecks_its_subjects(client, defined):
    assert batch(client, put=[apartment(rooms=3)]).status_code == 200
    without_rooms = {**APARTMENT, "attributes": [a for a in APARTMENT["attributes"] if a["key"] != "rooms"]}
    res = client.post("/api/subject-types", json=without_rooms)
    assert res.status_code == 400 and "unknown field 'rooms'" in res.text
    deprecated = {**APARTMENT, "attributes": [{**a, "deprecated": True} if a["key"] == "rooms" else a for a in APARTMENT["attributes"]]}
    assert client.post("/api/subject-types", json=deprecated).status_code == 200
    no_docs = {**APARTMENT, "allows": ["task"], "documentCategories": []}
    assert client.post("/api/subject-types", json=no_docs).status_code == 200


def test_delete_type(client, defined):
    assert batch(client, put=[apartment()]).status_code == 200
    res = client.delete("/api/subject-types/apartment")
    assert res.status_code == 400 and "still referenced by subject ap_1" in res.text
    assert batch(client, delete=[{"kind": "subject", "id": "ap_1"}]).status_code == 200
    assert client.delete("/api/subject-types/apartment").status_code == 200
    assert "apartment" not in client.get("/api/registry").json()["subjectTypes"]
    assert client.delete("/api/subject-types/apartment").status_code == 404


@pytest.mark.parametrize(
    "body,status,msg",
    [
        ({**APARTMENT, "key": "person"}, 400, "built-in subject type"),
        ({**APARTMENT, "key": "Bad Key"}, 422, "key"),
        ({**APARTMENT, "attributes": [{"key": "kind", "label": "Kind", "type": "select"}]}, 422, "needs options"),
        ({**APARTMENT, "attributes": [{"key": "a", "label": "A", "type": "text"}, {"key": "a", "label": "B", "type": "text"}], "rules": []}, 400, "unique"),
        ({**APARTMENT, "rules": [{"rule": "dateOrder", "fields": ["address", "leaseEnd"]}]}, 400, "needs date attributes"),
        ({**APARTMENT, "attributes": [{"key": "boat", "label": "Boat", "type": "subject", "subjectType": "boat"}], "rules": []}, 400, "unknown subject type 'boat'"),
        ({**APARTMENT, "routineAreas": ["health"]}, 400, "need 'assignment' in allows"),
        ({**APARTMENT, "allows": ["task"], "documentCategories": ["attachment"]}, 400, "need 'document' in allows"),
        ({**APARTMENT, "documentCategories": ["recipes"]}, 422, "unknown document category"),
    ],
)
def test_invalid_definitions(client, body, status, msg):
    res = client.post("/api/subject-types", json=body)
    assert res.status_code == status and msg in res.text, res.text


def test_types_are_per_household(client, defined):
    from src import registry
    from src.db import dynamo

    assert "apartment" not in registry.effective(dynamo.load_state("someone-else"))["subjectTypes"]
    # Outside a request, the built-in registry is unchanged.
    assert "apartment" not in registry.subject_types()

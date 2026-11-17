"""POST /api/documents and GET /api/registry, against the household captured
from the real frontend (tests/fixtures/frontend_state.json)."""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from tests.test_frontend_contract import FIXTURE, _rekey

ROOT = Path(__file__).resolve().parents[2]
TODAY = date.today().isoformat()


@pytest.fixture()
def household(client, sub):
    entities = _rekey(json.loads(FIXTURE.read_text()), sub)
    assert client.post("/api/batch", json={"put": entities, "delete": []}).status_code == 200
    yield client.get("/api/state").json()
    # Remove this user's rows: moto's transactions slow down as the shared table grows.
    left = client.get("/api/state").json()
    refs = [{"kind": e["kind"], "id": e["id"]} for coll in left.values() for e in coll]
    for i in range(0, len(refs), 400):
        client.post("/api/batch", json={"put": [], "delete": refs[i : i + 400]})


def save(client, document, **opts):
    return client.post("/api/documents", json={"document": document, **opts})


def person(st, name):
    return next(p for p in st["people"] if p["name"] == name)


def car(st, make_model):
    return next(c for c in st["cars"] if c["makeModel"] == make_model)


def routine_assignment(st, subject_id, title):
    r = next(r for r in st["routines"] if r["title"] == title)
    return next(a for a in st["assignments"] if a["routineId"] == r["id"] and a["subjectId"] == subject_id)


def days(n):
    return (date.today() + timedelta(days=n)).isoformat()


# ── registry ────────────────────────────────────────────────────────────────


def test_registry_endpoint_matches_source(client):
    got = client.get("/api/registry").json()
    assert got == json.loads((ROOT / "backend/src/registry.json").read_text())
    assert got["subjectTypes"]["car"]["categories"] == ["car"]


def test_frontend_registry_is_a_verbatim_copy():
    src = json.loads((ROOT / "backend/src/registry.json").read_text())
    copy = json.loads((ROOT / "frontend/src/lib/registry.json").read_text())
    assert copy == src, "Copy backend/src/registry.json to frontend/src/lib/registry.json"


def test_batch_rejects_document_kind_on_wrong_subject(client, household):
    doc = next(d for d in household["documents"] if d["docKind"] == "car")
    res = client.post("/api/batch", json={"put": [{**doc, "subjectType": "person", "subjectId": household["people"][0]["id"]}]})
    assert res.status_code == 422 and "can't hold 'car' documents" in res.text


def test_unknown_subject_type_rejected(client, household):
    res = save(client, {"subjectType": "boat", "subjectId": "x", "docKind": "car", "name": "Hull"})
    assert res.status_code == 422 and "unknown subject type" in res.text


# ── car ─────────────────────────────────────────────────────────────────────


def test_car_insurance_card(client, household):
    yaris = car(household, "Toyota Yaris")
    res = save(client, {"subjectType": "car", "subjectId": yaris["id"], "docKind": "car", "name": "GEICO insurance card", "validUntil": "2027-04-25"})
    assert res.status_code == 200, res.text
    body = res.json()
    doc = body["document"]
    assert doc["type"] == "ID card" and doc["pinned"] is True and doc["validUntil"] == "2027-04-25"
    assert [p["kind"] for p in body["changes"]["put"]] == ["document"]
    assert body["summary"]["document"]["subject"] == "Toyota Yaris"
    stored = next(d for d in client.get("/api/state").json()["documents"] if d["id"] == doc["id"])
    assert stored == doc


def test_car_document_on_routine_replaces_older_and_closes_task(client, household):
    civic = car(household, "Honda Civic")
    a = routine_assignment(household, civic["id"], "Car insurance")
    old = next(d for d in household["documents"] if d["assignmentId"] == a["id"] and d["type"] == "ID card")
    task = {
        "kind": "task", "id": "t_addcard", "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
        "title": "Add the new insurance card", "notes": "", "date": TODAY, "order": 1, "done": False, "doneAt": None,
        "subjectType": "car", "subjectId": civic["id"], "assignmentId": a["id"], "stepKind": "plain", "appointment": None,
        "tripId": None, "reservationId": None, "tripTask": None, "docTask": {"docKind": "car", "docType": "ID card"}, "subtasks": [],
    }
    client.post("/api/batch", json={"put": [task]})
    res = save(client, {"subjectType": "car", "subjectId": civic["id"], "docKind": "car", "name": "Insurance card 2027", "assignmentId": a["id"]})
    s = res.json()["summary"]
    assert s["archivedOlder"] == ["Insurance card"] and s["closedTasks"] == ["Add the new insurance card"]
    assert s["linkedRoutine"] == "Car insurance"
    st = client.get("/api/state").json()
    assert next(d for d in st["documents"] if d["id"] == old["id"])["archived"] is True
    assert next(t for t in st["tasks"] if t["id"] == "t_addcard")["done"] is True


def test_fields_outside_the_category_are_refused(client, household):
    civic = car(household, "Honda Civic")
    res = save(client, {"subjectType": "car", "subjectId": civic["id"], "docKind": "car", "name": "Card", "idNumber": "123"})
    assert res.status_code == 400 and "don't use: idNumber" in res.text


def test_category_must_fit_subject(client, household):
    civic = car(household, "Honda Civic")
    res = save(client, {"subjectType": "car", "subjectId": civic["id"], "docKind": "identity", "name": "Passport"})
    assert res.status_code == 400 and "can't hold 'identity' documents" in res.text


# ── identity ────────────────────────────────────────────────────────────────


def test_passport_with_renewal_reminders(client, household):
    noa = person(household, "Noa")
    expiry = days(400)
    res = save(client, {"subjectType": "person", "subjectId": noa["id"], "docKind": "identity", "name": "Noa’s second passport",
                        "type": "Passport", "validUntil": expiry}, renewal={})
    body = res.json()
    kinds = [p["kind"] for p in body["changes"]["put"]]
    assert sorted(kinds) == ["assignment", "document", "routine", "task", "task"]
    steps = {s["title"]: s["date"] for s in body["summary"]["steps"]}
    assert steps["Submit passport renewal"] == days(400 - 180)
    assert steps["Check renewal requirements and get a photo"] == days(400 - 210)
    assert body["document"]["assignmentId"] and body["document"]["pinned"] is False


def test_duplicate_reject_lists_current(client, household):
    noa = person(household, "Noa")
    res = save(client, {"subjectType": "person", "subjectId": noa["id"], "docKind": "identity", "name": "Passport", "type": "Passport"}, duplicates="reject")
    assert res.status_code == 409
    body = res.json()
    assert "already has an active passport" in body["detail"] and body["existing"][0]["routine"] == "Passport renewal"
    # The app's default is to allow it.
    assert save(client, {"subjectType": "person", "subjectId": noa["id"], "docKind": "identity", "name": "Passport", "type": "Passport"}).status_code == 200


def test_linking_new_id_replaces_and_replans(client, household):
    noa = person(household, "Noa")
    old = next(d for d in household["documents"] if d["subjectId"] == noa["id"] and d["type"] == "Passport")
    a = next(x for x in household["assignments"] if x["id"] == old["assignmentId"])
    old_open = {t["id"] for t in household["tasks"] if t.get("assignmentId") == a["id"] and not t["done"]}
    expiry = days(3650)
    body = save(client, {"subjectType": "person", "subjectId": noa["id"], "docKind": "identity", "name": "Noa’s passport",
                         "type": "Passport", "validUntil": expiry, "assignmentId": a["id"]}).json()
    assert body["summary"]["routineMovedTo"] == expiry and body["summary"]["archivedOlder"] == [old["name"]]
    assert old_open <= {d["id"] for d in body["changes"]["delete"]}
    st = client.get("/api/state").json()
    assert next(x for x in st["assignments"] if x["id"] == a["id"])["date"] == expiry
    fresh = sorted(t["date"] for t in st["tasks"] if t.get("assignmentId") == a["id"] and not t["done"])
    assert fresh == sorted([days(3650 - 210), days(3650 - 180)])


def test_editing_expiry_shifts_routine(client, household):
    alex = person(household, "Alex")
    doc = next(d for d in household["documents"] if d["subjectId"] == alex["id"] and d["type"] == "Passport" and not d["archived"])
    a = next(x for x in household["assignments"] if x["id"] == doc["assignmentId"])
    open_before = {t["id"]: t["date"] for t in household["tasks"] if t.get("assignmentId") == a["id"] and not t["done"] and t["date"] and not t["appointment"]}
    new_expiry = (date.fromisoformat(doc["validUntil"]) + timedelta(days=30)).isoformat()
    body = save(client, {"id": doc["id"], "validUntil": new_expiry}).json()
    assert body["document"]["validUntil"] == new_expiry and body["document"]["name"] == doc["name"]
    st = client.get("/api/state").json()
    assert next(x for x in st["assignments"] if x["id"] == a["id"])["date"] == (date.fromisoformat(a["date"]) + timedelta(days=30)).isoformat()
    for tid, d in open_before.items():
        assert next(t for t in st["tasks"] if t["id"] == tid)["date"] == (date.fromisoformat(d) + timedelta(days=30)).isoformat()


def test_update_keeps_unset_fields_and_can_clear(client, household):
    doc = next(d for d in household["documents"] if d["docKind"] == "identity" and d["idNumber"])
    body = save(client, {"id": doc["id"], "issuer": None, "pinned": True}).json()
    assert body["document"]["issuer"] == "" and body["document"]["idNumber"] == doc["idNumber"] and body["document"]["pinned"] is True
    assert save(client, {"id": doc["id"], "docKind": "health"}).status_code == 400


# ── health ──────────────────────────────────────────────────────────────────


def test_health_document_defaults_and_provider(client, household):
    alex = person(household, "Alex")
    kim = next(c for c in household["contacts"] if c["name"] == "Dr. Paul Kim")
    body = save(client, {"subjectType": "person", "subjectId": alex["id"], "docKind": "health", "name": "Physio note",
                         "providerId": kim["id"], "episode": "Knee injury"}, today="2026-03-04").json()
    d = body["document"]
    assert d["type"] == "Other" and d["date"] == "2026-03-04" and d["pinned"] is False and d["providerId"] == kim["id"]


def test_health_on_routine_does_not_archive(client, household):
    alex = person(household, "Alex")
    a = routine_assignment(household, alex["id"], "Recurring lab tests")
    first = save(client, {"subjectType": "person", "subjectId": alex["id"], "docKind": "health", "name": "Panel 1", "type": "Result", "assignmentId": a["id"]}).json()
    second = save(client, {"subjectType": "person", "subjectId": alex["id"], "docKind": "health", "name": "Panel 2", "type": "Result", "assignmentId": a["id"]}).json()
    assert "archivedOlder" not in second["summary"]
    st = client.get("/api/state").json()
    assert not next(d for d in st["documents"] if d["id"] == first["document"]["id"])["archived"]


# ── errors ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "make,status,msg",
    [
        (lambda st: {"subjectType": "person", "subjectId": "p_nobody", "docKind": "health", "name": "X"}, 404, "No person"),
        (lambda st: {"subjectType": "person", "subjectId": person(st, "Alex")["id"], "docKind": "health", "name": "  "}, 400, "needs a name"),
        (lambda st: {"subjectType": "person", "subjectId": person(st, "Alex")["id"], "docKind": "identity", "name": "X", "type": "Library card"}, 400, "Unknown identity document type"),
        (lambda st: {"subjectType": "person", "subjectId": person(st, "Alex")["id"], "docKind": "health", "name": "X", "assignmentId": routine_assignment(st, person(st, "Alex")["id"], "Passport renewal")["id"]}, 400, "Link a health routine"),
        (lambda st: {"subjectType": "person", "subjectId": person(st, "Maya")["id"], "docKind": "health", "name": "X", "assignmentId": routine_assignment(st, person(st, "Alex")["id"], "Recurring lab tests")["id"]}, 400, "isn't assigned to Maya"),
        (lambda st: {"subjectType": "person", "subjectId": person(st, "Alex")["id"], "docKind": "health", "name": "X", "providerId": "k_none"}, 404, "No contact"),
        (lambda st: {"subjectType": "person", "subjectId": person(st, "Alex")["id"], "docKind": "health", "name": "X", "file": {"key": "u/someone-else/x.pdf", "name": "x.pdf", "contentType": "application/pdf", "size": 1}}, 403, "outside your storage"),
        (lambda st: {"subjectType": "person", "docKind": "health", "name": "X"}, 400, "needs subjectId"),
    ],
)
def test_errors(client, household, make, status, msg):
    res = save(client, make(household))
    assert res.status_code == status and msg in res.text, res.text


def test_renewal_only_for_categories_with_it(client, household):
    civic = car(household, "Honda Civic")
    res = save(client, {"subjectType": "car", "subjectId": civic["id"], "docKind": "car", "name": "Card", "validUntil": days(100)}, renewal={})
    assert res.status_code == 400 and "don't have renewal reminders" in res.text


def test_app_shaped_requests(client, household):
    """What the app's forms send: every form field, nulls included, renewal null."""
    maya = person(household, "Maya")
    new = save(client, {"subjectType": "person", "subjectId": maya["id"], "docKind": "identity", "name": "Maya’s visa",
                        "type": "Visa or residence card", "idNumber": "", "issuer": "", "issueDate": None, "validUntil": None,
                        "details": [], "front": None, "back": None, "assignmentId": None, "pinned": False},
               renewal=None, today=TODAY)
    assert new.status_code == 200, new.text
    doc = new.json()["document"]
    edit = save(client, {**{k: doc[k] for k in ("id", "subjectType", "subjectId", "docKind", "name", "type", "idNumber",
                                                 "issuer", "issueDate", "details", "front", "back", "assignmentId", "pinned")},
                         "validUntil": "2030-02-01", "name": "Maya’s residence card"}, renewal=None, today=TODAY)
    assert edit.status_code == 200, edit.text
    assert edit.json()["document"]["validUntil"] == "2030-02-01" and edit.json()["summary"]["document"]["created"] is False

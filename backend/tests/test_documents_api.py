"""POST /api/documents and GET /api/registry (v2), against the household
captured from the real frontend, migrated to v2."""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from tests.test_frontend_contract import migrated_household

ROOT = Path(__file__).resolve().parents[2]
TODAY = date.today().isoformat()


@pytest.fixture()
def household(client, sub):
    assert client.post("/api/batch", json={"put": migrated_household(sub), "delete": []}).status_code == 200
    yield client.get("/api/state").json()
    # Remove this user's rows: moto's transactions slow down as the shared table grows.
    left = client.get("/api/state").json()
    refs = [{"kind": e["kind"], "id": e["id"]} for v in left.values() if isinstance(v, list) for e in v]
    # One batch: deleting part of the household would leave dangling references (refused).
    assert client.post("/api/batch", json={"put": [], "delete": refs}).status_code == 200


def save(client, document, **opts):
    return client.post("/api/documents", json={"document": document, **opts})


def subject(st, name):
    return next(s for s in st["subjects"] if s["name"] == name)


def routine_assignment(st, subject_id, title):
    r = next(r for r in st["routines"] if r["title"] == title)
    return next(a for a in st["assignments"] if a["routineId"] == r["id"] and a["subjectId"] == subject_id)


def days(n):
    return (date.today() + timedelta(days=n)).isoformat()


def state(client):
    return client.get("/api/state").json()


# ── registry ────────────────────────────────────────────────────────────────


def test_registry_endpoint_matches_source(client):
    got = client.get("/api/registry").json()
    assert got == json.loads((ROOT / "backend/src/registry.json").read_text())
    assert got["version"] == 2 and "trip" in got["subjectTypes"]


@pytest.mark.skip(reason="frontend/src/lib/registry.json is updated in the frontend v2 step")
def test_frontend_registry_is_a_verbatim_copy():
    src = json.loads((ROOT / "backend/src/registry.json").read_text())
    copy = json.loads((ROOT / "frontend/src/lib/registry.json").read_text())
    assert copy == src, "Copy backend/src/registry.json to frontend/src/lib/registry.json"


# ── car ─────────────────────────────────────────────────────────────────────


def test_car_insurance_card(client, household):
    yaris = subject(household, "Toyota Yaris")
    res = save(client, {"subjectId": yaris["id"], "category": "car", "title": "GEICO insurance card", "expiry": {"validUntil": "2027-04-25"}})
    assert res.status_code == 200, res.text
    body = res.json()
    doc = body["document"]
    assert doc["type"] == "ID card" and doc["pinned"] is True and doc["expiry"] == {"validUntil": "2027-04-25", "outdated": False}
    assert [p["kind"] for p in body["changes"]["put"]] == ["document"]
    assert body["summary"]["document"]["subject"] == "Toyota Yaris"
    assert next(d for d in state(client)["documents"] if d["id"] == doc["id"]) == doc


def test_car_document_on_routine_replaces_older_and_closes_task(client, household):
    civic = subject(household, "Honda Civic")
    a = routine_assignment(household, civic["id"], "Car insurance")
    old = next(d for d in household["documents"] if d["assignmentId"] == a["id"] and d["type"] == "ID card")
    task = {
        "kind": "task", "id": "t_addcard", "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
        "subjectId": civic["id"], "parentId": None, "title": "Add the new insurance card", "notes": "", "date": TODAY,
        "order": 1, "done": False, "doneAt": None, "source": {"kind": "assignment", "id": a["id"], "step": "plain"},
        "appointment": None, "requestsDocument": {"category": "car", "type": "ID card"},
    }
    assert client.post("/api/batch", json={"put": [task]}).status_code == 200
    s = save(client, {"subjectId": civic["id"], "category": "car", "title": "Insurance card 2027", "assignmentId": a["id"]}).json()["summary"]
    assert s["archivedOlder"] == ["Insurance card"] and s["closedTasks"] == ["Add the new insurance card"]
    st = state(client)
    assert next(d for d in st["documents"] if d["id"] == old["id"])["archived"] is True
    assert next(t for t in st["tasks"] if t["id"] == "t_addcard")["done"] is True


def test_household_checks_apply(client, household):
    civic = subject(household, "Honda Civic")
    res = save(client, {"subjectId": civic["id"], "category": "car", "title": "Card", "fields": {"idNumber": "123"}})
    assert res.status_code == 400 and "unknown field 'idNumber'" in res.text
    res = save(client, {"subjectId": civic["id"], "category": "identity", "title": "Passport"})
    assert res.status_code == 400 and "can't hold 'identity' documents" in res.text
    res = save(client, {"subjectId": civic["id"], "category": "car", "title": "Card", "type": "Warranty"})
    assert res.status_code == 400 and "isn't a car type" in res.text


def test_any_file_any_subject(client, household):
    trip = next(s for s in household["subjects"] if s["subjectType"] == "trip")
    res = save(client, {"subjectId": trip["id"], "category": "attachment", "title": "Visa letter"})
    assert res.status_code == 200 and res.json()["document"]["type"] == "File"


# ── identity ────────────────────────────────────────────────────────────────


def test_passport_with_renewal_reminders(client, household):
    noa = subject(household, "Noa")
    body = save(client, {"subjectId": noa["id"], "category": "identity", "title": "Noa’s second passport", "type": "Passport",
                         "expiry": {"validUntil": days(400)}, "fields": {"nationality": "Portugal", "idNumber": ""}}, renewal={}).json()
    assert sorted(p["kind"] for p in body["changes"]["put"]) == ["assignment", "document", "routine", "task", "task"]
    steps = {s["title"]: s["date"] for s in body["summary"]["steps"]}
    assert steps["Submit passport renewal"] == days(400 - 180)
    assert steps["Check renewal requirements and get a photo"] == days(400 - 210)
    doc = body["document"]
    assert doc["assignmentId"] and doc["pinned"] is False and doc["fields"] == {"nationality": "Portugal"}
    tasks = [p for p in body["changes"]["put"] if p["kind"] == "task"]
    assert all(t["source"] == {"kind": "assignment", "id": doc["assignmentId"], "step": t["source"]["step"]} for t in tasks)
    routine = next(p for p in body["changes"]["put"] if p["kind"] == "routine")
    assert routine["followUps"][0]["requestsDocument"] == {"category": "identity", "type": "Passport"}


def test_duplicate_reject_lists_current(client, household):
    noa = subject(household, "Noa")
    res = save(client, {"subjectId": noa["id"], "category": "identity", "title": "Passport", "type": "Passport"}, duplicates="reject")
    assert res.status_code == 409
    assert "already has an active passport" in res.json()["detail"] and res.json()["existing"][0]["routine"] == "Passport renewal"
    assert save(client, {"subjectId": noa["id"], "category": "identity", "title": "Passport", "type": "Passport"}).status_code == 200


def test_linking_new_id_replaces_and_replans(client, household):
    noa = subject(household, "Noa")
    old = next(d for d in household["documents"] if d["subjectId"] == noa["id"] and d["type"] == "Passport")
    a = next(x for x in household["assignments"] if x["id"] == old["assignmentId"])
    old_open = {t["id"] for t in household["tasks"] if (t.get("source") or {}).get("id") == a["id"] and not t["done"]}
    expiry = days(3650)
    body = save(client, {"subjectId": noa["id"], "category": "identity", "title": "Noa’s passport", "type": "Passport",
                         "expiry": {"validUntil": expiry}, "assignmentId": a["id"]}).json()
    assert body["summary"]["routineMovedTo"] == expiry and body["summary"]["archivedOlder"] == [old["title"]]
    assert old_open <= {d["id"] for d in body["changes"]["delete"]}
    st = state(client)
    assert next(x for x in st["assignments"] if x["id"] == a["id"])["date"] == expiry
    fresh = sorted(t["date"] for t in st["tasks"] if (t.get("source") or {}).get("id") == a["id"] and not t["done"])
    assert fresh == sorted([days(3650 - 210), days(3650 - 180)])


def test_editing_expiry_shifts_routine(client, household):
    alex = subject(household, "Alex")
    doc = next(d for d in household["documents"] if d["subjectId"] == alex["id"] and d["type"] == "Passport" and not d["archived"])
    a = next(x for x in household["assignments"] if x["id"] == doc["assignmentId"])
    open_before = {t["id"]: t["date"] for t in household["tasks"]
                   if (t.get("source") or {}).get("id") == a["id"] and not t["done"] and t["date"] and not t["appointment"]}
    new_expiry = (date.fromisoformat(doc["expiry"]["validUntil"]) + timedelta(days=30)).isoformat()
    body = save(client, {"id": doc["id"], "expiry": {"validUntil": new_expiry}}, expectUpdatedAt=doc["updatedAt"]).json()
    assert body["document"]["expiry"]["validUntil"] == new_expiry and body["document"]["title"] == doc["title"]
    st = state(client)
    assert next(x for x in st["assignments"] if x["id"] == a["id"])["date"] == (date.fromisoformat(a["date"]) + timedelta(days=30)).isoformat()
    for tid, d in open_before.items():
        assert next(t for t in st["tasks"] if t["id"] == tid)["date"] == (date.fromisoformat(d) + timedelta(days=30)).isoformat()


def test_stale_edit_is_409(client, household):
    doc = household["documents"][0]
    assert save(client, {"id": doc["id"], "pinned": True}, expectUpdatedAt="2000-01-01T00:00:00.000Z").status_code == 409


def test_update_keeps_unset_fields_and_rules_on_fixed(client, household):
    doc = next(d for d in household["documents"] if d["category"] == "identity" and d["fields"].get("idNumber"))
    body = save(client, {"id": doc["id"], "pinned": True}).json()
    assert body["document"]["fields"] == doc["fields"] and body["document"]["pinned"] is True
    assert save(client, {"id": doc["id"], "category": "health"}).status_code == 400
    cleared = save(client, {"id": doc["id"], "expiry": None}).json()["document"]
    assert cleared["expiry"] is None


# ── health ──────────────────────────────────────────────────────────────────


def test_health_document_defaults_and_provider(client, household):
    alex = subject(household, "Alex")
    kim = next(c for c in household["contacts"] if c["name"] == "Dr. Paul Kim")
    d = save(client, {"subjectId": alex["id"], "category": "health", "title": "Physio note",
                      "fields": {"providerId": kim["id"], "episode": "Knee injury"}}, today="2026-03-04").json()["document"]
    assert d["type"] == "Other" and d["date"] == "2026-03-04" and d["pinned"] is False and d["fields"]["providerId"] == kim["id"]


def test_health_on_routine_does_not_archive(client, household):
    alex = subject(household, "Alex")
    a = routine_assignment(household, alex["id"], "Recurring lab tests")
    first = save(client, {"subjectId": alex["id"], "category": "health", "title": "Panel 1", "type": "Result", "assignmentId": a["id"]}).json()
    second = save(client, {"subjectId": alex["id"], "category": "health", "title": "Panel 2", "type": "Result", "assignmentId": a["id"]}).json()
    assert "archivedOlder" not in second["summary"]
    assert not next(d for d in state(client)["documents"] if d["id"] == first["document"]["id"])["archived"]


# ── errors ──────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "make,status,msg",
    [
        (lambda st: {"subjectId": "p_nobody", "category": "health", "title": "X"}, 404, "No subject"),
        (lambda st: {"subjectId": subject(st, "Alex")["id"], "category": "health", "title": "  "}, 400, "needs a title"),
        (lambda st: {"subjectId": subject(st, "Alex")["id"], "category": "health", "title": "X",
                     "assignmentId": routine_assignment(st, subject(st, "Alex")["id"], "Passport renewal")["id"]}, 400, "link a health routine"),
        (lambda st: {"subjectId": subject(st, "Maya")["id"], "category": "health", "title": "X",
                     "assignmentId": routine_assignment(st, subject(st, "Alex")["id"], "Recurring lab tests")["id"]}, 400, "belongs to another subject"),
        (lambda st: {"subjectId": subject(st, "Alex")["id"], "category": "health", "title": "X", "fields": {"providerId": "k_none"}}, 400, "missing contact"),
        (lambda st: {"subjectId": subject(st, "Alex")["id"], "category": "health", "title": "X",
                     "files": [{"role": None, "file": {"key": "u/someone-else/x.pdf", "name": "x.pdf", "contentType": "application/pdf", "size": 1}}]}, 403, "outside your storage"),
        (lambda st: {"category": "health", "title": "X"}, 400, "needs subjectId"),
        (lambda st: {"subjectId": subject(st, "Alex")["id"], "category": "health", "title": "X", "expiry": {"validUntil": "2030-01-01"}}, 400, "don't expire"),
    ],
)
def test_errors(client, household, make, status, msg):
    res = save(client, make(household))
    assert res.status_code == status and msg in res.text, res.text


def test_renewal_only_for_categories_with_it(client, household):
    civic = subject(household, "Honda Civic")
    res = save(client, {"subjectId": civic["id"], "category": "car", "title": "Card", "expiry": {"validUntil": days(100)}}, renewal={})
    assert res.status_code == 400 and "don't have renewal reminders" in res.text

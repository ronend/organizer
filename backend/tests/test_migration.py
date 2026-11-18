"""Version 1 → 2 migration: the mapping (src/migration.py) on the household
captured from the real v1 frontend, and POST /api/migrate end to end."""

import json
import os

import boto3
import pytest

from src import integrity, migration
from tests.test_frontend_contract import FIXTURE, _rekey


@pytest.fixture()
def v1():
    return migration.group_v1(json.loads(FIXTURE.read_text()))


@pytest.fixture()
def v2(v1):
    records, report = migration.migrate(v1)
    return {(r["kind"], r["id"]): r for r in records}, report


def test_fixture_migrates_cleanly(v1):
    records, report = migration.migrate(v1)
    assert report["notes"] == []
    assert integrity.check_all(migration.to_state(records)) == []
    n_subtasks = sum(len(t.get("subtasks", [])) for t in v1["tasks"])
    n_files = sum(len(r.get("files", [])) for r in v1["reservations"])
    assert report["counts"]["subject"] == len(v1["people"]) + len(v1["cars"]) + len(v1["trips"])
    assert report["counts"]["task"] == len(v1["tasks"]) + n_subtasks
    assert report["counts"]["document"] == len(v1["documents"]) + n_files


def test_migration_is_deterministic(v1):
    a, _ = migration.migrate(v1)
    b, _ = migration.migrate(v1)
    assert [(r["kind"], r["id"]) for r in a] == [(r["kind"], r["id"]) for r in b]


def test_subjects(v1, v2):
    recs, _ = v2
    car = v1["cars"][0]
    s = recs[("subject", car["id"])]
    assert s["subjectType"] == "car" and s["name"] == car["makeModel"] and s["attributes"]["plate"] == car["plate"]
    trip = v1["trips"][0]
    t = recs[("subject", trip["id"])]
    assert t["attributes"]["start"] == trip["start"] and t["attributes"]["travelers"] == trip["travelers"]


def test_documents(v1, v2):
    recs, _ = v2
    passport = next(d for d in v1["documents"] if d["type"] == "Passport" and d["front"])
    got = recs[("document", passport["id"])]
    assert got["category"] == "identity" and got["title"] == passport["name"]
    assert [f["role"] for f in got["files"]][:1] == ["front"]
    assert got["fields"]["idNumber"] == passport["idNumber"]
    assert got["expiry"]["validUntil"] == passport["validUntil"]
    for row in passport["details"]:
        assert row["value"] in got["fields"].values() or row in [{"name": c["label"], "value": c["value"]} for c in got["customFields"]]
    health = next(d for d in v1["documents"] if d["docKind"] == "health" and d["providerId"])
    h = recs[("document", health["id"])]
    assert h["fields"]["providerId"] == health["providerId"] and h["expiry"] is None


def test_tasks_and_subtasks(v1, v2):
    recs, _ = v2
    step = next(t for t in v1["tasks"] if t["assignmentId"])
    got = recs[("task", step["id"])]
    assert got["source"] == {"kind": "assignment", "id": step["assignmentId"], "step": step["stepKind"]}
    booking = next(t for t in v1["tasks"] if t["reservationId"])
    b = recs[("task", booking["id"])]
    assert b["source"]["kind"] == "reservation" and b["subjectId"] == booking["tripId"]
    parent = next(t for t in v1["tasks"] if t["subtasks"])
    kids = [r for r in recs.values() if r["kind"] == "task" and r["parentId"] == parent["id"]]
    assert [k["title"] for k in sorted(kids, key=lambda k: k["order"])] == [s["title"] for s in parent["subtasks"]]
    assert all(k["subjectId"] == recs[("task", parent["id"])]["subjectId"] for k in kids)


def test_reservation_files_become_attachments(v1, v2):
    recs, _ = v2
    res = next(r for r in v1["reservations"] if r["files"])
    atts = [r for r in recs.values() if r["kind"] == "document" and (r.get("attachedTo") or {}).get("id") == res["id"]]
    assert [a["files"][0]["file"] for a in atts] == res["files"]
    assert all(a["category"] == "attachment" and a["subjectId"] == res["tripId"] for a in atts)


def test_contacts_get_tags_and_links(v1, v2):
    recs, _ = v2
    used = {a["contactId"]: a["subjectId"] for a in v1["assignments"] if a["contactId"]}
    cid, subject = next(iter(used.items()))
    c = recs[("contact", cid)]
    assert subject in [link["subjectId"] for link in c["links"]]
    assert c["tags"] == [next(x for x in v1["contacts"] if x["id"] == cid)["group"]]


def test_awkward_values_are_reported_not_dropped():
    v1 = migration.group_v1([
        {"kind": "person", "id": "p_1", "createdAt": "t", "updatedAt": "t", "name": "A", "birthYear": None},
        {"kind": "document", "id": "d_1", "createdAt": "t", "updatedAt": "t", "docKind": "health", "subjectType": "person",
         "subjectId": "p_1", "name": "", "type": "Other", "date": None, "validUntil": "2030-01-01", "idNumber": "X1",
         "issuer": "", "issueDate": None, "details": [{"name": "Lab", "value": "City"}], "front": None, "back": None,
         "providerId": None, "about": "", "episode": "", "file": None, "assignmentId": None, "pinned": False,
         "archived": True, "outdated": False},
    ])
    records, report = migration.migrate(v1)
    d = next(r for r in records if r["kind"] == "document")
    assert d["title"] == "Untitled" and d["archived"] is True and d["expiry"] is None
    assert {"label": "Valid until", "value": "2030-01-01"} in d["customFields"]
    assert {"label": "idNumber", "value": "X1"} in d["customFields"] and {"label": "Lab", "value": "City"} in d["customFields"]
    assert len(report["notes"]) == 2


# ── POST /api/migrate ───────────────────────────────────────────────────────


def _seed_v1(sub):
    from boto3.dynamodb.types import TypeSerializer
    from src.db.dynamo import _to_dynamo

    ser = TypeSerializer()
    ddb = boto3.client("dynamodb")
    for e in _rekey(json.loads(FIXTURE.read_text()), sub):
        item = {**_to_dynamo(e), "userId": sub, "SK": f"COO#{e['kind']}#{e['id']}"}
        ddb.put_item(TableName=os.environ["DYNAMO_TABLE"], Item={k: ser.serialize(v) for k, v in item.items()})


def test_migrate_endpoint(client, sub):
    _seed_v1(sub)
    assert client.get("/api/state").json()["needsMigration"] is True

    dry = client.post("/api/migrate", json={"dryRun": True}).json()
    assert dry["migrated"] is False and dry["errors"] == [] and dry["counts"]["subject"] == 8
    assert client.get("/api/state").json()["subjects"] == []

    res = client.post("/api/migrate", json={})
    assert res.status_code == 200 and res.json()["migrated"] is True
    state = client.get("/api/state").json()
    assert state["needsMigration"] is False and len(state["subjects"]) == 8
    assert sum(len(v) for k, v in state.items() if isinstance(v, list)) == sum(dry["counts"].values())

    # The v1 rows are untouched (rollback), and a second run is refused.
    resp = boto3.client("dynamodb").query(
        TableName=os.environ["DYNAMO_TABLE"], KeyConditionExpression="userId = :u AND begins_with(SK, :p)",
        ExpressionAttributeValues={":u": {"S": sub}, ":p": {"S": "COO#"}}, Select="COUNT")
    assert resp["Count"] == len(json.loads(FIXTURE.read_text()))
    assert client.post("/api/migrate", json={}).status_code == 409


def test_migrate_with_nothing_to_migrate(client):
    res = client.post("/api/migrate", json={})
    assert res.status_code == 200 and res.json()["counts"] == {} and res.json()["migrated"] is False

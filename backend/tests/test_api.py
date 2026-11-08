import os

import boto3

from tests.samples import TS, samples

STATE_KEYS = {
    "person": "people",
    "car": "cars",
    "contact": "contacts",
    "routine": "routines",
    "assignment": "assignments",
    "task": "tasks",
    "document": "documents",
    "trip": "trips",
    "reservation": "reservations",
}


def batch(client, put=(), delete=()):
    return client.post("/api/batch", json={"put": list(put), "delete": list(delete)})


# ── gating ──────────────────────────────────────────────────────────────────


def test_origin_verify_required(client):
    resp = client.get("/api/state", headers={"x-origin-verify": "wrong"})
    assert resp.status_code == 403


def test_auth_required_without_override():
    from fastapi.testclient import TestClient

    from src.app import app

    with TestClient(app, headers={"x-origin-verify": os.environ["ORIGIN_SECRET"]}) as c:
        assert c.get("/api/state").status_code == 401
        assert c.post("/api/batch", json={"put": [], "delete": []}).status_code == 401
        assert c.post("/api/files/urls", json={"keys": []}).status_code == 401


# ── state + batch ───────────────────────────────────────────────────────────


def test_empty_state(client):
    resp = client.get("/api/state")
    assert resp.status_code == 200
    assert resp.json() == {k: [] for k in STATE_KEYS.values()}


def test_roundtrip_every_kind(client, sub):
    recs = samples(sub)
    resp = batch(client, put=recs.values())
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ok"] is True
    stamp = body["updatedAt"]
    assert stamp.endswith("Z") and stamp != TS

    state = client.get("/api/state").json()
    for kind, rec in recs.items():
        coll = state[STATE_KEYS[kind]]
        assert len(coll) == 1, kind
        got = coll[0]
        assert got["updatedAt"] == stamp  # server-stamped
        assert got["createdAt"] == TS  # client's createdAt kept
        assert {**got, "updatedAt": TS} == rec, kind

    # Number types survive the Decimal round trip.
    assert state["cars"][0]["odometer"] == 45210.5
    assert isinstance(state["tasks"][0]["order"], int)
    assert state["assignments"][0]["supply"]["perDay"] == 0.5


def test_upsert_overwrites(client, sub):
    person = samples(sub)["person"]
    batch(client, put=[person])
    batch(client, put=[{**person, "name": "Ronen D."}])
    people = client.get("/api/state").json()["people"]
    assert [p["name"] for p in people] == ["Ronen D."]


def test_delete(client, sub):
    recs = samples(sub)
    batch(client, put=[recs["person"], recs["car"]])
    resp = batch(client, delete=[{"kind": "car", "id": "c_1"}, {"kind": "task", "id": "nope"}])
    assert resp.status_code == 200
    state = client.get("/api/state").json()
    assert state["cars"] == []
    assert len(state["people"]) == 1


def test_users_are_isolated(client, sub):
    batch(client, put=[samples(sub)["person"]])
    from src.db import dynamo

    assert dynamo.load_state("someone-else")["people"] == []


def test_put_and_delete_same_key_is_400(client, sub):
    person = samples(sub)["person"]
    resp = batch(client, put=[person], delete=[{"kind": "person", "id": person["id"]}])
    assert resp.status_code == 400
    assert client.get("/api/state").json()["people"] == []


def test_duplicate_put_is_400(client, sub):
    person = samples(sub)["person"]
    assert batch(client, put=[person, person]).status_code == 400


def test_large_batch_is_chunked(client, sub):
    person = samples(sub)["person"]
    people = [{**person, "id": f"p_{i}", "name": f"P{i}"} for i in range(250)]
    assert batch(client, put=people).status_code == 200
    assert len(client.get("/api/state").json()["people"]) == 250


def test_too_many_operations(client, sub):
    person = samples(sub)["person"]
    people = [{**person, "id": f"p_{i}"} for i in range(501)]
    assert batch(client, put=people).status_code == 400


def test_validation_errors(client, sub):
    recs = samples(sub)
    bad = [
        {**recs["person"], "nickname": "x"},  # extra field
        {**recs["person"], "kind": "pet"},  # unknown kind
        {k: v for k, v in recs["task"].items() if k != "stepKind"},  # missing field
        {**recs["task"], "date": "01/12/2026"},  # bad ISODate
        {**recs["task"], "stepKind": "magic"},  # bad enum
        {**recs["reservation"], "start": "2027-04-01 06:30"},  # bad LocalDateTime
        {**recs["trip"], "end": "2027-03-01"},  # end before start
        {**recs["reservation"], "end": "2027-04-01T05:00"},  # end before start
        {**recs["person"], "id": "has space"},  # bad id
        {**recs["person"], "name": "x" * 301},  # too long
        {**recs["routine"], "plan": [{"title": "x", "offsetDays": 0, "kind": "plain", "prep": "", "docTask": None, "extra": 1}]},
    ]
    for rec in bad:
        resp = batch(client, put=[rec])
        assert resp.status_code == 422, rec
    assert batch(client, delete=[{"kind": "pet", "id": "x"}]).status_code == 422
    assert client.post("/api/batch", json={"put": [], "delete": [], "x": 1}).status_code == 422
    assert client.get("/api/state").json() == {k: [] for k in STATE_KEYS.values()}


def test_file_key_outside_prefix_is_403(client, sub):
    recs = samples(sub)
    foreign = {**recs["document"]["front"], "key": "u/someone-else/abc/x.pdf"}
    resp = batch(client, put=[{**recs["document"], "back": foreign}])
    assert resp.status_code == 403
    resp = batch(client, put=[{**recs["reservation"], "files": [foreign]}])
    assert resp.status_code == 403
    # A key that merely starts with the sub but not the full prefix.
    sneaky = {**foreign, "key": f"u/{sub}-x/abc/x.pdf"}
    assert batch(client, put=[{**recs["document"], "file": sneaky}]).status_code == 403


def test_legacy_rows_ignored(client, sub):
    ddb = boto3.client("dynamodb")
    table = os.environ["DYNAMO_TABLE"]
    for sk in ("ITEM#todo_abc", "REMIDX#2026-01-01T00:00:00Z#todo_abc"):
        ddb.put_item(
            TableName=table,
            Item={"userId": {"S": sub}, "SK": {"S": sk}, "type": {"S": "todo"}, "title": {"S": "old"}},
        )
    assert client.get("/api/state").json() == {k: [] for k in STATE_KEYS.values()}
    batch(client, put=[samples(sub)["person"]])
    # Legacy rows are still there, untouched.
    resp = ddb.query(
        TableName=table,
        KeyConditionExpression="userId = :u",
        ExpressionAttributeValues={":u": {"S": sub}},
    )
    sks = sorted(i["SK"]["S"] for i in resp["Items"])
    assert sks == ["COO#person#p_ronen", "ITEM#todo_abc", "REMIDX#2026-01-01T00:00:00Z#todo_abc"]


# ── files ───────────────────────────────────────────────────────────────────


def test_upload_url_shape(client, sub):
    resp = client.post(
        "/api/files/upload-url",
        json={"name": "My Passport (scan).pdf", "contentType": "application/pdf", "size": 2048},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    f = body["file"]
    assert set(f) == {"key", "name", "contentType", "size"}
    assert f["key"].startswith(f"u/{sub}/")
    assert f["key"].endswith("/My_Passport_scan_.pdf")
    assert len(f["key"].split("/")) == 4
    assert f["name"] == "My Passport (scan).pdf"
    assert f["contentType"] == "application/pdf"
    assert f["size"] == 2048
    url = body["uploadUrl"]
    assert url.startswith(f"https://{os.environ['FILES_BUCKET']}.s3.us-east-1.amazonaws.com/u/")
    assert "X-Amz-Signature=" in url and "X-Amz-Expires=900" in url
    assert "content-type" in url.lower()  # Content-Type is a signed header


def test_upload_url_defaults_and_limits(client):
    resp = client.post("/api/files/upload-url", json={"name": "../../etc/passwd", "contentType": "", "size": 1})
    assert resp.status_code == 200
    f = resp.json()["file"]
    assert f["contentType"] == "application/octet-stream"
    assert f["key"].endswith("/passwd") and ".." not in f["key"]

    too_big = {"name": "a.bin", "contentType": "application/octet-stream", "size": 20 * 1024 * 1024 + 1}
    assert client.post("/api/files/upload-url", json=too_big).status_code == 400
    bad_type = {"name": "a.bin", "contentType": "not a type", "size": 1}
    assert client.post("/api/files/upload-url", json=bad_type).status_code == 400
    assert client.post("/api/files/upload-url", json={"name": "a", "size": -1}).status_code == 422


def test_download_urls(client, sub):
    keys = [f"u/{sub}/a/x.pdf", f"u/{sub}/b/y.png"]
    resp = client.post("/api/files/urls", json={"keys": keys})
    assert resp.status_code == 200
    urls = resp.json()["urls"]
    assert set(urls) == set(keys)
    assert all("X-Amz-Expires=3600" in u for u in urls.values())


def test_download_urls_foreign_key_is_403(client, sub):
    resp = client.post("/api/files/urls", json={"keys": [f"u/{sub}/a/x.pdf", "u/other/a/x.pdf"]})
    assert resp.status_code == 403
    assert client.post("/api/files/urls", json={"keys": ["x"] * 101}).status_code == 422

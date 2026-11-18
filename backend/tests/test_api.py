import os

import boto3

from tests.samples import TS, samples

STATE_KEYS = {
    "subject": "subjects", "task": "tasks", "document": "documents", "reservation": "reservations",
    "routine": "routines", "assignment": "assignments", "contact": "contacts", "subjectType": "subjectTypes",
}
EMPTY = {"schemaVersion": 2, **{k: [] for k in STATE_KEYS.values()}, "needsMigration": False}


def batch(client, put=(), delete=(), expect=()):
    return client.post("/api/batch", json={"put": list(put), "delete": list(delete), "expect": list(expect)})


def ref(rec):
    return {"kind": rec["kind"], "id": rec["id"]}


# ── gating ──────────────────────────────────────────────────────────────────


def test_origin_verify_required(client):
    assert client.get("/api/state", headers={"x-origin-verify": "wrong"}).status_code == 403


def test_auth_required_without_override():
    from fastapi.testclient import TestClient

    from src.app import app

    with TestClient(app, headers={"x-origin-verify": os.environ["ORIGIN_SECRET"]}) as c:
        assert c.get("/api/state").status_code == 401
        assert c.post("/api/batch", json={"put": [], "delete": []}).status_code == 401
        assert c.post("/api/files/urls", json={"keys": []}).status_code == 401
        assert c.post("/api/migrate", json={}).status_code == 401


# ── state + batch ───────────────────────────────────────────────────────────


def test_empty_state(client):
    resp = client.get("/api/state")
    assert resp.status_code == 200
    assert resp.json() == EMPTY


def test_roundtrip_every_kind(client, sub):
    recs = samples(sub)
    resp = batch(client, put=recs.values())
    assert resp.status_code == 200, resp.text
    stamp = resp.json()["updatedAt"]
    assert stamp.endswith("Z") and stamp != TS

    state = client.get("/api/state").json()
    for name, rec in recs.items():
        got = next(x for x in state[STATE_KEYS[rec["kind"]]] if x["id"] == rec["id"])
        assert got["updatedAt"] == stamp and got["createdAt"] == TS, name
        assert {**got, "updatedAt": TS} == rec, name

    # Number types survive the Decimal round trip.
    car = next(s for s in state["subjects"] if s["id"] == "c_1")
    assert car["attributes"]["odometer"] == 45210.5
    assert isinstance(next(t for t in state["tasks"] if t["id"] == "t_1")["order"], int)
    assert state["assignments"][0]["supply"]["perDay"] == 0.5


def test_defaults_fill_optional_fields(client, sub):
    person = {"kind": "subject", "id": "p_x", "createdAt": TS, "updatedAt": TS, "subjectType": "person", "name": "X"}
    assert batch(client, put=[person]).status_code == 200
    got = client.get("/api/state").json()["subjects"][0]
    assert got["archived"] is False and got["attributes"] == {} and got["notes"] == ""


def test_upsert_overwrites(client, sub):
    person = samples(sub)["person"]
    batch(client, put=[person])
    batch(client, put=[{**person, "name": "Ronen D."}])
    assert [p["name"] for p in client.get("/api/state").json()["subjects"]] == ["Ronen D."]


def test_delete(client, sub):
    recs = samples(sub)
    batch(client, put=[recs["person"], recs["car"]])
    assert batch(client, delete=[ref(recs["car"]), {"kind": "task", "id": "nope"}]).status_code == 200
    assert [s["id"] for s in client.get("/api/state").json()["subjects"]] == ["p_ronen"]


def test_users_are_isolated(client, sub):
    batch(client, put=[samples(sub)["person"]])
    from src.db import dynamo

    assert dynamo.load_state("someone-else")["subjects"] == []


def test_put_and_delete_same_key_is_400(client, sub):
    person = samples(sub)["person"]
    assert batch(client, put=[person], delete=[ref(person)]).status_code == 400
    assert client.get("/api/state").json()["subjects"] == []


def test_duplicate_put_is_400(client, sub):
    person = samples(sub)["person"]
    assert batch(client, put=[person, person]).status_code == 400


def test_large_batch_is_chunked(client, sub):
    person = samples(sub)["person"]
    people = [{**person, "id": f"p_{i}", "name": f"P{i}"} for i in range(250)]
    assert batch(client, put=people).status_code == 200
    assert len(client.get("/api/state").json()["subjects"]) == 250


def test_too_many_operations(client, sub):
    person = samples(sub)["person"]
    assert batch(client, put=[{**person, "id": f"p_{i}"} for i in range(501)]).status_code == 400


def test_shape_errors_are_422(client, sub):
    r = samples(sub)
    bad = [
        {**r["person"], "nickname": "x"},                       # extra field
        {**r["person"], "kind": "pet"},                         # unknown kind
        {**r["person"], "subjectType": "Boat!"},                # malformed subject type key
        {k: v for k, v in r["task"].items() if k != "order"},   # missing field
        {**r["task"], "date": "01/12/2026"},                    # bad ISODate
        {**r["task"], "source": {"kind": "assignment", "id": "a_1", "step": "magic"}},
        {**r["subtask"], "source": {"kind": "assignment", "id": "a_1", "step": "plain"}},  # subtask with a source
        {**r["subtask"], "parentId": "t_2"},                    # own parent
        {**r["reservation"], "start": "2027-04-01 06:30"},      # bad LocalDateTime
        {**r["reservation"], "end": "2027-04-01T05:00"},        # end before start
        {**r["reservation"], "type": "cruise"},                 # unknown reservation type
        {**r["document"], "category": "recipes"},               # unknown category
        {**r["document"], "fields": {"bad key": "x"}},          # field key pattern
        {**r["document"], "fields": {"x": {"nested": 1}}},      # field value shape
        {**r["person"], "id": "has space"},
        {**r["person"], "name": ""},
        {**r["routine"], "area": "garden"},
    ]
    for rec in bad:
        assert batch(client, put=[rec]).status_code == 422, rec
    assert batch(client, delete=[{"kind": "pet", "id": "x"}]).status_code == 422
    assert client.post("/api/batch", json={"put": [], "delete": [], "x": 1}).status_code == 422
    assert client.get("/api/state").json() == EMPTY


def test_file_key_outside_prefix_is_403(client, sub):
    r = samples(sub)
    foreign = {**r["document"]["files"][0]["file"], "key": "u/someone-else/abc/x.pdf"}
    doc = {**r["document"], "files": [{"role": "back", "file": foreign}]}
    assert batch(client, put=[doc]).status_code == 403
    sneaky = {**foreign, "key": f"u/{sub}-x/abc/x.pdf"}
    assert batch(client, put=[{**r["attachment"], "files": [{"role": None, "file": sneaky}]}]).status_code == 403


def test_old_rows_ignored(client, sub):
    ddb = boto3.client("dynamodb")
    table = os.environ["DYNAMO_TABLE"]
    for sk in ("ITEM#todo_abc", "COO#person#p_old"):
        ddb.put_item(TableName=table, Item={"userId": {"S": sub}, "SK": {"S": sk}, "kind": {"S": "person"}, "id": {"S": "p_old"}})
    state = client.get("/api/state").json()
    assert state["subjects"] == [] and state["needsMigration"] is True
    batch(client, put=[samples(sub)["person"]])
    assert client.get("/api/state").json()["needsMigration"] is False
    resp = ddb.query(TableName=table, KeyConditionExpression="userId = :u", ExpressionAttributeValues={":u": {"S": sub}})
    assert sorted(i["SK"]["S"] for i in resp["Items"]) == ["COO#person#p_old", "ITEM#todo_abc", "V2#subject#p_ronen"]


# ── optimistic concurrency ──────────────────────────────────────────────────


def test_expect_updated_at(client, sub):
    person = samples(sub)["person"]
    stamp = batch(client, put=[person], expect=[{"kind": "subject", "id": "p_ronen", "updatedAt": None}]).json()["updatedAt"]
    # Creating it again with "must not exist" fails.
    assert batch(client, put=[person], expect=[{"kind": "subject", "id": "p_ronen", "updatedAt": None}]).status_code == 409
    # A write based on a stale read fails; one based on the current stamp works.
    assert batch(client, put=[{**person, "name": "A"}], expect=[{"kind": "subject", "id": "p_ronen", "updatedAt": TS}]).status_code == 409
    assert batch(client, put=[{**person, "name": "B"}], expect=[{"kind": "subject", "id": "p_ronen", "updatedAt": stamp}]).status_code == 200
    assert client.get("/api/state").json()["subjects"][0]["name"] == "B"


def test_expect_on_unwritten_record_is_a_check(client, sub):
    r = samples(sub)
    batch(client, put=[r["person"]])
    car = r["car"]
    # The write of the car depends on the person being unchanged.
    res = batch(client, put=[car], expect=[{"kind": "subject", "id": "p_ronen", "updatedAt": TS}])
    assert res.status_code == 409
    assert [s["id"] for s in client.get("/api/state").json()["subjects"]] == ["p_ronen"]


# ── files ───────────────────────────────────────────────────────────────────


def test_upload_url_shape(client, sub):
    resp = client.post("/api/files/upload-url", json={"name": "My Passport (scan).pdf", "contentType": "application/pdf", "size": 2048})
    assert resp.status_code == 200, resp.text
    f = resp.json()["file"]
    assert set(f) == {"key", "name", "contentType", "size"}
    assert f["key"].startswith(f"u/{sub}/") and f["key"].endswith("/My_Passport_scan_.pdf") and len(f["key"].split("/")) == 4
    assert f["name"] == "My Passport (scan).pdf" and f["contentType"] == "application/pdf" and f["size"] == 2048
    url = resp.json()["uploadUrl"]
    assert url.startswith(f"https://{os.environ['FILES_BUCKET']}.s3.us-east-1.amazonaws.com/u/")
    assert "X-Amz-Signature=" in url and "X-Amz-Expires=900" in url and "content-type" in url.lower()


def test_upload_url_defaults_and_limits(client):
    resp = client.post("/api/files/upload-url", json={"name": "../../etc/passwd", "contentType": "", "size": 1})
    f = resp.json()["file"]
    assert f["contentType"] == "application/octet-stream" and f["key"].endswith("/passwd") and ".." not in f["key"]
    too_big = {"name": "a.bin", "contentType": "application/octet-stream", "size": 20 * 1024 * 1024 + 1}
    assert client.post("/api/files/upload-url", json=too_big).status_code == 400
    assert client.post("/api/files/upload-url", json={"name": "a.bin", "contentType": "not a type", "size": 1}).status_code == 400
    assert client.post("/api/files/upload-url", json={"name": "a", "size": -1}).status_code == 422


def test_download_urls(client, sub):
    keys = [f"u/{sub}/a/x.pdf", f"u/{sub}/b/y.png"]
    urls = client.post("/api/files/urls", json={"keys": keys}).json()["urls"]
    assert set(urls) == set(keys) and all("X-Amz-Expires=3600" in u for u in urls.values())


def test_download_urls_foreign_key_is_403(client, sub):
    assert client.post("/api/files/urls", json={"keys": [f"u/{sub}/a/x.pdf", "u/other/a/x.pdf"]}).status_code == 403
    assert client.post("/api/files/urls", json={"keys": ["x"] * 101}).status_code == 422

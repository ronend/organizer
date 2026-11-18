"""Contract tests: households produced by the real frontend must round-trip
through POST /api/batch (with every household check) and GET /api/state
unchanged, apart from the server-set updatedAt.

- tests/fixtures/frontend_state_v2.json — captured from the v2 frontend's
  in-browser mock (localStorage ``coo.mock.v2.state``) after the demo
  household plus edits: a new ID with renewal reminders, a task with
  subtasks (one ticked), a deleted reservation and a deleted person.
  Regenerate it when frontend/src/types/coo.ts changes.
- tests/fixtures/frontend_state.json — the version 1 household, migrated
  (also the input of the migration tests).
"""

import json
from pathlib import Path

from src import migration

FIXTURE = Path(__file__).parent / "fixtures" / "frontend_state.json"
FIXTURE_V2 = Path(__file__).parent / "fixtures" / "frontend_state_v2.json"


def _rekey(entities, sub):
    """Mock file keys live under u/mock/; move them under the caller's prefix."""
    raw = json.dumps(entities).replace('"u/mock/', f'"u/{sub}/')
    return json.loads(raw)


def migrated_household(sub):
    records, _ = migration.migrate(migration.group_v1(_rekey(json.loads(FIXTURE.read_text()), sub)))
    return records


def test_frontend_household_roundtrips(client, sub):
    records = migrated_household(sub)
    res = client.post("/api/batch", json={"put": records, "delete": []})
    assert res.status_code == 200, res.text

    state = client.get("/api/state").json()
    coll = {"subject": "subjects", "task": "tasks", "document": "documents", "reservation": "reservations",
            "routine": "routines", "assignment": "assignments", "contact": "contacts"}
    for e in records:
        got = next(x for x in state[coll[e["kind"]]] if x["id"] == e["id"])
        assert {k: v for k, v in got.items() if k != "updatedAt"} == {k: v for k, v in e.items() if k != "updatedAt"}, e["id"]


def test_v2_frontend_household_roundtrips(client, sub):
    records = _rekey(json.loads(FIXTURE_V2.read_text()), sub)
    res = client.post("/api/batch", json={"put": records, "delete": []})
    assert res.status_code == 200, res.text

    state = client.get("/api/state").json()
    coll = {"subject": "subjects", "task": "tasks", "document": "documents", "reservation": "reservations",
            "routine": "routines", "assignment": "assignments", "contact": "contacts"}
    assert sum(len(state[c]) for c in coll.values()) == len(records)
    for e in records:
        got = next(x for x in state[coll[e["kind"]]] if x["id"] == e["id"])
        assert {k: v for k, v in got.items() if k != "updatedAt"} == {k: v for k, v in e.items() if k != "updatedAt"}, e["id"]
    # The edits are in it: subtasks are tasks with a parent, reservation files are attachments.
    assert any(t["parentId"] for t in state["tasks"])
    assert any(d["attachedTo"] for d in state["documents"])

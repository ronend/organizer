"""Contract test: a household produced by the real frontend, migrated to v2,
must round-trip through POST /api/batch and GET /api/state unchanged, apart
from the server-set updatedAt.

tests/fixtures/frontend_state.json is the version 1 household captured from
the in-browser mock (localStorage ``coo.mock.state``); it is also the input of
the migration tests. Once the frontend is on v2, add a v2 capture next to it.
"""

import json
from pathlib import Path

from src import migration

FIXTURE = Path(__file__).parent / "fixtures" / "frontend_state.json"


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

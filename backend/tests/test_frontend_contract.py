"""Contract test: a household produced by the real frontend (demo data plus
completed flows, captured from the in-browser mock) must round-trip through
POST /api/batch and GET /api/state unchanged, apart from server-set updatedAt.

Regenerate tests/fixtures/frontend_state.json from the mock's localStorage
key `coo.mock.state` when frontend/src/types/coo.ts changes.
"""

import json
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "frontend_state.json"

COLLECTION = {
    "person": "people", "car": "cars", "contact": "contacts", "routine": "routines",
    "assignment": "assignments", "task": "tasks", "document": "documents",
    "trip": "trips", "reservation": "reservations",
}


def _rekey(entities, sub):
    """Mock file keys live under u/mock/; move them under the caller's prefix."""
    raw = json.dumps(entities).replace('"u/mock/', f'"u/{sub}/')
    return json.loads(raw)


def test_frontend_household_roundtrips(client, sub):
    entities = _rekey(json.loads(FIXTURE.read_text()), sub)
    res = client.post("/api/batch", json={"put": entities, "delete": []})
    assert res.status_code == 200, res.text

    state = client.get("/api/state").json()
    for e in entities:
        got = next(x for x in state[COLLECTION[e["kind"]]] if x["id"] == e["id"])
        want = {k: v for k, v in e.items() if k != "updatedAt"}
        assert {k: v for k, v in got.items() if k != "updatedAt"} == want, e["id"]

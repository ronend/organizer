"""Shared test data: the household captured from the frontend, migrated to
data model v2 by the backend's own migration, and the registry. Backend code
runs in a subprocess (both packages are called `src`)."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "mcp-server"))

REG = json.loads((ROOT / "backend/src/registry.json").read_text())


def backend(code: str, payload) -> str:
    out = subprocess.run(
        [sys.executable, "-c", code], input=json.dumps(payload), capture_output=True, text=True, cwd=ROOT / "backend"
    )
    assert out.returncode == 0, out.stderr[-3000:]
    return out.stdout


@pytest.fixture(scope="session")
def household() -> dict:
    code = (
        "import json,sys; from src import migration;"
        "items=json.load(open('tests/fixtures/frontend_state.json'));"
        "recs,_=migration.migrate(migration.group_v1(items));"
        "print(json.dumps(migration.to_state(recs)))"
    )
    return json.loads(backend(code, None))


@pytest.fixture()
def state(household) -> dict:
    return json.loads(json.dumps(household))


def run_backend(state: dict, body: dict) -> dict:
    """Apply a request with the backend's save_document, then validate every
    record it writes (models) and the household it produces (integrity)."""
    code = (
        "import json,sys; from pydantic import TypeAdapter;"
        "from src import documents, integrity; from src.models import Entity;"
        "inp=json.loads(sys.stdin.read()); b=inp['body'];"
        "puts,dels,doc,summary=documents.save_document(inp['state'], b['document'], renewal=b.get('renewal'),"
        " duplicates=b.get('duplicates','allow'), today=b.get('today'));"
        "ta=TypeAdapter(Entity); puts=[ta.validate_python(p).model_dump() for p in puts];"
        "errs=integrity.check(integrity.apply(inp['state'], puts, dels), puts, dels);"
        "print(json.dumps({'document':doc,'summary':summary,'kinds':[p['kind'] for p in puts],'errors':errs}))"
    )
    got = json.loads(backend(code, {"state": state, "body": body}))
    assert got["errors"] == [], got["errors"]
    return got


def backend_error(state: dict, body: dict) -> dict:
    """The backend's refusal of a request: {'kind': exception name, 'detail', 'existing'}."""
    code = (
        "import json,sys; from src import documents;"
        "inp=json.loads(sys.stdin.read()); b=inp['body'];"
        "\ntry:\n documents.save_document(inp['state'], b['document'], renewal=b.get('renewal'), duplicates=b.get('duplicates','allow'))\n"
        " print(json.dumps({'kind': None}))\n"
        "except documents.DocumentError as e:\n"
        " print(json.dumps({'kind': type(e).__name__, 'detail': str(e), 'existing': getattr(e, 'existing', [])}))"
    )
    return json.loads(backend(code, {"state": state, "body": body}))


def check_records(state: dict, puts: list[dict], deletes: list[dict] = ()) -> list[str]:
    """Backend model + household checks for records the MCP tools write via /api/batch."""
    code = (
        "import json,sys; from pydantic import TypeAdapter;"
        "from src import integrity; from src.models import Entity;"
        "inp=json.loads(sys.stdin.read()); ta=TypeAdapter(Entity);"
        "puts=[ta.validate_python(p).model_dump() for p in inp['puts']];"
        "print(json.dumps(integrity.check(integrity.apply(inp['state'], puts, inp['deletes']), puts, inp['deletes'])))"
    )
    return json.loads(backend(code, {"state": state, "puts": puts, "deletes": list(deletes)}))

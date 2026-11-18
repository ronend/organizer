"""DynamoDB data layer for the coo model (version 2).

Single table (``DYNAMO_TABLE``), partition key ``userId`` (the Cognito ``sub``),
sort key ``SK``. Every coo record is one item:

    SK = V2#<kind>#<id>       attributes = the entity's fields, verbatim (camelCase)

Older rows share the partition and are never written here:

    COO#<kind>#<id>           version 1 (person/car/trip/...); read only by the
                              migration (src/migration.py), kept for rollback
    ITEM#... / REMIDX#...     the model before that; ignored

Writes are TransactWriteItems in chunks of ≤100 (atomic per chunk). Optional
expectations make them conditional (optimistic concurrency): a stale record
cancels the whole chunk and raises StaleError.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal
from functools import lru_cache
from typing import Any, Iterable, Optional

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.exceptions import ClientError

from src.models import ENTITY_KINDS, STATE_KEYS

SK_PREFIX = "V2#"
V1_PREFIX = "COO#"
# DynamoDB's TransactWriteItems limit.
TRANSACT_CHUNK = 100

_ser = TypeSerializer()
_deser = TypeDeserializer()


@lru_cache(maxsize=1)
def _client():
    return boto3.client("dynamodb")


def _table_name() -> str:
    return os.environ["DYNAMO_TABLE"]


def now_iso() -> str:
    """UTC timestamp, ISO 8601 with millisecond precision and a Z suffix."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sort_key(kind: str, entity_id: str) -> str:
    return f"{SK_PREFIX}{kind}#{entity_id}"


# ── number conversion ───────────────────────────────────────────────────────


def _to_dynamo(v: Any) -> Any:
    """floats → Decimal (DynamoDB rejects Python floats), recursively."""
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        return Decimal(str(v))
    if isinstance(v, dict):
        return {k: _to_dynamo(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_to_dynamo(x) for x in v]
    return v


def _from_dynamo(v: Any) -> Any:
    """Decimal → int (when integral) or float, recursively."""
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    if isinstance(v, dict):
        return {k: _from_dynamo(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_from_dynamo(x) for x in v]
    return v


# ── reads ───────────────────────────────────────────────────────────────────


def _empty_state() -> dict[str, list]:
    return {STATE_KEYS[k]: [] for k in ENTITY_KINDS}


def load_items(user_id: str, prefix: str) -> list[dict]:
    """Every item under an SK prefix for a user, without userId/SK."""
    out = []
    pages = _client().get_paginator("query").paginate(
        TableName=_table_name(),
        KeyConditionExpression="userId = :u AND begins_with(SK, :p)",
        ExpressionAttributeValues={":u": {"S": user_id}, ":p": {"S": prefix}},
    )
    for page in pages:
        for raw in page.get("Items", []):
            item = {k: _deser.deserialize(v) for k, v in raw.items()}
            item.pop("userId", None)
            item.pop("SK", None)
            out.append(_from_dynamo(item))
    return out


def load_state(user_id: str) -> dict[str, list]:
    """All v2 records for a user, grouped into collections."""
    state = _empty_state()
    for item in load_items(user_id, SK_PREFIX):
        key = STATE_KEYS.get(item.get("kind"))
        if key is not None:  # unknown kind — ignore rather than fail the whole load
            state[key].append(item)
    return state


def has_items(user_id: str, prefix: str) -> bool:
    resp = _client().query(
        TableName=_table_name(),
        KeyConditionExpression="userId = :u AND begins_with(SK, :p)",
        ExpressionAttributeValues={":u": {"S": user_id}, ":p": {"S": prefix}},
        Limit=1,
        ProjectionExpression="SK",
    )
    return bool(resp.get("Items"))


# ── writes ──────────────────────────────────────────────────────────────────


class ConflictError(ValueError):
    """The same record appears more than once in a batch."""


class StaleError(ValueError):
    """An expectation failed: a record changed (or appeared) since the caller read it."""


def _condition(expected: Optional[str]) -> dict:
    if expected is None:
        return {"ConditionExpression": "attribute_not_exists(SK)"}
    return {
        "ConditionExpression": "updatedAt = :expected",
        "ExpressionAttributeValues": {":expected": {"S": expected}},
    }


def apply_changes(
    user_id: str,
    puts: Iterable[dict],
    deletes: Iterable[dict],
    expect: Iterable[dict] = (),
) -> str:
    """Upsert ``puts`` (full entity dicts) and delete ``deletes`` (``{kind, id}``).

    ``expect`` is ``[{kind, id, updatedAt}]``: each write to (or check of) that
    record only succeeds if its stored ``updatedAt`` still matches (null =
    must not exist). The server stamps ``updatedAt`` on every put and keeps
    the client's ``createdAt``.

    Raises ConflictError if a key is put twice, deleted twice, or both put and
    deleted; StaleError if an expectation fails. Returns the stamp used.
    """
    stamp = now_iso()
    table = _table_name()
    seen: set[str] = set()
    ops: list[dict] = []
    expected = {sort_key(e["kind"], e["id"]): e.get("updatedAt") for e in expect}

    def claim(sk: str) -> None:
        if sk in seen:
            raise ConflictError(f"record {sk[len(SK_PREFIX):]} appears more than once in the batch")
        seen.add(sk)

    for entity in puts:
        sk = sort_key(entity["kind"], entity["id"])
        claim(sk)
        item = {**_to_dynamo(entity), "updatedAt": stamp, "userId": user_id, "SK": sk}
        op: dict = {"TableName": table, "Item": {k: _ser.serialize(v) for k, v in item.items()}}
        if sk in expected:
            op.update(_condition(expected[sk]))
        ops.append({"Put": op})

    for ref in deletes:
        sk = sort_key(ref["kind"], ref["id"])
        claim(sk)
        op = {"TableName": table, "Key": {"userId": {"S": user_id}, "SK": {"S": sk}}}
        if sk in expected:
            op.update(_condition(expected[sk]))
        ops.append({"Delete": op})

    # Expectations on records this batch doesn't write are plain checks.
    for sk, exp in expected.items():
        if sk not in seen:
            ops.append({"ConditionCheck": {
                "TableName": table, "Key": {"userId": {"S": user_id}, "SK": {"S": sk}}, **_condition(exp),
            }})

    client = _client()
    for i in range(0, len(ops), TRANSACT_CHUNK):
        try:
            client.transact_write_items(TransactItems=ops[i : i + TRANSACT_CHUNK])
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") == "TransactionCanceledException":
                reasons = e.response.get("CancellationReasons") or []
                if any(r.get("Code") == "ConditionalCheckFailed" for r in reasons) or not reasons:
                    raise StaleError("A record changed since you loaded it; reload and try again") from None
            raise

    return stamp


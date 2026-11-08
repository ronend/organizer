"""DynamoDB data layer for the coo model.

Single table (``DYNAMO_TABLE``), partition key ``userId`` (the Cognito ``sub``),
sort key ``SK``. Every coo record is one item:

    SK = COO#<kind>#<id>      attributes = the entity's fields, verbatim (camelCase)

Legacy rows from the previous model (``ITEM#...`` / ``REMIDX#...``) share the
partition. They are left in place and never read or written here — every query
is scoped with ``begins_with(SK, "COO#")``.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from decimal import Decimal
from functools import lru_cache
from typing import Any, Iterable

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer

from src.models import ENTITY_KINDS, STATE_KEYS

SK_PREFIX = "COO#"
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


def load_state(user_id: str) -> dict[str, list]:
    """All coo records for a user, grouped into the CooState shape."""
    state = _empty_state()
    paginator = _client().get_paginator("query")
    pages = paginator.paginate(
        TableName=_table_name(),
        KeyConditionExpression="userId = :u AND begins_with(SK, :p)",
        ExpressionAttributeValues={":u": {"S": user_id}, ":p": {"S": SK_PREFIX}},
    )
    for page in pages:
        for raw in page.get("Items", []):
            item = {k: _deser.deserialize(v) for k, v in raw.items()}
            item.pop("userId", None)
            item.pop("SK", None)
            key = STATE_KEYS.get(item.get("kind"))
            if key is None:
                continue  # unknown kind — ignore rather than fail the whole load
            state[key].append(_from_dynamo(item))
    return state


# ── writes ──────────────────────────────────────────────────────────────────


class ConflictError(ValueError):
    """The same record appears more than once in a batch."""


def apply_changes(
    user_id: str, puts: Iterable[dict], deletes: Iterable[dict]
) -> str:
    """Upsert ``puts`` (full entity dicts) and delete ``deletes`` (``{kind, id}``).

    The server stamps ``updatedAt`` on every put (and keeps the client's
    ``createdAt``). Writes go out as TransactWriteItems in chunks of ≤100, so a
    batch of ≤100 operations is atomic; larger batches are atomic per chunk.

    Raises ConflictError if a key is put twice, deleted twice, or both put and
    deleted. Returns the ``updatedAt`` stamp used.
    """
    stamp = now_iso()
    table = _table_name()
    seen: set[str] = set()
    ops: list[dict] = []

    def claim(sk: str) -> None:
        if sk in seen:
            raise ConflictError(f"record {sk[len(SK_PREFIX):]} appears more than once in the batch")
        seen.add(sk)

    for entity in puts:
        sk = sort_key(entity["kind"], entity["id"])
        claim(sk)
        item = {**_to_dynamo(entity), "updatedAt": stamp, "userId": user_id, "SK": sk}
        ops.append(
            {"Put": {"TableName": table, "Item": {k: _ser.serialize(v) for k, v in item.items()}}}
        )

    for ref in deletes:
        sk = sort_key(ref["kind"], ref["id"])
        claim(sk)
        ops.append(
            {
                "Delete": {
                    "TableName": table,
                    "Key": {"userId": {"S": user_id}, "SK": {"S": sk}},
                }
            }
        )

    client = _client()
    for i in range(0, len(ops), TRANSACT_CHUNK):
        client.transact_write_items(TransactItems=ops[i : i + TRANSACT_CHUNK])

    return stamp

"""DynamoDB data layer for the flat entity model (see entity-model-proposal.md).

Single table, partition key ``userId``. Two logical collections share the
partition, separated by sort-key (``SK``) prefixes:

    ITEM#<id>                        → one entity document (todo/appointment/
                                       habit/routine/reservation/event/story)
    REMIDX#<fire_at>#<row_id>        → a flat reminder-index projection used only
                                       by the "what fires next" notification view

The reminder-index rows are a write-through projection — never the source of
truth. They are re-synced on every entity write and deleted with their entity.
Only routines contribute multiple rows (one per scheduled reminder); dated
non-routine items contribute a single row at their own date/time. Habits and
stories contribute none. boto3 is provided by the Lambda runtime.
"""

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

import boto3
from boto3.dynamodb.conditions import Key

from src import ids
from src import recurrence as rec

_TABLE_NAME = os.environ["DYNAMO_TABLE"]
_table = boto3.resource("dynamodb").Table(_TABLE_NAME)

ITEM_PREFIX = "ITEM#"
REMIDX_PREFIX = "REMIDX#"


# ── (de)serialization helpers ──────────────────────────────────────────────────


def _plain(v: Any) -> Any:
    """DynamoDB Decimals (incl. nested) → plain JSON numbers."""
    if isinstance(v, Decimal):
        return int(v) if v % 1 == 0 else float(v)
    if isinstance(v, list):
        return [_plain(x) for x in v]
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    return v


def _numify(v: Any) -> Any:
    """floats → Decimal (DynamoDB rejects float). bool/int pass through."""
    if isinstance(v, bool):
        return v
    if isinstance(v, float):
        return Decimal(str(v))
    if isinstance(v, list):
        return [_numify(x) for x in v]
    if isinstance(v, dict):
        return {k: _numify(x) for k, x in v.items()}
    return v


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _strip(item: dict) -> dict:
    """Drop internal table keys, returning the bare document."""
    out = _plain(item)
    out.pop("userId", None)
    out.pop("SK", None)
    return out


# ── Entity assembly ─────────────────────────────────────────────────────────────


def _build_entity(data: dict, existing: Optional[dict] = None) -> dict:
    """Attach server-owned fields (id, created_at, updated_at) to a validated
    payload. ``existing`` preserves id/created_at on update."""
    etype = data["type"]
    entity_id = (existing or {}).get("id") or data.get("id") or ids.entity_id(etype)
    created_at = (existing or {}).get("created_at") or data.get("created_at") or _now()
    out = {k: v for k, v in data.items() if k not in ("id", "created_at", "updated_at")}
    out["id"] = entity_id
    out["type"] = etype
    out["created_at"] = created_at
    out["updated_at"] = _now()
    return out


# ── Reminder-index projection ───────────────────────────────────────────────────


def _index_entries(entity: dict) -> list[dict]:
    """Flatten an entity's notification triggers into index-row dicts.

    Routine → one row per scheduled reminder (offset resolved against due_at).
    todo/appointment/reservation/event → a single row at their own date/time.
    Habit/story → none.
    """
    etype = entity["type"]
    eid = entity["id"]
    title = entity.get("title", "")
    rows: list[dict] = []

    def add(row_id: str, fire_at: Optional[str]) -> None:
        if not fire_at:
            return
        rows.append(
            {
                "id": row_id,
                "source_id": eid,
                "source_type": etype,
                "title": title,
                "fire_at": fire_at,
                "status": "pending",
            }
        )

    if etype == "routine":
        due = rec.parse_iso(entity.get("due_at"))
        for i, reminder in enumerate(entity.get("reminders", [])):
            if reminder.get("kind") == "absolute":
                fire_at = reminder.get("at")
            else:
                fired = rec.resolve_offset(due, reminder.get("offset")) if due else None
                fire_at = rec.to_iso(fired) if fired else None
            add(f"{eid}#r{i}", fire_at)
    elif etype == "todo":
        add(eid, entity.get("due_at"))
    elif etype == "appointment":
        add(eid, entity.get("date_time"))
    elif etype == "reservation":
        add(eid, entity.get("date_time"))
    elif etype == "event":
        add(eid, entity.get("start_at"))

    return rows


def _delete_index_for_source(user_id: str, source_id: str) -> None:
    resp = _table.query(
        KeyConditionExpression=Key("userId").eq(user_id)
        & Key("SK").begins_with(REMIDX_PREFIX),
        FilterExpression="source_id = :s",
        ExpressionAttributeValues={":s": source_id},
    )
    rows = resp.get("Items", [])
    if not rows:
        return
    with _table.batch_writer() as bw:
        for row in rows:
            bw.delete_item(Key={"userId": user_id, "SK": row["SK"]})


def _sync_index(user_id: str, entity: dict) -> None:
    """Write-through: replace this entity's index rows with a fresh projection."""
    _delete_index_for_source(user_id, entity["id"])
    entries = _index_entries(entity)
    if not entries:
        return
    with _table.batch_writer() as bw:
        for entry in entries:
            sk = f"{REMIDX_PREFIX}{entry['fire_at']}#{entry['id']}"
            bw.put_item(Item=_numify({"userId": user_id, "SK": sk, **entry}))


# ── Entity persistence ──────────────────────────────────────────────────────────


def _put_entity(user_id: str, entity: dict) -> None:
    item = {"userId": user_id, "SK": f"{ITEM_PREFIX}{entity['id']}", **entity}
    _table.put_item(Item=_numify(item))


def list_entities(user_id: str, entity_type: Optional[str] = None) -> list[dict]:
    resp = _table.query(
        KeyConditionExpression=Key("userId").eq(user_id)
        & Key("SK").begins_with(ITEM_PREFIX)
    )
    items = [_strip(i) for i in resp.get("Items", [])]
    if entity_type:
        items = [i for i in items if i.get("type") == entity_type]
    return items


def get_entity(user_id: str, entity_id: str) -> Optional[dict]:
    resp = _table.get_item(Key={"userId": user_id, "SK": f"{ITEM_PREFIX}{entity_id}"})
    item = resp.get("Item")
    return _strip(item) if item else None


def create_entity(user_id: str, data: dict) -> dict:
    entity = _build_entity(data)
    _put_entity(user_id, entity)
    _sync_index(user_id, entity)
    return entity


def update_entity(user_id: str, entity_id: str, data: dict) -> Optional[dict]:
    existing = get_entity(user_id, entity_id)
    if existing is None:
        return None
    entity = _build_entity({**data, "type": existing["type"]}, existing=existing)
    _put_entity(user_id, entity)
    _sync_index(user_id, entity)
    return entity


def delete_entity(user_id: str, entity_id: str) -> bool:
    existing = get_entity(user_id, entity_id)
    if existing is None:
        return False
    _table.delete_item(Key={"userId": user_id, "SK": f"{ITEM_PREFIX}{entity_id}"})
    _delete_index_for_source(user_id, entity_id)
    return True


def log_habit_occurrence(
    user_id: str, entity_id: str, date: str, completed: bool
) -> Optional[dict]:
    """Set completion_log[date] = completed on a habit. Returns the updated habit,
    None if it doesn't exist, and raises ValueError if the item isn't a habit."""
    existing = get_entity(user_id, entity_id)
    if existing is None:
        return None
    if existing.get("type") != "habit":
        raise ValueError("item is not a habit")
    log = dict(existing.get("completion_log") or {})
    log[date] = bool(completed)
    entity = _build_entity({**existing, "completion_log": log}, existing=existing)
    _put_entity(user_id, entity)
    return entity


# ── Derived views ────────────────────────────────────────────────────────────────


def _timeline_key(entity: dict) -> Optional[str]:
    if entity.get("type") == "reservation":
        return entity.get("date_time")
    if entity.get("type") == "event":
        return entity.get("start_at")
    return None


def story_timeline(user_id: str, story_id: str) -> Optional[dict]:
    """Resolve a story's item_refs and return a chronological timeline of the
    referenced reservations and events. Missing/deleted or wrong-type refs are
    skipped. Returns {"story": <story>, "timeline": [<entity>, ...]} or None."""
    story = get_entity(user_id, story_id)
    if story is None or story.get("type") != "story":
        return None
    resolved: list[dict] = []
    for ref in story.get("item_refs", []):
        target = get_entity(user_id, ref)
        if target and target.get("type") in ("reservation", "event"):
            resolved.append(target)
    resolved.sort(key=lambda e: (_timeline_key(e) or "￿"))
    return {"story": story, "timeline": resolved}


def upcoming_reminders(
    user_id: str,
    before_iso: Optional[str] = None,
    status: Optional[str] = "pending",
    limit: int = 50,
) -> list[dict]:
    """Query the flat reminder index ordered by fire_at (SK sorts lexicographically,
    which matches ISO 8601 chronological order)."""
    cond = Key("userId").eq(user_id) & Key("SK").begins_with(REMIDX_PREFIX)
    filters = []
    values: dict[str, Any] = {}
    names: dict[str, str] = {}
    if status is not None:
        filters.append("#s = :st")
        values[":st"] = status
        names["#s"] = "status"
    if before_iso is not None:
        filters.append("fire_at <= :b")
        values[":b"] = before_iso
    kwargs: dict[str, Any] = {"KeyConditionExpression": cond}
    if filters:
        kwargs["FilterExpression"] = " AND ".join(filters)
        kwargs["ExpressionAttributeValues"] = values
        if names:
            kwargs["ExpressionAttributeNames"] = names
    resp = _table.query(**kwargs)
    rows = [_strip(i) for i in resp.get("Items", [])]
    return rows[:limit]

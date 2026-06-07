"""DynamoDB helpers (boto3). Single table, partition key userId, sort key
organizerId. boto3 is provided by the Lambda runtime."""

import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional, TypedDict

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

_TABLE_NAME = os.environ["DYNAMO_TABLE"]
_table = boto3.resource("dynamodb").Table(_TABLE_NAME)


def _plain(v: Any) -> Any:
    """Convert DynamoDB Decimals (incl. nested) to plain JSON numbers."""
    if isinstance(v, Decimal):
        return int(v) if v % 1 == 0 else float(v)
    if isinstance(v, list):
        return [_plain(x) for x in v]
    if isinstance(v, dict):
        return {k: _plain(x) for k, x in v.items()}
    return v


class Organizer(TypedDict, total=False):
    id: str
    userId: str
    createdAt: str
    tags: list           # free-form labels (replaces old single `category`)
    type: str            # task | trip | recurring
    title: str
    description: str     # rich text (HTML)
    dueDate: str         # YYYY-MM-DD
    dueTime: str         # HH:MM
    done: bool
    link: str            # task: optional URL
    contacts: list       # task: [{name, role, phone, email}]
    dependsOn: list      # task: [{entryId, daysBefore}]
    recurrence: Any      # recurring cadence (or None)
    reminders: list      # recurring: auto-spawn reminder templates
    parentId: Any        # spawned reminder -> parent recurring id (or None)
    isPrereq: bool       # spawned reminder sub-task flag


# Legacy entry types -> new types (lazy migration on read, no DB write).
_TYPE_MIGRATION = {
    "simple": "task",
    "complex": "task",
    "project": "task",
    "repeat": "recurring",
    "routine": "recurring",
}


def _migrate_tags(item: dict) -> list:
    """Prefer stored `tags`; else derive from the legacy single `category`
    (the old default 'errand' becomes no tag)."""
    stored = _plain(item.get("tags"))
    if stored:
        return stored
    cat = item.get("category")
    if cat and cat != "errand":
        return [cat]
    return []


def _migrate_reminders(item: dict) -> list:
    """Prefer stored `reminders`; else map legacy `prerequisites`
    (title -> label, leadDays -> daysBefore)."""
    stored = _plain(item.get("reminders"))
    if stored:
        return stored
    legacy = _plain(item.get("prerequisites")) or []
    return [
        {
            "label": p.get("title", ""),
            "daysBefore": int(p.get("leadDays", 0) or 0),
            "note": p.get("note", ""),
        }
        for p in legacy
    ]


def _to_organizer(item: dict) -> Organizer:
    # Defaults keep any legacy {text, done} items readable.
    raw_type = item.get("type", "task")
    return {
        "id": item["organizerId"],
        "userId": item["userId"],
        "createdAt": item.get("createdAt", ""),
        "tags": _migrate_tags(item),
        "type": _TYPE_MIGRATION.get(raw_type, raw_type),
        "title": item.get("title", item.get("text", "(untitled)")),
        "description": item.get("description", ""),
        "dueDate": item.get("dueDate", ""),
        "dueTime": item.get("dueTime", "09:00"),
        "done": bool(item.get("done", False)),
        "link": item.get("link", ""),
        "contacts": _plain(item.get("contacts", [])) or [],
        "dependsOn": _plain(item.get("dependsOn", [])) or [],
        "recurrence": _plain(item.get("recurrence")) or None,
        "reminders": _migrate_reminders(item),
        "parentId": item.get("parentId") or None,
        "isPrereq": bool(item.get("isPrereq", False)),
    }


def list_organizers(user_id: str) -> list[Organizer]:
    resp = _table.query(KeyConditionExpression=Key("userId").eq(user_id))
    return [_to_organizer(item) for item in resp.get("Items", [])]


def create_organizer(user_id: str, data: dict[str, Any]) -> Organizer:
    item = {
        "userId": user_id,
        "organizerId": str(uuid.uuid4()),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "tags": data.get("tags") or [],
        "type": data.get("type") or "task",
        "title": data.get("title") or "",
        "description": data.get("description") or "",
        "dueDate": data.get("dueDate") or "",
        "dueTime": data.get("dueTime") or "09:00",
        "done": bool(data.get("done", False)),
        "link": data.get("link") or "",
        "contacts": data.get("contacts") or [],
        "dependsOn": data.get("dependsOn") or [],
        "reminders": data.get("reminders") or [],
        "isPrereq": bool(data.get("isPrereq", False)),
    }
    if data.get("recurrence"):
        item["recurrence"] = data["recurrence"]
    if data.get("parentId"):
        item["parentId"] = data["parentId"]
    _table.put_item(Item=item)
    return _to_organizer(item)


def update_organizer(
    user_id: str,
    organizer_id: str,
    updates: dict[str, Any],
) -> Optional[Organizer]:
    # Build a SET expression with aliased names (covers reserved words like
    # `type` and `done`) for whichever fields were provided.
    sets: list[str] = []
    names: dict[str, str] = {}
    values: dict[str, Any] = {}
    for i, (field, value) in enumerate(updates.items()):
        if value is None:
            continue
        nk, vk = f"#f{i}", f":v{i}"
        names[nk] = field
        values[vk] = value
        sets.append(f"{nk} = {vk}")

    if not sets:
        # Nothing to update — return the current item if it exists.
        return next(
            (o for o in list_organizers(user_id) if o["id"] == organizer_id), None
        )

    try:
        resp = _table.update_item(
            Key={"userId": user_id, "organizerId": organizer_id},
            UpdateExpression="SET " + ", ".join(sets),
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            # Only update an item that already exists for this user.
            ConditionExpression="attribute_exists(organizerId)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            return None
        raise

    return _to_organizer(resp["Attributes"])


def delete_organizer(user_id: str, organizer_id: str) -> None:
    _table.delete_item(Key={"userId": user_id, "organizerId": organizer_id})


def get_organizer(user_id: str, organizer_id: str) -> Optional[Organizer]:
    resp = _table.get_item(Key={"userId": user_id, "organizerId": organizer_id})
    item = resp.get("Item")
    return _to_organizer(item) if item else None


# --- Routine rollover (atomic) ---
from boto3.dynamodb.types import TypeSerializer  # noqa: E402
from src import recurrence as _occurrence  # noqa: E402

_serializer = TypeSerializer()


def _marshal(item: dict) -> dict:
    return {k: _serializer.serialize(v) for k, v in item.items()}


def complete_routine(user_id: str, organizer_id: str) -> Optional[list[Organizer]]:
    """Mark a routine occurrence done and, in a single DynamoDB transaction,
    create the next occurrence plus its prerequisite items. Returns the newly
    created items, or None if the routine doesn't exist."""
    resp = _table.get_item(Key={"userId": user_id, "organizerId": organizer_id})
    raw = resp.get("Item")
    if not raw:
        return None

    client = _table.meta.client
    transact: list[dict] = [
        {
            "Update": {
                "TableName": _TABLE_NAME,
                "Key": {"userId": {"S": user_id}, "organizerId": {"S": organizer_id}},
                "UpdateExpression": "SET #d = :t",
                "ExpressionAttributeNames": {"#d": "done"},
                "ExpressionAttributeValues": {":t": {"BOOL": True}},
                "ConditionExpression": "attribute_exists(organizerId)",
            }
        }
    ]

    recurrence = _plain(raw.get("recurrence"))
    created: list[dict] = []

    if recurrence:
        prev = _occurrence.parse_due(raw.get("dueDate", ""), raw.get("dueTime", "09:00"))
        nxt = _occurrence.next_occurrence(prev, recurrence, prev)
        tags = _migrate_tags(raw)
        reminders = _migrate_reminders(raw)
        next_id = str(uuid.uuid4())
        next_item = {
            "userId": user_id,
            "organizerId": next_id,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "tags": tags,
            "type": "recurring",
            "title": raw.get("title", ""),
            "description": raw.get("description", ""),
            "dueDate": _occurrence.to_date_str(nxt),
            "dueTime": _occurrence.to_time_str(nxt),
            "done": False,
            "recurrence": recurrence,
            "reminders": reminders,
            "isPrereq": False,
        }
        transact.append({"Put": {"TableName": _TABLE_NAME, "Item": _marshal(next_item)}})
        created.append(next_item)

        # none / one / many reminders -> auto-created sub-tasks
        for r in reminders:
            due = _occurrence.prereq_due(nxt, r)
            reminder_item = {
                "userId": user_id,
                "organizerId": str(uuid.uuid4()),
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "tags": tags,
                "type": "task",
                "title": r.get("label", ""),
                "description": r.get("note", ""),
                "dueDate": _occurrence.to_date_str(due),
                "dueTime": _occurrence.to_time_str(due),
                "done": False,
                "reminders": [],
                "parentId": next_id,
                "isPrereq": True,
            }
            transact.append({"Put": {"TableName": _TABLE_NAME, "Item": _marshal(reminder_item)}})
            created.append(reminder_item)

    client.transact_write_items(TransactItems=transact)
    return [_to_organizer(i) for i in created]

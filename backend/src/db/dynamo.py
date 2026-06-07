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
    category: str
    type: str              # simple | complex | repeat | project | routine
    title: str
    description: str       # rich text (HTML)
    dueDate: str           # YYYY-MM-DD
    dueTime: str           # HH:MM
    done: bool
    recurrence: Any        # routine cadence (or None)
    prerequisites: list    # routine prerequisite templates
    parentId: Any          # prereq -> parent routine id (or None)
    isPrereq: bool


def _to_organizer(item: dict) -> Organizer:
    # Defaults keep any legacy {text, done} items readable.
    return {
        "id": item["organizerId"],
        "userId": item["userId"],
        "createdAt": item.get("createdAt", ""),
        "category": item.get("category", "errand"),
        "type": item.get("type", "simple"),
        "title": item.get("title", item.get("text", "(untitled)")),
        "description": item.get("description", ""),
        "dueDate": item.get("dueDate", ""),
        "dueTime": item.get("dueTime", "09:00"),
        "done": bool(item.get("done", False)),
        "recurrence": _plain(item.get("recurrence")) or None,
        "prerequisites": _plain(item.get("prerequisites", [])) or [],
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
        "category": data.get("category") or "errand",
        "type": data.get("type") or "simple",
        "title": data.get("title") or "",
        "description": data.get("description") or "",
        "dueDate": data.get("dueDate") or "",
        "dueTime": data.get("dueTime") or "09:00",
        "done": bool(data.get("done", False)),
        "prerequisites": data.get("prerequisites") or [],
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

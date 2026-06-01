"""DynamoDB helpers (boto3). Single table, partition key userId, sort key
organizerId. boto3 is provided by the Lambda runtime."""

import os
import uuid
from datetime import datetime, timezone
from typing import Optional, TypedDict

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

_TABLE_NAME = os.environ["DYNAMO_TABLE"]
_table = boto3.resource("dynamodb").Table(_TABLE_NAME)


class Organizer(TypedDict):
    id: str
    text: str
    done: bool
    createdAt: str
    userId: str


def _to_organizer(item: dict) -> Organizer:
    return {
        "id": item["organizerId"],
        "text": item["text"],
        "done": item["done"],
        "createdAt": item["createdAt"],
        "userId": item["userId"],
    }


def list_organizers(user_id: str) -> list[Organizer]:
    resp = _table.query(KeyConditionExpression=Key("userId").eq(user_id))
    return [_to_organizer(item) for item in resp.get("Items", [])]


def create_organizer(user_id: str, text: str) -> Organizer:
    item = {
        "userId": user_id,
        "organizerId": str(uuid.uuid4()),
        "text": text,
        "done": False,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    _table.put_item(Item=item)
    return _to_organizer(item)


def update_organizer(
    user_id: str,
    organizer_id: str,
    done: Optional[bool] = None,
    text: Optional[str] = None,
) -> Optional[Organizer]:
    sets: list[str] = []
    names: dict[str, str] = {}
    values: dict[str, object] = {}

    if done is not None:
        sets.append("#done = :done")
        names["#done"] = "done"
        values[":done"] = done
    if text is not None:
        sets.append("#text = :text")
        names["#text"] = "text"
        values[":text"] = text

    if not sets:
        # Nothing to update — return the current item if it exists.
        return next((t for t in list_organizers(user_id) if t["id"] == organizer_id), None)

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

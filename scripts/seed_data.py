#!/usr/bin/env python3
"""Seed the organizer DynamoDB table with example entities for one user.

Generates one item of each of the seven types (todo, appointment, habit, routine,
reservation, event, story) following entity-model-proposal.md, plus the matching
reminder-index rows so the "upcoming reminders" view is populated.

Single-table layout (see backend/src/db/dynamo.py): PK=userId, SK carries a
collection prefix — ITEM#<id> for entities, REMIDX#<fire_at>#<row_id> for the
reminder index.

The table name is CloudFormation-generated (no fixed name) — grab it from the
stack's `TableName` output:
  aws cloudformation describe-stacks --stack-name organizer-app \
      --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text

Usage:
  python3 scripts/seed_data.py --dry-run          # print entities, write nothing
  python3 scripts/seed_data.py --user-id <sub> --table <name> --region us-east-1
"""

from __future__ import annotations

import argparse
import datetime as dt
import secrets
import sys
from pathlib import Path

# Reuse the backend's offset resolution for routine reminders.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from src import recurrence as rec  # noqa: E402

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def _id(entity_type: str) -> str:
    suffix = "".join(secrets.choice(_ALPHABET) for _ in range(6))
    return f"{entity_type}_{suffix}"


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def _dt(days: int, hour: int = 9) -> str:
    d = dt.datetime.now().replace(hour=hour, minute=0, second=0, microsecond=0) + dt.timedelta(days=days)
    return d.replace(microsecond=0).isoformat()


def build_entities() -> list[dict]:
    """One exemplar entity per type. The story references the reservation + event."""
    now = _now()

    def base(entity_type: str, extra: dict) -> dict:
        return {"id": _id(entity_type), "type": entity_type, "created_at": now, "updated_at": now, **extra}

    todo = base("todo", {"title": "Renew passport", "due_at": _dt(9, 17), "completed": False})

    appointment = base(
        "appointment",
        {
            "title": "Dental cleaning",
            "date_time": _dt(6, 10),
            "location": "123 Main St, Suite 4B",
            "contact": {"name": "Dr. Park", "phone": "212-555-0100"},
            "things_to_bring": ["insurance card", "list of medications"],
            "completed": False,
        },
    )

    habit = base(
        "habit",
        {
            "title": "Take Metformin",
            "recurrence": {"freq": "daily", "interval": 1},
            "completion_log": {},
        },
    )

    routine = base(
        "routine",
        {
            "title": "Morning routine",
            "due_at": _dt(1, 7),
            "reminders": [{"kind": "offset", "offset": "-15m"}, {"kind": "offset", "offset": "-1h"}],
            "completed": False,
        },
    )

    reservation = base(
        "reservation",
        {
            "title": "DL 442 JFK → LAS",
            "subtype": "flight",
            "date_time": _dt(20, 8),
            "location": "JFK Terminal 4",
            "details": {"airline": "Delta", "seat": "14C"},
            "reservation_number": "XKQP7R",
        },
    )

    event = base(
        "event",
        {
            "title": "Zion hiking day",
            "start_at": _dt(22, 7),
            "end_at": _dt(22, 18),
            "details": "Narrows top-down. Bring water shoes.",
        },
    )

    story = base(
        "story",
        {"title": "Zion trip", "item_refs": [reservation["id"], event["id"]]},
    )

    return [todo, appointment, habit, routine, reservation, event, story]


def index_rows(entity: dict) -> list[dict]:
    """Flat reminder-index projection (mirrors backend/src/db/dynamo._index_entries)."""
    etype, eid, title = entity["type"], entity["id"], entity.get("title", "")
    rows: list[dict] = []

    def add(row_id: str, fire_at):
        if fire_at:
            rows.append(
                {"id": row_id, "source_id": eid, "source_type": etype, "title": title, "fire_at": fire_at, "status": "pending"}
            )

    if etype == "routine":
        due = rec.parse_iso(entity.get("due_at"))
        for i, reminder in enumerate(entity.get("reminders", [])):
            if reminder.get("kind") == "absolute":
                fire = reminder.get("at")
            else:
                resolved = rec.resolve_offset(due, reminder.get("offset")) if due else None
                fire = rec.to_iso(resolved) if resolved else None
            add(f"{eid}#r{i}", fire)
    elif etype == "todo":
        add(eid, entity.get("due_at"))
    elif etype in ("appointment", "reservation"):
        add(eid, entity.get("date_time"))
    elif etype == "event":
        add(eid, entity.get("start_at"))
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user-id", help="Cognito sub of the target user")
    ap.add_argument("--table", help="DynamoDB table name (stack TableName output)")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--dry-run", action="store_true", help="Print the entities; write nothing")
    args = ap.parse_args()

    entities = build_entities()

    if args.dry_run:
        import json

        print(json.dumps(entities, indent=2))
        total_idx = sum(len(index_rows(e)) for e in entities)
        print(f"\n(dry-run) {len(entities)} entities, {total_idx} reminder-index rows")
        return

    if not (args.user_id and args.table):
        ap.error("provide --user-id and --table (or --dry-run)")

    import boto3

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table)
    with table.batch_writer() as bw:
        for entity in entities:
            bw.put_item(Item={"userId": args.user_id, "SK": f"ITEM#{entity['id']}", **entity})
            for row in index_rows(entity):
                bw.put_item(Item={"userId": args.user_id, "SK": f"REMIDX#{row['fire_at']}#{row['id']}", **row})

    counts: dict[str, int] = {}
    for e in entities:
        counts[e["type"]] = counts.get(e["type"], 0) + 1
    print(f"Seeded {len(entities)} entities into {args.table} for user {args.user_id}")
    for t, n in sorted(counts.items()):
        print(f"  {t:12} {n}")


if __name__ == "__main__":
    main()

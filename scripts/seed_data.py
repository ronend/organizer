#!/usr/bin/env python3
"""Seed the organizer DynamoDB table with example events for one user.

Generates a handful of event documents spanning all four kinds (container,
occurrence, habit, list) following data-structure.md, plus the matching
reminders_index rows so the "upcoming reminders" view is populated.

Single-table layout (see backend/src/db/dynamo.py): PK=userId, SK carries a
collection prefix — EVENT#<id> for events, REMIDX#<fire_at>#<id> for the
reminder index.

The table name is CloudFormation-generated (no fixed name) — grab it from the
stack's `TableName` output:
  aws cloudformation describe-stacks --stack-name organizer-app \
      --query "Stacks[0].Outputs[?OutputKey=='TableName'].OutputValue" --output text

Usage:
  python3 scripts/seed_data.py --user-id <cognito-sub> \
      --table <generated-table-name> --region us-east-1
"""

import argparse
import datetime as dt
import random
import secrets
from decimal import Decimal

import boto3

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def _nano(n: int) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(n))


def evt() -> str:
    return f"evt_{_nano(8)}"


def itm() -> str:
    return f"itm_{_nano(6)}"


def rem() -> str:
    return f"rem_{_nano(6)}"


def cl() -> str:
    return f"cl_{_nano(6)}"


def cli() -> str:
    return f"cli_{_nano(6)}"


def _iso_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def _date(offset_days: int) -> str:
    return (dt.date.today() + dt.timedelta(days=offset_days)).isoformat()


def _reminder(title: str, fire_offset_days: int, **extra) -> dict:
    fire_at = (
        dt.datetime.now() + dt.timedelta(days=fire_offset_days)
    ).replace(microsecond=0).isoformat()
    base = {
        "id": rem(),
        "title": title,
        "status": "pending",
        "fire_at": fire_at,
        "offset_rule": None,
        "recurrence_rule": None,
        "notes": None,
        "url": None,
        "login_hint": None,
        "attrs": {},
    }
    base.update(extra)
    return base


def build_events() -> list[dict]:
    """Four exemplar events, one per kind."""
    now = _iso_now()

    trip = {
        "id": evt(),
        "parent_id": None,
        "kind": "container",
        "subtype": "backpacking",
        "tags": ["travel", "outdoors"],
        "title": "Zion trip",
        "status": "planned",
        "start_date": _date(20),
        "end_date": _date(27),
        "recurrence_rule": None,
        "attrs": {"destination": "Zion NP, Utah", "budget": Decimal("2400"), "currency": "USD"},
        "items": [
            {
                "id": itm(),
                "kind": "reservation",
                "subtype": "flight",
                "tags": [],
                "title": "DL 442 JFK → LAS",
                "status": "confirmed",
                "scheduled_at": f"{_date(20)}T08:30:00",
                "due_at": None,
                "sort_order": 1,
                "confirmation_ref": "XKQP7R",
                "cost": Decimal("380"),
                "currency": "USD",
                "address": None,
                "phone": None,
                "url": "https://delta.com/manage",
                "login_hint": "me@email.com",
                "prereq_ids": [],
                "attrs": {"airline": "Delta", "seat": "14C"},
                "reminders": [_reminder("Check in online", 19)],
            }
        ],
        "reminders": [_reminder("Buy travel insurance", 5)],
        "checklists": [
            {
                "id": cl(),
                "template_id": None,
                "name": "Backpacking gear",
                "items": [
                    {"id": cli(), "label": "Tent", "checked": False, "needs_purchase": False, "purchased": False, "notes": None, "sort_order": 1},
                    {"id": cli(), "label": "Sunscreen SPF 50", "checked": False, "needs_purchase": True, "purchased": False, "notes": "REI", "sort_order": 2},
                ],
            }
        ],
        "attachments": [],
        "created_at": now,
        "updated_at": now,
    }

    dental = {
        "id": evt(),
        "parent_id": None,
        "kind": "occurrence",
        "subtype": "dental checkup",
        "tags": ["health"],
        "title": "6-month dental cleaning",
        "status": "active",
        "start_date": _date(40),
        "end_date": None,
        "recurrence_rule": "RRULE:FREQ=MONTHLY;INTERVAL=6",
        "attrs": {"dentist": "Dr. Park", "clinic": "Downtown Dental"},
        "items": [],
        "reminders": [_reminder("Confirm appointment", 39)],
        "checklists": [],
        "attachments": [],
        "created_at": now,
        "updated_at": now,
    }

    groceries = {
        "id": evt(),
        "parent_id": None,
        "kind": "list",
        "subtype": "groceries",
        "tags": ["home", "shopping"],
        "title": "Weekly groceries",
        "status": "active",
        "start_date": None,
        "end_date": None,
        "recurrence_rule": None,
        "attrs": {"store": "Whole Foods"},
        "items": [],
        "reminders": [],
        "checklists": [
            {
                "id": cl(),
                "template_id": None,
                "name": "Staples",
                "items": [
                    {"id": cli(), "label": "Milk", "checked": False, "needs_purchase": True, "purchased": False, "notes": None, "sort_order": 1},
                    {"id": cli(), "label": "Eggs", "checked": True, "needs_purchase": False, "purchased": True, "notes": None, "sort_order": 2},
                    {"id": cli(), "label": "Coffee beans", "checked": False, "needs_purchase": True, "purchased": False, "notes": None, "sort_order": 3},
                ],
            }
        ],
        "attachments": [],
        "created_at": now,
        "updated_at": now,
    }

    medication = {
        "id": evt(),
        "parent_id": None,
        "kind": "habit",
        "subtype": "medication",
        "tags": ["health", "daily"],
        "title": "Metformin 500mg — daily",
        "status": "active",
        "start_date": _date(-120),
        "end_date": None,
        "recurrence_rule": "RRULE:FREQ=DAILY",
        "attrs": {"prescriber": "Dr. Levi", "pharmacy": "CVS 86th St"},
        "items": [
            {
                "id": itm(),
                "kind": "entry",
                "subtype": "medication dose",
                "tags": [],
                "title": "Metformin 500mg",
                "status": "active",
                "scheduled_at": None,
                "due_at": None,
                "sort_order": 1,
                "confirmation_ref": None,
                "cost": None,
                "currency": None,
                "address": None,
                "phone": None,
                "url": None,
                "login_hint": None,
                "prereq_ids": [],
                "attrs": {"dosage": "500mg", "with_food": True},
                "reminders": [
                    _reminder("Take Metformin with breakfast", 1, recurrence_rule="RRULE:FREQ=DAILY;BYHOUR=8"),
                ],
            }
        ],
        "reminders": [],
        "checklists": [],
        "attachments": [],
        "created_at": now,
        "updated_at": now,
    }

    return [trip, dental, groceries, medication]


def index_rows(event: dict) -> list[dict]:
    """Flat reminders_index projection of an event's reminders."""
    rows: list[dict] = []

    def add(r: dict, item_id):
        if not r.get("fire_at"):
            return
        rows.append(
            {
                "id": r["id"],
                "event_id": event["id"],
                "item_id": item_id,
                "title": r.get("title", ""),
                "fire_at": r["fire_at"],
                "recurrence_rule": r.get("recurrence_rule"),
                "status": r.get("status", "pending"),
            }
        )

    for r in event.get("reminders", []):
        add(r, None)
    for it in event.get("items", []):
        for r in it.get("reminders", []):
            add(r, it["id"])
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user-id", required=True, help="Cognito sub of the target user")
    ap.add_argument("--table", required=True, help="DynamoDB table name (stack TableName output)")
    ap.add_argument("--region", default="us-east-1")
    args = ap.parse_args()

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table)
    events = build_events()

    with table.batch_writer() as bw:
        for event in events:
            bw.put_item(Item={"userId": args.user_id, "SK": f"EVENT#{event['id']}", **event})
            for row in index_rows(event):
                sk = f"REMIDX#{row['fire_at']}#{row['id']}"
                bw.put_item(Item={"userId": args.user_id, "SK": sk, **row})

    kinds: dict[str, int] = {}
    for e in events:
        kinds[e["kind"]] = kinds.get(e["kind"], 0) + 1
    print(f"Seeded {len(events)} events into {args.table} for user {args.user_id}")
    for k, n in sorted(kinds.items()):
        print(f"  {k:12} {n}")


if __name__ == "__main__":
    main()

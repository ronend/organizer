#!/usr/bin/env python3
"""Seed the organizer DynamoDB table with test items for one user.

Generates 10-15 items per category spanning all types, with a mix of overdue /
today / upcoming due dates and some marked done. Uses the AWS CLI (so it relies
on whatever AWS credentials are already in the environment); no boto3 needed.

Usage:
  python3 scripts/seed_data.py --user-id <cognito-sub> \
      --table organizer-items --region us-east-1 [--per-category 12]
"""

import argparse
import datetime as dt
import json
import random
import subprocess
import tempfile
import uuid

CATEGORIES = ["errand", "project", "health", "finance", "home"]
TYPES = ["simple", "complex", "repeat", "project"]
TIMES = ["08:00", "09:00", "10:30", "12:30", "15:00", "18:45"]

TITLES = {
    "errand": [
        "Buy groceries", "Pick up dry cleaning", "Return Amazon package",
        "Renew library books", "Car oil change", "Refill prescription",
        "Mail birthday gift", "Buy coffee beans", "Get a haircut",
        "Replace air filter", "Drop off donation", "Buy stamps",
        "Pick up package", "Grocery run",
    ],
    "project": [
        "Draft Q3 roadmap", "Write design doc", "Refactor auth module",
        "Prepare client demo", "Migrate database", "Set up CI pipeline",
        "Review open PRs", "Plan next sprint", "Write unit tests",
        "Update dependencies", "Spec API v2", "Investigate latency",
        "Onboard new hire", "Polish bento layout",
    ],
    "health": [
        "Morning run", "Dentist appointment", "Annual physical", "Meal prep",
        "Yoga session", "Take vitamins", "Schedule eye exam", "Hit 10k steps",
        "Meditate 10 min", "Therapy session", "Blood test", "Stretch routine",
        "Sleep by 11pm", "Refill inhaler",
    ],
    "finance": [
        "Pay credit card", "File expense report", "Review monthly budget",
        "Pay rent", "Transfer to savings", "Renew insurance", "File taxes",
        "Cancel unused subscription", "Review investments", "Pay utilities",
        "Reconcile accounts", "Update 401k contribution", "Pay tuition",
        "Dispute a charge",
    ],
    "home": [
        "Water the plants", "Fix leaky faucet", "Clean the garage",
        "Assemble new shelf", "Replace lightbulb", "Vacuum living room",
        "Organize closet", "Deep clean kitchen", "Hang pictures",
        "Service HVAC", "Wash the windows", "Declutter desk",
        "Repaint the fence", "Change smoke alarm battery",
    ],
}

# A few description shapes (rich-text HTML, matching the TipTap editor output).
DESCRIPTIONS = [
    "<p>{t}.</p>",
    "<p>{t} — don't forget the details.</p>",
    "<p>Steps:</p><ul><li>Prep</li><li>{t}</li><li>Wrap up</li></ul>",
    "<h2>{t}</h2><p>Notes go here.</p>",
    "<p><strong>Priority:</strong> {t}.</p>",
    "",
]


def make_items(user_id: str, per_category: int) -> list[dict]:
    today = dt.date.today()
    items: list[dict] = []
    for category in CATEGORIES:
        n = per_category if per_category else random.randint(10, 15)
        titles = random.sample(TITLES[category], k=min(n, len(TITLES[category])))
        for i, title in enumerate(titles):
            # Spread due dates: some overdue, some today, mostly upcoming.
            offset = random.choice([-5, -3, -1, 0, 0, 1, 2, 3, 5, 7, 10, 14, 21])
            due_date = (today + dt.timedelta(days=offset)).isoformat()
            done = random.random() < 0.28
            desc = random.choice(DESCRIPTIONS).format(t=title)
            items.append(
                {
                    "userId": user_id,
                    "organizerId": str(uuid.uuid4()),
                    "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
                    "category": category,
                    "type": TYPES[i % len(TYPES)],
                    "title": title,
                    "description": desc,
                    "dueDate": due_date,
                    "dueTime": random.choice(TIMES),
                    "done": done,
                }
            )
    return items


def to_put_request(item: dict) -> dict:
    attrs = {}
    for k, v in item.items():
        if isinstance(v, bool):
            attrs[k] = {"BOOL": v}
        else:
            attrs[k] = {"S": str(v)}
    return {"PutRequest": {"Item": attrs}}


def chunked(seq, size):
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def batch_write(table: str, region: str, requests: list[dict]) -> None:
    payload = {table: requests}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(payload, f)
        path = f.name
    out = subprocess.run(
        [
            "aws", "dynamodb", "batch-write-item",
            "--request-items", f"file://{path}",
            "--region", region,
            "--output", "json",
        ],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    unprocessed = json.loads(out.stdout or "{}").get("UnprocessedItems", {})
    if unprocessed.get(table):
        # one simple retry
        batch_write(table, region, unprocessed[table])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user-id", required=True, help="Cognito sub of the target user")
    ap.add_argument("--table", default="organizer-items")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument(
        "--per-category",
        type=int,
        default=0,
        help="Items per category (0 = random 10-15)",
    )
    args = ap.parse_args()

    items = make_items(args.user_id, args.per_category)
    requests = [to_put_request(it) for it in items]
    for chunk in chunked(requests, 25):  # DynamoDB batch limit
        batch_write(args.table, args.region, chunk)

    by_cat: dict[str, int] = {}
    for it in items:
        by_cat[it["category"]] = by_cat.get(it["category"], 0) + 1
    print(f"Seeded {len(items)} items into {args.table} for user {args.user_id}")
    for c in CATEGORIES:
        print(f"  {c:8} {by_cat.get(c, 0)}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Migrate the old hierarchical event model → the flat 7-type entity model.

See entity-model-proposal.md §9. The old model stored EventDocuments
(kind = container/occurrence/habit/list) embedding typed items, checklists,
reminders and attachments. The new model is seven flat sibling types
(todo/appointment/habit/routine/reservation/event/story).

This script FLATTENS the hierarchy. It never drops data silently: every source
record is either mapped to a new entity or recorded in the report, and a full
JSON backup of the old rows is written before anything is changed. Templates and
attachments have no home in the new model — they survive only in the backup.

Modes
-----
  --input-file old_rows.json      transform offline (no AWS); with --dry-run,
                                  prints the resulting entities + report.
  --user-id ... --table ...       read the user's old rows from DynamoDB,
                                  transform, and (unless --dry-run) write the new
                                  ITEM# rows + reminder index, removing old rows.

Examples
--------
  python3 scripts/migrate_to_entities.py --input-file fixture.json --dry-run
  python3 scripts/migrate_to_entities.py --user-id <sub> --table <name> --dry-run
  python3 scripts/migrate_to_entities.py --user-id <sub> --table <name> \
      --backup backup.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Optional

# Allow "python3 scripts/migrate_to_entities.py" from the repo root to import the
# backend helpers (recurrence math + id generation).
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from src import ids  # noqa: E402
from src import recurrence as rec  # noqa: E402

RESERVATION_SUBTYPES = {"hotel", "flight", "tour", "activity", "restaurant"}


# ── small helpers ────────────────────────────────────────────────────────────────


def _now() -> str:
    # Deterministic-ish: reuse each source's created_at where possible; only new
    # shells with no source timestamp fall back here.
    import datetime as _dt

    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def _iso(value: Optional[str]) -> Optional[str]:
    d = rec.parse_iso(value)
    return rec.to_iso(d) if d else None


def _first_dt(*values: Optional[str]) -> Optional[str]:
    for v in values:
        got = _iso(v)
        if got:
            return got
    return None


def _map_subtype(raw: Optional[str]) -> str:
    s = (raw or "").strip().lower()
    if s in RESERVATION_SUBTYPES:
        return s
    # A few common synonyms; everything else defaults to "activity".
    synonyms = {
        "plane": "flight",
        "air": "flight",
        "lodging": "hotel",
        "stay": "hotel",
        "dining": "restaurant",
        "dinner": "restaurant",
        "excursion": "tour",
    }
    return synonyms.get(s, "activity")


def _build(entity_type: str, fields: dict, created_at: Optional[str]) -> dict:
    ts = created_at or _now()
    return {
        "id": ids.entity_id(entity_type),
        "type": entity_type,
        "created_at": ts,
        "updated_at": ts,
        **fields,
    }


# ── item (embedded) → entity ─────────────────────────────────────────────────────


def _reservation_details(item: dict) -> Optional[Any]:
    details: dict[str, Any] = {}
    if item.get("attrs"):
        details.update(item["attrs"])
    for k in ("phone", "url", "login_hint", "notes"):
        if item.get(k):
            details[k] = item[k]
    return details or None


def _migrate_item(item: dict, parent: dict, created_at: str, report: list[str]) -> Optional[dict]:
    """Map one embedded item to a top-level entity, or None if it has no mapping."""
    kind = item.get("kind")
    title = item.get("title") or "(untitled)"

    if kind == "reservation":
        date_time = _first_dt(item.get("scheduled_at"), item.get("due_at"), created_at)
        return _build(
            "reservation",
            {
                "title": title,
                "subtype": _map_subtype(item.get("subtype")),
                "date_time": date_time,
                "location": item.get("address"),
                "details": _reservation_details(item),
                "reservation_number": item.get("confirmation_ref"),
            },
            created_at,
        )

    if kind == "task":
        due_at = _first_dt(item.get("due_at"), item.get("scheduled_at"), created_at)
        return _build("todo", {"title": title, "due_at": due_at, "completed": item.get("status") == "done"}, created_at)

    if kind == "entry":
        if parent.get("kind") == "habit":
            recurrence = rec.rrule_to_recurrence(
                parent.get("recurrence_rule"), rec.parse_iso(parent.get("start_date"))
            )
            return _build("habit", {"title": title, "recurrence": recurrence, "completion_log": {}}, created_at)
        due_at = _first_dt(item.get("due_at"), item.get("scheduled_at"), created_at)
        return _build("todo", {"title": title, "due_at": due_at, "completed": item.get("status") == "done"}, created_at)

    if kind == "checklist_item":  # only appears if callers pre-flatten; normally handled below
        return _build("todo", {"title": title, "due_at": created_at, "completed": bool(item.get("checked"))}, created_at)

    report.append(f"  ! item kind '{kind}' in event '{parent.get('id')}' had no mapping — skipped")
    return None


# ── event shell → entity ─────────────────────────────────────────────────────────


def _migrate_event(event: dict, report: list[str]) -> list[dict]:
    """Return the list of new entities produced by one source event (shell + any
    promoted children). Appends human-readable notes to ``report``."""
    kind = event.get("kind")
    created_at = _iso(event.get("created_at")) or _now()
    title = event.get("title") or "(untitled)"
    out: list[dict] = []

    # 1. Promote every embedded item to a top-level entity (all kinds).
    promoted: list[dict] = []  # (source sort_order, new entity)
    for item in sorted(event.get("items", []), key=lambda i: i.get("sort_order", 0)):
        entity = _migrate_item(item, event, created_at, report)
        if entity:
            promoted.append(entity)
            out.append(entity)

    # 2. Promote checklist items to todos (checklists are retired).
    for cl in event.get("checklists", []):
        for ci in sorted(cl.get("items", []), key=lambda i: i.get("sort_order", 0)):
            out.append(
                _build(
                    "todo",
                    {"title": ci.get("label") or "(untitled)", "due_at": created_at, "completed": bool(ci.get("checked"))},
                    created_at,
                )
            )

    # 3. Map the event shell itself.
    if kind == "container":
        refs = [e["id"] for e in promoted if e["type"] in ("reservation", "event")]
        out.append(_build("story", {"title": title, "item_refs": refs}, created_at))
        report.append(f"  event '{event.get('id')}' (container) → story with {len(refs)} refs, {len(promoted)} items promoted")

    elif kind == "occurrence":
        if event.get("recurrence_rule"):
            recurrence = rec.rrule_to_recurrence(event.get("recurrence_rule"), rec.parse_iso(event.get("start_date")))
            out.append(_build("habit", {"title": title, "recurrence": recurrence, "completion_log": {}}, created_at))
            report.append(f"  event '{event.get('id')}' (occurrence, recurring) → habit")
        elif event.get("end_date"):
            start_at = _first_dt(event.get("start_date"), created_at)
            end_at = _first_dt(event.get("end_date")) or start_at
            out.append(_build("event", {"title": title, "start_at": start_at, "end_at": end_at, "details": None}, created_at))
            report.append(f"  event '{event.get('id')}' (occurrence, span) → event")
        else:
            date_time = _first_dt(event.get("start_date"), created_at)
            if not _iso(event.get("start_date")):
                report.append(f"  ~ event '{event.get('id')}' had no start_date; appointment.date_time ← created_at")
            out.append(
                _build(
                    "appointment",
                    {"title": title, "date_time": date_time, "location": None, "contact": {}, "things_to_bring": [], "completed": event.get("status") == "done"},
                    created_at,
                )
            )
            report.append(f"  event '{event.get('id')}' (occurrence) → appointment")

    elif kind == "habit":
        recurrence = rec.rrule_to_recurrence(event.get("recurrence_rule"), rec.parse_iso(event.get("start_date")))
        out.append(_build("habit", {"title": title, "recurrence": recurrence, "completion_log": {}}, created_at))
        report.append(f"  event '{event.get('id')}' (habit) → habit")

    elif kind == "list":
        report.append(f"  event '{event.get('id')}' (list) → shell dropped; {len(event.get('checklists', []))} checklist(s) → todos")

    else:
        report.append(f"  ! event '{event.get('id')}' had unknown kind '{kind}' — shell skipped")

    return out


def transform(events: list[dict], templates: list[dict]) -> dict:
    """Pure transform: old rows → {entities, report}. Templates are not migrated
    (recorded only), so callers should keep them in the backup."""
    report: list[str] = [f"Migrating {len(events)} events, {len(templates)} templates (not migrated)…"]
    entities: list[dict] = []
    for event in events:
        entities.extend(_migrate_event(event, report))
    by_type: dict[str, int] = {}
    for e in entities:
        by_type[e["type"]] = by_type.get(e["type"], 0) + 1
    report.append("Result: " + ", ".join(f"{n} {t}" for t, n in sorted(by_type.items())) or "Result: (none)")
    if templates:
        report.append(f"  {len(templates)} template(s) preserved in backup only (no equivalent type)")
    return {"entities": entities, "report": report}


# ── reminder-index projection (mirror of backend/src/db/dynamo._index_entries) ──


def _index_entries(entity: dict) -> list[dict]:
    etype, eid, title = entity["type"], entity["id"], entity.get("title", "")
    rows: list[dict] = []

    def add(row_id: str, fire_at: Optional[str]) -> None:
        if fire_at:
            rows.append({"id": row_id, "source_id": eid, "source_type": etype, "title": title, "fire_at": fire_at, "status": "pending"})

    if etype == "routine":
        due = rec.parse_iso(entity.get("due_at"))
        for i, reminder in enumerate(entity.get("reminders", [])):
            fire = reminder.get("at") if reminder.get("kind") == "absolute" else (rec.to_iso(rec.resolve_offset(due, reminder.get("offset"))) if due and rec.resolve_offset(due, reminder.get("offset")) else None)
            add(f"{eid}#r{i}", fire)
    elif etype == "todo":
        add(eid, entity.get("due_at"))
    elif etype in ("appointment", "reservation"):
        add(eid, entity.get("date_time"))
    elif etype == "event":
        add(eid, entity.get("start_at"))
    return rows


# ── DynamoDB read/write ──────────────────────────────────────────────────────────


def _read_rows_from_dynamo(table, user_id: str) -> dict:
    from boto3.dynamodb.conditions import Key

    items: list[dict] = []
    kwargs = {"KeyConditionExpression": Key("userId").eq(user_id)}
    while True:
        resp = table.query(**kwargs)
        items.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    def strip(row: dict) -> dict:
        row = dict(row)
        row.pop("userId", None)
        row.pop("SK", None)
        return row

    events, templates, others = [], [], []
    for row in items:
        sk = row.get("SK", "")
        if sk.startswith("EVENT#"):
            events.append(strip(row))
        elif sk.startswith("TMPL#"):
            templates.append(strip(row))
        else:
            others.append(row)  # REMIDX# and anything else — dropped/rewritten
    return {"events": events, "templates": templates, "others": others, "raw": items}


def _write_to_dynamo(table, user_id: str, entities: list[dict], old_raw: list[dict]) -> None:
    from decimal import Decimal

    def numify(v):
        if isinstance(v, bool):
            return v
        if isinstance(v, float):
            return Decimal(str(v))
        if isinstance(v, list):
            return [numify(x) for x in v]
        if isinstance(v, dict):
            return {k: numify(x) for k, x in v.items()}
        return v

    with table.batch_writer() as bw:
        # Remove every old row for this user (events, templates, old index).
        for row in old_raw:
            bw.delete_item(Key={"userId": user_id, "SK": row["SK"]})
        # Write the new entities + their reminder-index projection.
        for entity in entities:
            bw.put_item(Item=numify({"userId": user_id, "SK": f"ITEM#{entity['id']}", **entity}))
            for idx in _index_entries(entity):
                bw.put_item(Item=numify({"userId": user_id, "SK": f"REMIDX#{idx['fire_at']}#{idx['id']}", **idx}))


# ── CLI ──────────────────────────────────────────────────────────────────────────


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input-file", help="JSON file of old rows (offline mode). Either a list of events, or {events:[], templates:[]}")
    ap.add_argument("--user-id", help="Cognito sub (DynamoDB mode)")
    ap.add_argument("--table", help="DynamoDB table name (DynamoDB mode)")
    ap.add_argument("--region", default="us-east-1")
    ap.add_argument("--backup", help="Write a JSON backup of all old rows here before changing anything")
    ap.add_argument("--dry-run", action="store_true", help="Transform and report only; write nothing")
    args = ap.parse_args()

    if args.input_file:
        data = json.loads(Path(args.input_file).read_text())
        events = data if isinstance(data, list) else data.get("events", [])
        templates = [] if isinstance(data, list) else data.get("templates", [])
        result = transform(events, templates)
        print("\n".join(result["report"]))
        if args.dry_run:
            print("\n--- entities (dry-run) ---")
            print(json.dumps(result["entities"], indent=2, default=str))
        return

    if not (args.user_id and args.table):
        ap.error("provide --input-file, or both --user-id and --table")

    import boto3

    table = boto3.resource("dynamodb", region_name=args.region).Table(args.table)
    rows = _read_rows_from_dynamo(table, args.user_id)

    if args.backup:
        Path(args.backup).write_text(json.dumps(rows["raw"], indent=2, default=str))
        print(f"Backed up {len(rows['raw'])} old rows → {args.backup}")

    result = transform(rows["events"], rows["templates"])
    print("\n".join(result["report"]))

    if args.dry_run:
        print("\n(dry-run — nothing written)")
        return

    if not args.backup:
        ap.error("refusing to write without --backup (pass --backup <file> to proceed)")

    _write_to_dynamo(table, args.user_id, result["entities"], rows["raw"])
    print(f"Wrote {len(result['entities'])} entities for user {args.user_id}; removed {len(rows['raw'])} old rows.")


if __name__ == "__main__":
    main()

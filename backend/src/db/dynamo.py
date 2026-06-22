"""DynamoDB data layer for the event model (see data-structure.md).

Single table, partition key ``userId``. The three logical collections share the
partition and are separated by sort-key (``SK``) prefixes:

    EVENT#<event_id>                 → an EventDocument (items/reminders/
                                       checklists/attachments embedded)
    REMIDX#<fire_at>#<reminder_id>   → a flat ReminderIndexEntry projection
    TMPL#<template_id>               → a reusable checklist Template

The reminders_index rows are a write-through projection of every reminder across
all events — never the source of truth. They are re-synced on every event write
and deleted with their event. boto3 is provided by the Lambda runtime.
"""

import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from src import ids
from src import recurrence as rec

_TABLE_NAME = os.environ["DYNAMO_TABLE"]
_table = boto3.resource("dynamodb").Table(_TABLE_NAME)

EVENT_PREFIX = "EVENT#"
REMIDX_PREFIX = "REMIDX#"
TMPL_PREFIX = "TMPL#"


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


def _get(d: dict, key: str, default: Any) -> Any:
    val = d.get(key, default)
    return default if val is None else val


# ── Subdocument builders (assign ids, fill defaults, compute fire_at) ──────────


def _build_reminder(raw: dict, parent_date: Optional[datetime]) -> dict:
    raw = raw or {}
    offset_rule = raw.get("offset_rule")
    fire_at = raw.get("fire_at") or ""
    # Resolve offset_rule against the parent date when possible; otherwise keep
    # whatever fire_at was supplied.
    if offset_rule and parent_date is not None:
        computed = rec.resolve_offset(parent_date, offset_rule)
        if computed is not None:
            fire_at = rec.to_iso(computed)
    return {
        "id": raw.get("id") or ids.reminder_id(),
        "title": _get(raw, "title", ""),
        "status": _get(raw, "status", "pending"),
        "fire_at": fire_at,
        "offset_rule": offset_rule,
        "recurrence_rule": raw.get("recurrence_rule"),
        "notes": raw.get("notes"),
        "url": raw.get("url"),
        "login_hint": raw.get("login_hint"),
        "attrs": _get(raw, "attrs", {}),
    }


def _build_checklist_item(raw: dict) -> dict:
    raw = raw or {}
    return {
        "id": raw.get("id") or ids.checklist_item_id(),
        "label": _get(raw, "label", ""),
        "checked": bool(raw.get("checked", False)),
        "needs_purchase": bool(raw.get("needs_purchase", False)),
        "purchased": bool(raw.get("purchased", False)),
        "notes": raw.get("notes"),
        "sort_order": _get(raw, "sort_order", 0),
    }


def _build_checklist(raw: dict) -> dict:
    raw = raw or {}
    return {
        "id": raw.get("id") or ids.checklist_id(),
        "template_id": raw.get("template_id"),
        "name": _get(raw, "name", ""),
        "items": [_build_checklist_item(i) for i in _get(raw, "items", [])],
    }


def _build_attachment(raw: dict) -> dict:
    raw = raw or {}
    return {
        "id": raw.get("id") or ids.attachment_id(),
        "label": _get(raw, "label", ""),
        "item_id": raw.get("item_id"),
        "mime_type": raw.get("mime_type"),
        "url": raw.get("url"),
        "storage_key": raw.get("storage_key"),
    }


def _build_item(raw: dict) -> dict:
    raw = raw or {}
    # An item's reminders are relative to when the item happens / is due.
    parent_date = rec.parse_iso(raw.get("scheduled_at")) or rec.parse_iso(raw.get("due_at"))
    return {
        "id": raw.get("id") or ids.item_id(),
        "kind": _get(raw, "kind", "task"),
        "subtype": _get(raw, "subtype", ""),
        "tags": _get(raw, "tags", []),
        "title": _get(raw, "title", ""),
        "status": _get(raw, "status", "todo"),
        "scheduled_at": raw.get("scheduled_at"),
        "due_at": raw.get("due_at"),
        "sort_order": _get(raw, "sort_order", 0),
        "confirmation_ref": raw.get("confirmation_ref"),
        "cost": raw.get("cost"),
        "currency": raw.get("currency"),
        "address": raw.get("address"),
        "phone": raw.get("phone"),
        "url": raw.get("url"),
        "login_hint": raw.get("login_hint"),
        "prereq_ids": _get(raw, "prereq_ids", []),
        "attrs": _get(raw, "attrs", {}),
        "reminders": [_build_reminder(r, parent_date) for r in _get(raw, "reminders", [])],
    }


def _build_event(user_id: str, raw: dict, existing: Optional[dict] = None) -> dict:
    """Assemble a canonical EventDocument: assign missing ids, fill defaults,
    resolve reminder fire_at. ``existing`` preserves id/created_at on update."""
    raw = raw or {}
    event_id = (existing or {}).get("id") or raw.get("id") or ids.event_id()
    created_at = (existing or {}).get("created_at") or raw.get("created_at") or _now()
    parent_date = rec.parse_iso(raw.get("start_date"))
    return {
        "id": event_id,
        "parent_id": raw.get("parent_id"),
        "kind": _get(raw, "kind", "list"),
        "subtype": _get(raw, "subtype", ""),
        "tags": _get(raw, "tags", []),
        "title": _get(raw, "title", ""),
        "status": _get(raw, "status", "planned"),
        "start_date": raw.get("start_date"),
        "end_date": raw.get("end_date"),
        "recurrence_rule": raw.get("recurrence_rule"),
        "attrs": _get(raw, "attrs", {}),
        "items": [_build_item(i) for i in _get(raw, "items", [])],
        "reminders": [_build_reminder(r, parent_date) for r in _get(raw, "reminders", [])],
        "checklists": [_build_checklist(c) for c in _get(raw, "checklists", [])],
        "attachments": [_build_attachment(a) for a in _get(raw, "attachments", [])],
        "created_at": created_at,
        "updated_at": _now(),
    }


# ── Reminder index projection ──────────────────────────────────────────────────


def _index_entries(event: dict) -> list[dict]:
    """Flatten every reminder in an event (event-level + per-item) into index
    entry dicts. Only reminders with a non-empty fire_at are indexable."""
    out: list[dict] = []

    def add(rem: dict, item_id: Optional[str]) -> None:
        fire_at = rem.get("fire_at")
        if not fire_at:
            return
        out.append(
            {
                "id": rem["id"],
                "event_id": event["id"],
                "item_id": item_id,
                "title": rem.get("title", ""),
                "fire_at": fire_at,
                "recurrence_rule": rem.get("recurrence_rule"),
                "status": rem.get("status", "pending"),
            }
        )

    for rem in event.get("reminders", []):
        add(rem, None)
    for item in event.get("items", []):
        for rem in item.get("reminders", []):
            add(rem, item["id"])
    return out


def _delete_index_for_event(user_id: str, event_id: str) -> None:
    resp = _table.query(
        KeyConditionExpression=Key("userId").eq(user_id)
        & Key("SK").begins_with(REMIDX_PREFIX),
        FilterExpression="event_id = :e",
        ExpressionAttributeValues={":e": event_id},
    )
    rows = resp.get("Items", [])
    if not rows:
        return
    with _table.batch_writer() as bw:
        for row in rows:
            bw.delete_item(Key={"userId": user_id, "SK": row["SK"]})


def _sync_index(user_id: str, event: dict) -> None:
    """Write-through: replace this event's index rows with a fresh projection."""
    _delete_index_for_event(user_id, event["id"])
    entries = _index_entries(event)
    if not entries:
        return
    with _table.batch_writer() as bw:
        for entry in entries:
            sk = f"{REMIDX_PREFIX}{entry['fire_at']}#{entry['id']}"
            bw.put_item(Item=_numify({"userId": user_id, "SK": sk, **entry}))


# ── Event persistence ──────────────────────────────────────────────────────────


def _put_event(user_id: str, event: dict) -> None:
    item = {"userId": user_id, "SK": f"{EVENT_PREFIX}{event['id']}", **event}
    _table.put_item(Item=_numify(item))


def _strip(item: dict) -> dict:
    """Drop internal table keys, returning the bare document."""
    out = _plain(item)
    out.pop("userId", None)
    out.pop("SK", None)
    return out


def list_events(user_id: str) -> list[dict]:
    resp = _table.query(
        KeyConditionExpression=Key("userId").eq(user_id)
        & Key("SK").begins_with(EVENT_PREFIX)
    )
    return [_strip(i) for i in resp.get("Items", [])]


def get_event(user_id: str, event_id: str) -> Optional[dict]:
    resp = _table.get_item(Key={"userId": user_id, "SK": f"{EVENT_PREFIX}{event_id}"})
    item = resp.get("Item")
    return _strip(item) if item else None


def create_event(user_id: str, data: dict) -> dict:
    event = _build_event(user_id, data)
    _apply_matching_templates(user_id, event)
    _put_event(user_id, event)
    _sync_index(user_id, event)
    return event


def update_event(user_id: str, event_id: str, updates: dict) -> Optional[dict]:
    existing = get_event(user_id, event_id)
    if existing is None:
        return None
    # Merge: provided top-level fields replace; everything else is preserved.
    merged = {**existing, **updates}
    event = _build_event(user_id, merged, existing=existing)
    _put_event(user_id, event)
    _sync_index(user_id, event)
    return event


def delete_event(user_id: str, event_id: str) -> bool:
    existing = get_event(user_id, event_id)
    if existing is None:
        return False
    _table.delete_item(Key={"userId": user_id, "SK": f"{EVENT_PREFIX}{event_id}"})
    _delete_index_for_event(user_id, event_id)
    return True


def complete_event_occurrence(user_id: str, event_id: str) -> Optional[dict]:
    """Mark an event done. If it carries a recurrence_rule, generate the next
    occurrence as a fresh event document (copying structure, resetting state).
    Returns {"completed": <event>, "next": <event|None>}, or None if missing.
    """
    existing = get_event(user_id, event_id)
    if existing is None:
        return None

    completed = {**existing, "status": "done"}
    completed = _build_event(user_id, completed, existing=existing)
    _put_event(user_id, completed)
    _sync_index(user_id, completed)

    nxt = None
    rule = existing.get("recurrence_rule")
    prev = rec.parse_iso(existing.get("start_date"))
    if rule and prev is not None:
        nxt_date = rec.next_occurrence(prev, rule)
        if nxt_date is not None:
            nxt = _spawn_next_occurrence(user_id, existing, nxt_date)

    return {"completed": completed, "next": nxt}


def _spawn_next_occurrence(user_id: str, prev: dict, next_start: datetime) -> dict:
    """Copy an event's structure into a new occurrence: new ids, reset statuses,
    cleared fire_at (recomputed from the new start_date via offset_rule)."""
    span_days = 0
    start_prev = rec.parse_iso(prev.get("start_date"))
    end_prev = rec.parse_iso(prev.get("end_date"))
    if start_prev and end_prev:
        span_days = (end_prev - start_prev).days
    new_start = rec.to_date_str(next_start)
    new_end = rec.to_date_str(next_start + _rec_timedelta(span_days)) if end_prev else None

    def reset_reminder(r: dict) -> dict:
        return {**r, "id": None, "status": "pending", "fire_at": ""}

    def reset_item(i: dict) -> dict:
        return {
            **i,
            "id": None,
            "status": "todo",
            # drop absolute dates on the copy; the user re-times the occurrence
            "reminders": [reset_reminder(r) for r in i.get("reminders", [])],
        }

    template = {
        **prev,
        "id": None,
        "status": "planned",
        "start_date": new_start,
        "end_date": new_end,
        "items": [reset_item(i) for i in prev.get("items", [])],
        "reminders": [reset_reminder(r) for r in prev.get("reminders", [])],
        "created_at": None,
    }
    nxt = _build_event(user_id, template)
    _put_event(user_id, nxt)
    _sync_index(user_id, nxt)
    return nxt


def _rec_timedelta(days: int):
    from datetime import timedelta

    return timedelta(days=days)


# ── Templates ───────────────────────────────────────────────────────────────────


def _build_template(raw: dict, existing: Optional[dict] = None) -> dict:
    raw = raw or {}
    tmpl_id = (existing or {}).get("id") or raw.get("id") or ids.template_id(raw.get("name", ""))
    created_at = (existing or {}).get("created_at") or _now()
    items = []
    for i in _get(raw, "items", []):
        items.append(
            {
                "id": i.get("id") or ids.nanoid(6),
                "label": _get(i, "label", ""),
                "category": i.get("category"),
                "needs_purchase": bool(i.get("needs_purchase", False)),
                "sort_order": _get(i, "sort_order", 0),
                "default_reminder_offset": i.get("default_reminder_offset"),
                "notes": i.get("notes"),
            }
        )
    return {
        "id": tmpl_id,
        "name": _get(raw, "name", ""),
        "applies_to_subtype": raw.get("applies_to_subtype"),
        "auto_apply": bool(raw.get("auto_apply", False)),
        "description": raw.get("description"),
        "tags": _get(raw, "tags", []),
        "items": items,
        "created_at": created_at,
        "updated_at": _now(),
    }


def list_templates(user_id: str) -> list[dict]:
    resp = _table.query(
        KeyConditionExpression=Key("userId").eq(user_id)
        & Key("SK").begins_with(TMPL_PREFIX)
    )
    return [_strip(i) for i in resp.get("Items", [])]


def get_template(user_id: str, template_id: str) -> Optional[dict]:
    resp = _table.get_item(Key={"userId": user_id, "SK": f"{TMPL_PREFIX}{template_id}"})
    item = resp.get("Item")
    return _strip(item) if item else None


def _put_template(user_id: str, tmpl: dict) -> None:
    item = {"userId": user_id, "SK": f"{TMPL_PREFIX}{tmpl['id']}", **tmpl}
    _table.put_item(Item=_numify(item))


def create_template(user_id: str, data: dict) -> dict:
    tmpl = _build_template(data)
    _put_template(user_id, tmpl)
    return tmpl


def update_template(user_id: str, template_id: str, updates: dict) -> Optional[dict]:
    existing = get_template(user_id, template_id)
    if existing is None:
        return None
    tmpl = _build_template({**existing, **updates}, existing=existing)
    _put_template(user_id, tmpl)
    return tmpl


def delete_template(user_id: str, template_id: str) -> bool:
    existing = get_template(user_id, template_id)
    if existing is None:
        return False
    _table.delete_item(Key={"userId": user_id, "SK": f"{TMPL_PREFIX}{template_id}"})
    return True


def _apply_matching_templates(user_id: str, event: dict) -> None:
    """On event create: for every auto_apply template whose applies_to_subtype
    matches the event's subtype, instantiate a checklist (snapshot of the
    template items) and create event-level reminders for items that carry a
    default_reminder_offset. Mutates ``event`` in place."""
    subtype = (event.get("subtype") or "").strip().lower()
    if not subtype:
        return
    matches = [
        t
        for t in list_templates(user_id)
        if t.get("auto_apply")
        and (t.get("applies_to_subtype") or "").strip().lower() == subtype
    ]
    if not matches:
        return
    start = rec.parse_iso(event.get("start_date"))
    for tmpl in matches:
        checklist = {
            "id": ids.checklist_id(),
            "template_id": tmpl["id"],
            "name": tmpl.get("name", ""),
            "items": [],
        }
        for ti in tmpl.get("items", []):
            checklist["items"].append(
                _build_checklist_item(
                    {
                        "label": ti.get("label", ""),
                        "needs_purchase": ti.get("needs_purchase", False),
                        "sort_order": ti.get("sort_order", 0),
                        "notes": ti.get("notes"),
                    }
                )
            )
            offset = ti.get("default_reminder_offset")
            if offset and start is not None:
                event["reminders"].append(
                    _build_reminder(
                        {
                            "title": ti.get("label", ""),
                            "offset_rule": offset,
                            "notes": ti.get("notes"),
                        },
                        start,
                    )
                )
        event["checklists"].append(checklist)


# ── reminders_index queries + derived views ────────────────────────────────────


def upcoming_reminders(
    user_id: str,
    before_iso: Optional[str] = None,
    status: Optional[str] = "pending",
    limit: int = 50,
) -> list[dict]:
    """Query the flat index ordered by fire_at (SK sorts lexicographically,
    which matches ISO 8601 chronological order)."""
    cond = Key("userId").eq(user_id) & Key("SK").begins_with(REMIDX_PREFIX)
    filters = []
    values: dict[str, Any] = {}
    if status is not None:
        filters.append("#s = :st")
        values[":st"] = status
    if before_iso is not None:
        filters.append("fire_at <= :b")
        values[":b"] = before_iso
    kwargs: dict[str, Any] = {"KeyConditionExpression": cond}
    if filters:
        kwargs["FilterExpression"] = " AND ".join(filters)
        kwargs["ExpressionAttributeValues"] = values
        if status is not None:
            kwargs["ExpressionAttributeNames"] = {"#s": "status"}
    resp = _table.query(**kwargs)
    rows = [_strip(i) for i in resp.get("Items", [])]
    return rows[:limit]


def shopping_list(user_id: str) -> list[dict]:
    """Derived view: every checklist item that needs purchasing and isn't yet
    purchased, across all events, annotated with event/checklist context."""
    out: list[dict] = []
    for event in list_events(user_id):
        for cl in event.get("checklists", []):
            for ci in cl.get("items", []):
                if ci.get("needs_purchase") and not ci.get("purchased"):
                    out.append(
                        {
                            **ci,
                            "event_id": event["id"],
                            "event_title": event.get("title", ""),
                            "checklist_id": cl["id"],
                            "checklist_name": cl.get("name", ""),
                        }
                    )
    out.sort(key=lambda x: (x.get("event_title", ""), x.get("sort_order", 0)))
    return out

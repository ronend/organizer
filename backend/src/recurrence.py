"""Recurrence + reminder-offset math for the event model (data-structure.md).

Two concerns:

1. ``recurrence_rule`` — an RFC 5545 RRULE string on an event. We support the
   common subset FREQ=DAILY|WEEKLY|MONTHLY|YEARLY with optional INTERVAL. Used
   to generate the *next* occurrence document when one is marked done.

2. ``offset_rule`` — a relative reminder rule ("-30d", "-4w", "-2h", "+1d",
   "0"). Resolved against a parent date (event.start_date or item.scheduled_at)
   to compute the reminder's absolute ``fire_at``.
"""

import re
from datetime import datetime, timedelta
from typing import Optional


# ── Date parsing helpers ──────────────────────────────────────────────────────


def parse_iso(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO 8601 date or datetime. Returns None if empty/invalid."""
    if not value:
        return None
    v = value.strip()
    if not v:
        return None
    # Accept a trailing Z (UTC) which datetime.fromisoformat rejects pre-3.11.
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    try:
        if len(v) == 10:  # date only "YYYY-MM-DD"
            return datetime.fromisoformat(v + "T00:00:00")
        return datetime.fromisoformat(v)
    except ValueError:
        return None


def to_iso(d: datetime) -> str:
    return d.replace(microsecond=0).isoformat()


def to_date_str(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


# ── offset_rule resolution ─────────────────────────────────────────────────────

_OFFSET_RE = re.compile(r"^([+-]?)(\d+)\s*([smhdw])$", re.IGNORECASE)
_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}


def resolve_offset(parent: datetime, offset_rule: Optional[str]) -> Optional[datetime]:
    """Apply an offset_rule ("-30d", "-2h", "+1d", "0") to a parent datetime.

    Returns the computed fire_at, or None if the rule is unparseable.
    """
    if offset_rule is None:
        return None
    rule = offset_rule.strip().lower()
    if rule in ("0", "+0", "-0", ""):
        return parent
    m = _OFFSET_RE.match(rule)
    if not m:
        return None
    sign, num, unit = m.group(1), int(m.group(2)), m.group(3)
    delta = timedelta(seconds=num * _UNIT_SECONDS[unit])
    return parent - delta if sign == "-" else parent + delta


# ── RRULE next-occurrence ───────────────────────────────────────────────────────


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (datetime(year, month + 1, 1) - timedelta(days=1)).day


def _add_months(d: datetime, months: int) -> datetime:
    total = (d.year * 12 + (d.month - 1)) + months
    year, month0 = divmod(total, 12)
    month = month0 + 1
    day = min(d.day, _days_in_month(year, month))
    return d.replace(year=year, month=month, day=day)


def _parse_rrule(rule: str) -> dict:
    """Parse "RRULE:FREQ=MONTHLY;INTERVAL=6" into {FREQ, INTERVAL}."""
    body = rule.split(":", 1)[1] if ":" in rule else rule
    parts: dict[str, str] = {}
    for chunk in body.split(";"):
        if "=" in chunk:
            k, v = chunk.split("=", 1)
            parts[k.strip().upper()] = v.strip().upper()
    return parts


def next_occurrence(prev: datetime, recurrence_rule: str) -> Optional[datetime]:
    """Next occurrence strictly after ``prev`` per the RRULE. None if unsupported."""
    parts = _parse_rrule(recurrence_rule)
    freq = parts.get("FREQ")
    try:
        interval = max(1, int(parts.get("INTERVAL", "1")))
    except ValueError:
        interval = 1

    if freq == "DAILY":
        return prev + timedelta(days=interval)
    if freq == "WEEKLY":
        return prev + timedelta(weeks=interval)
    if freq == "MONTHLY":
        return _add_months(prev, interval)
    if freq == "YEARLY":
        return _add_months(prev, 12 * interval)
    return None

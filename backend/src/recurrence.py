"""Recurrence + reminder-offset math (see entity-model-proposal.md).

Three concerns:

1. Structured habit ``recurrence`` — a small tagged dict
   ({"freq": "daily"|"weekly"|"every_n_days"|"monthly", ...}). ``next_recurrence``
   returns the next occurrence strictly after a given date.

2. ``offset`` reminder rules ("-30d", "-2h", "+1d", "0") on a routine. Resolved
   against the routine's ``due_at`` to compute an absolute reminder time.

3. Legacy RFC 5545 RRULE parsing — kept only so the migration script can convert
   old ``recurrence_rule`` strings into the structured habit ``recurrence``.
"""

import re
from datetime import datetime, timedelta
from typing import Optional

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


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


# ── Structured habit recurrence ─────────────────────────────────────────────────


def next_recurrence(prev: datetime, rule: dict) -> Optional[datetime]:
    """Next occurrence strictly after ``prev`` for a structured recurrence rule.

    Supported shapes (see entity-model-proposal.md §4):
      {"freq": "daily", "interval": N}
      {"freq": "weekly", "interval": N, "days": ["mon", ...]}
      {"freq": "every_n_days", "n": N}
      {"freq": "monthly", "interval": N, "day_of_month": D}
    Returns None if the rule is malformed/unsupported.
    """
    if not isinstance(rule, dict):
        return None
    freq = rule.get("freq")

    if freq == "daily":
        interval = max(1, int(rule.get("interval", 1) or 1))
        return prev + timedelta(days=interval)

    if freq == "every_n_days":
        n = max(1, int(rule.get("n", 1) or 1))
        return prev + timedelta(days=n)

    if freq == "weekly":
        days = [d for d in (rule.get("days") or []) if d in WEEKDAYS]
        if not days:
            return None
        wanted = {WEEKDAYS.index(d) for d in days}
        # Walk forward day by day to the next matching weekday.
        for step in range(1, 8):
            cand = prev + timedelta(days=step)
            if cand.weekday() in wanted:
                return cand
        return None

    if freq == "monthly":
        interval = max(1, int(rule.get("interval", 1) or 1))
        dom = int(rule.get("day_of_month", prev.day) or prev.day)
        nxt = _add_months(prev, interval)
        day = min(max(1, dom), _days_in_month(nxt.year, nxt.month))
        return nxt.replace(day=day)

    return None


def rrule_to_recurrence(rrule: Optional[str], start: Optional[datetime]) -> dict:
    """Best-effort convert a legacy RRULE string into a structured recurrence.

    Used by the migration only. Falls back to a daily rule so a habit always has
    a valid recurrence rather than being dropped.
    """
    parts = _parse_rrule(rrule) if rrule else {}
    freq = parts.get("FREQ")
    try:
        interval = max(1, int(parts.get("INTERVAL", "1")))
    except ValueError:
        interval = 1

    if freq == "WEEKLY":
        byday = parts.get("BYDAY", "")
        code_map = {"MO": "mon", "TU": "tue", "WE": "wed", "TH": "thu", "FR": "fri", "SA": "sat", "SU": "sun"}
        days = [code_map[c] for c in re.findall(r"MO|TU|WE|TH|FR|SA|SU", byday)]
        if not days and start is not None:
            days = [WEEKDAYS[start.weekday()]]
        return {"freq": "weekly", "interval": interval, "days": days or ["mon"]}
    if freq == "MONTHLY":
        dom = start.day if start is not None else 1
        return {"freq": "monthly", "interval": interval, "day_of_month": dom}
    if freq == "DAILY" and interval > 1:
        return {"freq": "every_n_days", "n": interval}
    # DAILY (interval 1), YEARLY, or anything unrecognized → daily.
    return {"freq": "daily", "interval": 1}

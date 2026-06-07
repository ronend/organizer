"""Recurrence math for routines (mirrors frontend/src/lib/recurrence.ts).

Weekday numbering matches the frontend: 0=Sun .. 6=Sat.
"""

from datetime import datetime, timedelta
from typing import Any, Optional


def parse_due(date_str: str, time_str: str) -> datetime:
    return datetime.fromisoformat(f"{date_str}T{(time_str or '00:00')}")


def to_date_str(d: datetime) -> str:
    return d.strftime("%Y-%m-%d")


def to_time_str(d: datetime) -> str:
    return d.strftime("%H:%M")


def _js_weekday(d: datetime) -> int:
    # Python: Monday=0..Sunday=6  ->  JS: Sunday=0..Saturday=6
    return (d.weekday() + 1) % 7


def _start_of_week(d: datetime) -> datetime:
    base = d.replace(hour=0, minute=0, second=0, microsecond=0)
    return base - timedelta(days=_js_weekday(base))


def _days_in_month(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (datetime(year, month + 1, 1) - timedelta(days=1)).day


def _add_months(d: datetime, months: int, day: Optional[int] = None) -> datetime:
    total = (d.year * 12 + (d.month - 1)) + months
    year, month0 = divmod(total, 12)
    month = month0 + 1
    target_day = day if day else d.day
    target_day = min(target_day, _days_in_month(year, month))
    return d.replace(year=year, month=month, day=target_day)


def next_occurrence(prev: datetime, rec: dict[str, Any], anchor: datetime) -> datetime:
    interval = max(1, int(rec.get("interval", 1) or 1))
    freq = rec.get("freq")

    if freq == "day":
        return prev + timedelta(days=interval)

    if freq == "week":
        weekdays = rec.get("weekdays") or []
        if weekdays:
            wd = {int(w) for w in weekdays}
            anchor_week = _start_of_week(anchor)
            d = prev
            for _ in range(366):
                d = d + timedelta(days=1)
                weeks = round((_start_of_week(d) - anchor_week).days / 7)
                if _js_weekday(d) in wd and weeks % interval == 0:
                    return d
        return prev + timedelta(days=7 * interval)

    # month
    month_day = rec.get("monthDay")
    if month_day:
        return _add_months(prev, interval, day=int(month_day))
    return _add_months(prev, interval)


def prereq_due(occurrence: datetime, reminder: dict[str, Any]) -> datetime:
    # `daysBefore` is the new field; `leadDays` is the legacy fallback.
    days_before = reminder.get("daysBefore")
    if days_before is None:
        days_before = reminder.get("leadDays", 0)
    return occurrence - timedelta(days=int(days_before or 0))

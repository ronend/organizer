"""The registry (registry.json) — which subjects exist, what they can hold,
and every field definition. The one source of truth for the data model's
extensible parts; the models only fix the shapes.

- ``subjectTypes``: person, car, trip, ... Each defines its ``attributes``
  (field definitions), the object kinds it ``allows`` (task, document,
  assignment, reservation), its ``documentCategories``, its ``routineAreas``
  and cross-field ``rules`` (e.g. dateOrder).
- ``documentCategories``: identity, health, car, attachment, ... Each defines
  its types, ``fields`` and per-type ``typeFields``, ``fileRoles``, whether
  it's ``expiring`` (may carry an expiry), its routine ``area`` and the save
  ``rules`` POST /api/documents applies.
- ``reservationTypes`` + ``reservationFields``; ``routineAreas``.

A new subject type, document category, field or reservation type is a
registry edit: no model change and no migration.

Households can also define their own subject types (``subjectType`` records,
created with POST /api/subject-types or the MCP tool). ``using(state)`` makes
them part of ``subject_types()`` for the code it wraps, so every check treats
them like built-in ones; ``effective(state)`` is the merged registry a client
sees at GET /api/registry. Never delete a field
definition that stored records use; mark it ``"deprecated": true`` instead.

``frontend/src/lib/registry.json`` is a verbatim copy (a test fails if they
drift); clients such as the MCP server read ``GET /api/registry``.
"""

from __future__ import annotations

import json
from contextlib import contextmanager
from contextvars import ContextVar
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator, Optional

_PATH = Path(__file__).with_name("registry.json")


@lru_cache(maxsize=1)
def registry() -> dict[str, Any]:
    return json.loads(_PATH.read_text())


# The current household's own subject types (set by ``using``).
_custom: ContextVar[dict[str, dict]] = ContextVar("custom_subject_types", default={})

# Fields of a subjectType record that are part of its registry entry.
TYPE_INFO_FIELDS = (
    "label", "plural", "nameLabel", "namePlaceholder", "icon", "attributes", "allows",
    "documentCategories", "routineAreas", "rules",
)


def custom_types(state: dict) -> dict[str, dict]:
    """A household's subjectType records as registry entries (key = record id)."""
    return {
        r["id"]: {**{k: r[k] for k in TYPE_INFO_FIELDS if k in r}, "custom": True}
        for r in state.get("subjectTypes", [])
        if not r.get("archived")
    }


@contextmanager
def using(state: dict) -> Iterator[None]:
    """Within the block, subject_types() includes the household's own types."""
    token = _custom.set(custom_types(state))
    try:
        yield
    finally:
        _custom.reset(token)


def base_subject_types() -> dict[str, dict]:
    return registry()["subjectTypes"]


def subject_types() -> dict[str, dict]:
    custom = _custom.get()
    return {**base_subject_types(), **custom} if custom else base_subject_types()


def effective(state: dict) -> dict[str, Any]:
    """The registry with the household's own subject types merged in."""
    reg = registry()
    custom = custom_types(state)
    return {**reg, "subjectTypes": {**reg["subjectTypes"], **custom}} if custom else reg


def categories() -> dict[str, dict]:
    return registry()["documentCategories"]


def routine_areas() -> dict[str, dict]:
    return registry()["routineAreas"]


def reservation_types() -> dict[str, dict]:
    return registry()["reservationTypes"]


def subject_type(key: str) -> dict:
    return subject_types()[key]


def category(key: str) -> dict:
    return categories()[key]


def category_fields(key: str, doc_type: Optional[str]) -> list[dict]:
    """A category's field definitions plus those of the given type (type wins on a clash)."""
    c = category(key)
    out = {f["key"]: f for f in c.get("fields", [])}
    for f in c.get("typeFields", {}).get(doc_type or "", []):
        out[f["key"]] = f
    return list(out.values())


def remind_days_default(cat_key: str, doc_type: str) -> int:
    renewal = category(cat_key)["rules"].get("renewal") or {}
    return int(renewal.get("remindDays", {}).get(doc_type, renewal.get("defaultRemindDays", 90)))


# ── shape-level validators used by the pydantic models ──────────────────────


def _check(v: str, known: dict, what: str) -> str:
    if v not in known:
        raise ValueError(f"unknown {what} {v!r} (known: {', '.join(known)})")
    return v


def check_subject_type(v: str) -> str:
    """Only the key's shape: households can define their own types, so whether
    the type exists is checked against the household (integrity.py)."""
    import re

    if not re.match(r"^[a-z][a-z0-9_]{0,31}$", v):
        raise ValueError(f"invalid subject type key {v!r} (lowercase letters, digits and _)")
    return v


def check_category(v: str) -> str:
    return _check(v, categories(), "document category")


def check_area(v: str) -> str:
    return _check(v, routine_areas(), "routine area")


def check_reservation_type(v: str) -> str:
    return _check(v, reservation_types(), "reservation type")

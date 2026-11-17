"""The subject and document registry — the one place that says which subjects
exist and which documents each can hold.

``registry.json`` is the source of truth. ``frontend/src/lib/registry.json`` is
a verbatim copy (the frontend contract test fails if they drift), and clients
such as the MCP server read it from ``GET /api/registry``.

- ``subjectTypes``: person, car, ... Each names the state collection holding
  its records, the field used as its display name, and the document
  categories it can hold.
- ``categories``: identity, health, car, ... Each lists its document types,
  the Document fields it uses (``features``), per-type detail fields, its
  routine area, the "pin" label and default, and which save rules apply:
  ``replaceOnLink`` (a new document on a routine archives the older one of
  the same type there), ``expiryDrivesRoutine`` (the linked routine follows
  the document's expiry), ``onePerType`` (a second active document of the
  same type must be an explicit choice) and ``renewal`` (reminder defaults).

Adding a subject type later means a new record kind for it plus an entry
here; documents, routines, tasks and the document API need no changes.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

_PATH = Path(__file__).with_name("registry.json")


@lru_cache(maxsize=1)
def registry() -> dict[str, Any]:
    return json.loads(_PATH.read_text())


def subject_types() -> dict[str, dict]:
    return registry()["subjectTypes"]


def categories() -> dict[str, dict]:
    return registry()["categories"]


def areas() -> list[str]:
    return list(dict.fromkeys(c["area"] for c in categories().values()))


def category(kind: str) -> dict:
    return categories()[kind]


def subject_type(kind: str) -> dict:
    return subject_types()[kind]


def subject_name(subject_type_key: str, record: dict) -> str:
    return str(record.get(subject_type(subject_type_key)["nameField"], ""))


def remind_days_default(doc_kind: str, doc_type: str) -> int:
    renewal = category(doc_kind).get("renewal") or {}
    return int(renewal.get("remindDays", {}).get(doc_type, renewal.get("defaultRemindDays", 90)))


# ── validators (used by the pydantic models) ────────────────────────────────


def check_subject_type(v: str) -> str:
    if v not in subject_types():
        raise ValueError(f"unknown subject type {v!r} (known: {', '.join(subject_types())})")
    return v


def check_doc_kind(v: str) -> str:
    if v not in categories():
        raise ValueError(f"unknown document category {v!r} (known: {', '.join(categories())})")
    return v


def check_area(v: str) -> str:
    if v not in areas():
        raise ValueError(f"unknown area {v!r} (known: {', '.join(areas())})")
    return v


def check_doc_for_subject(doc_kind: str, subject_type_key: str) -> None:
    allowed = subject_type(subject_type_key)["categories"]
    if doc_kind not in allowed:
        label = subject_type(subject_type_key)["label"].lower()
        raise ValueError(
            f"a {label} can't hold {doc_kind!r} documents (allowed: {', '.join(allowed) or 'none'})"
        )

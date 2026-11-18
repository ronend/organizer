"""Subjects and the household's own subject types over MCP.

- ``subject_type_body``: the POST /api/subject-types body for a new kind of
  subject (e.g. apartment, business, project). Attribute keys are derived from
  labels when not given ("Lease end" → leaseEnd).
- ``new_subject``: a subject record of any type (built-in or the household's
  own), with attribute values matched by label or key and coerced to the
  field's type; people/subjects and contacts are given by name.

The API checks everything again (backend/src/integrity.py); this module only
resolves names and gives early, readable errors.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from .logic import ToolError, _norm, find_subject, new_id, now_iso, parse_date

FIELD_TYPES = ("text", "secret", "longtext", "url", "number", "date", "boolean", "select", "contact", "subject", "subjects")
ALLOWS = ("task", "document", "assignment", "reservation")


def camel_key(label: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", label)
    if not words:
        raise ToolError(f"Can't make a field key from {label!r}; give `key`.")
    key = words[0].lower() + "".join(w[:1].upper() + w[1:].lower() for w in words[1:])
    return key if key[0].isalpha() else f"f{key}"


def type_key(label: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
    if not key or not key[0].isalpha():
        raise ToolError(f"Can't make a type key from {label!r}; give `key` (lowercase letters, digits, _).")
    return key[:32]


def subject_type_body(
    reg: dict,
    label: str,
    key: Optional[str] = None,
    plural: Optional[str] = None,
    name_label: Optional[str] = None,
    icon: Optional[str] = None,
    attributes: Optional[list[dict]] = None,
    allows: Optional[list[str]] = None,
    document_categories: Optional[list[str]] = None,
    routine_areas: Optional[list[str]] = None,
    date_order: Optional[list[str]] = None,
) -> dict:
    body: dict[str, Any] = {"key": key or type_key(label), "label": label.strip()}
    if plural:
        body["plural"] = plural.strip()
    if name_label:
        body["nameLabel"] = name_label.strip()
    if icon:
        body["icon"] = icon.strip()
    attrs = []
    for a in attributes or []:
        a = dict(a)
        if not a.get("label"):
            raise ToolError("Each attribute needs a `label`.")
        a.setdefault("key", camel_key(a["label"]))
        a.setdefault("type", "text")
        if a["type"] not in FIELD_TYPES:
            raise ToolError(f"Unknown attribute type {a['type']!r}. Use one of: {', '.join(FIELD_TYPES)}.")
        attrs.append(a)
    if attributes is not None:
        body["attributes"] = attrs
    if allows is not None:
        bad = [x for x in allows if x not in ALLOWS]
        if bad:
            raise ToolError(f"`allows` takes {', '.join(ALLOWS)}; not {', '.join(bad)}.")
        body["allows"] = allows
    cats = reg["documentCategories"]
    if document_categories is not None:
        bad = [c for c in document_categories if c not in cats]
        if bad:
            raise ToolError(f"Unknown document categories {bad}. Known: {', '.join(cats)}.")
        body["documentCategories"] = document_categories
    if routine_areas is not None:
        bad = [r for r in routine_areas if r not in reg["routineAreas"]]
        if bad:
            raise ToolError(f"Unknown routine areas {bad}. Known: {', '.join(reg['routineAreas'])}.")
        body["routineAreas"] = routine_areas
    if date_order:
        by_label = {_norm(a["label"]): a["key"] for a in attrs} | {_norm(a["key"]): a["key"] for a in attrs}
        keys = [by_label.get(_norm(x), x) for x in date_order]
        body["rules"] = [{"rule": "dateOrder", "fields": keys}]
    return body


def _coerce(state: dict, d: dict, v: Any) -> Any:
    t = d["type"]
    if v is None or v == "":
        return None
    if t == "number":
        try:
            n = float(v)
        except (TypeError, ValueError):
            raise ToolError(f"{d['label']} must be a number, not {v!r}.")
        return int(n) if d.get("integer") or n.is_integer() else n
    if t == "boolean":
        if isinstance(v, bool):
            return v
        return _norm(str(v)) in ("yes", "true", "1", "y")
    if t == "date":
        return parse_date(str(v))
    if t == "select":
        opts = d.get("options") or []
        hit = next((o for o in opts if _norm(o) == _norm(str(v))), None)
        if hit is None:
            raise ToolError(f"{d['label']} must be one of: {', '.join(opts)}.")
        return hit
    if t == "contact":
        pool = state.get("contacts", [])
        q = _norm(str(v))
        hits = [c for c in pool if c["id"] == v or _norm(c["name"]) == q] or [c for c in pool if q and q in _norm(c["name"])]
        if len(hits) != 1:
            raise ToolError(f"{d['label']}: no single contact matches {v!r}.")
        return hits[0]["id"]
    if t in ("subject", "subjects"):
        names = v if isinstance(v, list) else ([v] if t == "subject" else [x.strip() for x in str(v).split(",")])
        types = {d["subjectType"]} if d.get("subjectType") else None
        ids = [find_subject(state, str(n), types)["id"] for n in names if str(n).strip()]
        return ids[0] if t == "subject" else ids
    return str(v).strip()


def new_subject(
    state: dict,
    reg: dict,
    subject_type: str,
    name: str,
    attributes: Optional[dict[str, Any]] = None,
    notes: Optional[str] = None,
) -> dict:
    types = reg["subjectTypes"]
    q = _norm(subject_type)
    key = next((k for k, t in types.items() if q in (_norm(k), _norm(t["label"]), _norm(t.get("plural", "")))), None)
    if key is None:
        raise ToolError(f"Unknown subject type {subject_type!r}. Known: {', '.join(f'{k} ({t['label']})' for k, t in types.items())}.")
    info = types[key]
    name = (name or "").strip()
    if not name:
        raise ToolError(f"A {info['label'].lower()} needs a name ({info.get('nameLabel', 'Name')}).")
    defs = [d for d in info.get("attributes", []) if not d.get("deprecated")]
    by_name = {_norm(d["label"]): d for d in defs} | {_norm(d["key"]): d for d in defs}
    attrs: dict[str, Any] = {}
    for k, v in (attributes or {}).items():
        d = by_name.get(_norm(k))
        if not d:
            raise ToolError(f"A {info['label'].lower()} has no attribute {k!r}. Its attributes: {', '.join(d['label'] for d in defs) or 'none'}.")
        value = _coerce(state, d, v)
        if value not in (None, "", []):
            attrs[d["key"]] = value
    missing = [d["label"] for d in defs if d.get("required") and d["key"] not in attrs]
    if missing:
        raise ToolError(f"A {info['label'].lower()} needs: {', '.join(missing)}.")
    stamp = now_iso()
    prefix = {"person": "p", "car": "c", "trip": "tr"}.get(key, "s")
    return {
        "kind": "subject", "id": new_id(prefix), "createdAt": stamp, "updatedAt": stamp, "archived": False,
        "subjectType": key, "name": name[:300], "notes": (notes or "").strip()[:5000], "attributes": attrs,
    }

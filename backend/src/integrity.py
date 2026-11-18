"""Household-level checks: everything the models can't see on one record.

``check(after, changed, deleted)`` validates a household state AFTER a change
(``after`` = collections of plain dicts) for the records that were put
(``changed``) and deleted (``deleted``), and returns a list of problems (empty
= fine). ``check_all(state)`` checks every record (used by the migration).

Rules:
- registry fields: subject ``attributes``, document ``fields``, reservation
  ``fields`` match their definitions (known keys, value types, required,
  unique, select options, references to contacts/subjects)
- a subject's type allows the object (task/document/assignment/reservation);
  documents use one of its categories, assignments one of its routine areas
- references exist and agree: ``subjectId``, ``parentId``, ``source``,
  ``attachedTo``, ``assignmentId``, ``routineId``, ``contactId``, providers,
  contact ``links``
- subtasks: the parent exists, is not itself a subtask, has the same subject;
  a task that has subtasks can't become a subtask
- documents: ``type`` is one of the category's, file roles are the
  category's, ``expiry`` only on expiring categories
- deleting a record that something still references is refused: delete or
  update the referencing records in the same batch
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any, Iterable, Optional

from src import registry

COLLECTIONS = {
    "subject": "subjects", "task": "tasks", "document": "documents", "reservation": "reservations",
    "routine": "routines", "assignment": "assignments", "contact": "contacts",
}

_URL = re.compile(r"^https?://\S+$", re.I)


class Index:
    """Lookups over a household state."""

    def __init__(self, state: dict[str, list[dict]]):
        self.state = state
        self.by_id: dict[str, dict[str, dict]] = {
            kind: {r["id"]: r for r in state.get(coll, [])} for kind, coll in COLLECTIONS.items()
        }

    def get(self, kind: str, id_: Optional[str]) -> Optional[dict]:
        return self.by_id[kind].get(id_) if id_ else None

    def all(self, kind: str) -> Iterable[dict]:
        return self.by_id[kind].values()


def _label(rec: dict) -> str:
    return f"{rec['kind']} {rec['id']}"


def _norm(defn: dict, v: Any) -> Any:
    if isinstance(v, str):
        if defn.get("normalize") == "plate":
            return "".join(ch for ch in v.upper() if ch.isalnum())
        return " ".join(v.lower().split())
    return v


# ── fields ──────────────────────────────────────────────────────────────────


def check_fields(values: dict, defs: list[dict], where: str, ix: Index) -> list[str]:
    """Validate a field map against its definitions."""
    errs: list[str] = []
    by_key = {d["key"]: d for d in defs}
    for k in values:
        if k not in by_key:
            known = ", ".join(by_key) or "none"
            errs.append(f"{where}: unknown field {k!r} (fields here: {known})")
    for d in defs:
        k, t = d["key"], d["type"]
        v = values.get(k)
        if v is None or v == "" or v == []:
            if d.get("required"):
                errs.append(f"{where}: {k} is required")
            continue
        bad = f"{where}: {k} must be"
        if t in ("text", "secret"):
            if not isinstance(v, str) or len(v) > 300:
                errs.append(f"{bad} text (≤300 chars)")
        elif t == "longtext":
            if not isinstance(v, str):
                errs.append(f"{bad} text")
        elif t == "url":
            if not isinstance(v, str) or len(v) > 2000 or not _URL.match(v):
                errs.append(f"{bad} an http(s) link")
        elif t == "number":
            if isinstance(v, bool) or not isinstance(v, (int, float)) or (d.get("integer") and not float(v).is_integer()):
                errs.append(f"{bad} {'a whole number' if d.get('integer') else 'a number'}")
        elif t == "boolean":
            if not isinstance(v, bool):
                errs.append(f"{bad} true or false")
        elif t == "date":
            try:
                if not isinstance(v, str) or len(v) != 10:
                    raise ValueError
                date.fromisoformat(v)
            except ValueError:
                errs.append(f"{bad} a date YYYY-MM-DD")
        elif t == "select":
            if v not in d.get("options", []):
                errs.append(f"{bad} one of {', '.join(d.get('options', []))}")
        elif t == "contact":
            c = ix.get("contact", v) if isinstance(v, str) else None
            if not c:
                errs.append(f"{where}: {k} refers to a missing contact {v!r}")
            elif d.get("tags") and not set(c.get("tags", [])) & set(d["tags"]):
                errs.append(f"{where}: {k}: {c['name']} isn't tagged {' or '.join(d['tags'])}")
        elif t in ("subject", "subjects"):
            ids = [v] if t == "subject" else v
            if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
                errs.append(f"{bad} {'a subject id' if t == 'subject' else 'a list of subject ids'}")
                continue
            for i in ids:
                s = ix.get("subject", i)
                if not s:
                    errs.append(f"{where}: {k} refers to a missing subject {i!r}")
                elif d.get("subjectType") and s["subjectType"] != d["subjectType"]:
                    errs.append(f"{where}: {k} must refer to a {d['subjectType']}, not {s['subjectType']} {i!r}")
        else:
            errs.append(f"{where}: field {k} has unknown type {t!r} in the registry")
    return errs


# ── per kind ────────────────────────────────────────────────────────────────


def _subject_for(rec: dict, ix: Index, allow: str, errs: list[str]) -> Optional[dict]:
    s = ix.get("subject", rec.get("subjectId"))
    if not s:
        errs.append(f"{_label(rec)}: subject {rec.get('subjectId')!r} doesn't exist")
        return None
    st = registry.subject_type(s["subjectType"])
    if allow not in st["allows"]:
        errs.append(f"{_label(rec)}: a {st['label'].lower()} can't hold {allow}s")
    return s


def _check_subject(rec: dict, ix: Index) -> list[str]:
    st = registry.subject_type(rec["subjectType"])
    defs = st["attributes"]
    errs = check_fields(rec.get("attributes", {}), defs, _label(rec), ix)
    for d in defs:
        v = rec.get("attributes", {}).get(d["key"])
        if d.get("unique") and v not in (None, ""):
            nv = _norm(d, v)
            for other in ix.all("subject"):
                if other["id"] != rec["id"] and other["subjectType"] == rec["subjectType"] and _norm(d, other.get("attributes", {}).get(d["key"])) == nv:
                    errs.append(f"{_label(rec)}: {d['label'].lower()} {v!r} is already used by {other['name']}")
    for rule in st.get("rules", []):
        if rule["rule"] == "dateOrder":
            a, b = (rec.get("attributes", {}).get(k) for k in rule["fields"])
            if isinstance(a, str) and isinstance(b, str) and b < a:
                errs.append(f"{_label(rec)}: {rule['fields'][1]} must be on or after {rule['fields'][0]}")
    return errs


def _check_task(rec: dict, ix: Index) -> list[str]:
    errs: list[str] = []
    if rec.get("subjectId"):
        _subject_for(rec, ix, "task", errs)
    if rec.get("parentId"):
        parent = ix.get("task", rec["parentId"])
        if not parent:
            errs.append(f"{_label(rec)}: parent task {rec['parentId']!r} doesn't exist")
        else:
            if parent.get("parentId"):
                errs.append(f"{_label(rec)}: its parent {parent['id']} is itself a subtask (one level only)")
            if parent.get("subjectId") != rec.get("subjectId"):
                errs.append(f"{_label(rec)}: a subtask must have its parent's subject")
        if any(t.get("parentId") == rec["id"] for t in ix.all("task")):
            errs.append(f"{_label(rec)}: it has subtasks, so it can't be a subtask")
    else:
        moved = [t["id"] for t in ix.all("task") if t.get("parentId") == rec["id"] and t.get("subjectId") != rec.get("subjectId")]
        if moved:
            errs.append(f"{_label(rec)}: its subtasks ({', '.join(moved)}) must move to the same subject in the same batch")
    src = rec.get("source")
    if src:
        target = ix.get(src["kind"], src["id"])
        if not target:
            errs.append(f"{_label(rec)}: source {src['kind']} {src['id']!r} doesn't exist")
        elif target.get("subjectId") != rec.get("subjectId"):
            errs.append(f"{_label(rec)}: must have the same subject as its source {src['kind']}")
    if rec.get("appointment") and rec["appointment"].get("providerId") and not ix.get("contact", rec["appointment"]["providerId"]):
        errs.append(f"{_label(rec)}: appointment provider {rec['appointment']['providerId']!r} doesn't exist")
    return errs


def _check_document(rec: dict, ix: Index) -> list[str]:
    errs: list[str] = []
    cat = registry.category(rec["category"])
    s = _subject_for(rec, ix, "document", errs)
    if s and rec["category"] not in registry.subject_type(s["subjectType"])["documentCategories"]:
        errs.append(f"{_label(rec)}: a {s['subjectType']} can't hold {rec['category']!r} documents")
    if rec["type"] not in cat["types"]:
        errs.append(f"{_label(rec)}: type {rec['type']!r} isn't a {cat['label'].lower()} type ({', '.join(cat['types'])})")
    for f in rec.get("files", []):
        if f.get("role") is not None and f["role"] not in cat.get("fileRoles", []):
            errs.append(f"{_label(rec)}: file role {f['role']!r} isn't used by {cat['label'].lower()} documents")
    roles = [f["role"] for f in rec.get("files", []) if f.get("role")]
    if len(roles) != len(set(roles)):
        errs.append(f"{_label(rec)}: each file role may be used once")
    if rec.get("expiry") and not cat.get("expiring"):
        errs.append(f"{_label(rec)}: {cat['label'].lower()} documents don't expire")
    errs += check_fields(rec.get("fields", {}), registry.category_fields(rec["category"], rec["type"]), _label(rec), ix)
    at = rec.get("attachedTo")
    if at:
        target = ix.get(at["kind"], at["id"])
        if not target:
            errs.append(f"{_label(rec)}: attached to a missing {at['kind']} {at['id']!r}")
        elif target.get("subjectId") != rec["subjectId"]:
            errs.append(f"{_label(rec)}: must have the same subject as the {at['kind']} it's attached to")
    if rec.get("assignmentId"):
        a = ix.get("assignment", rec["assignmentId"])
        r = ix.get("routine", a["routineId"]) if a else None
        if not a:
            errs.append(f"{_label(rec)}: routine assignment {rec['assignmentId']!r} doesn't exist")
        elif a["subjectId"] != rec["subjectId"]:
            errs.append(f"{_label(rec)}: its routine belongs to another subject")
        elif r and cat.get("area") and r["area"] != cat["area"]:
            errs.append(f"{_label(rec)}: link a {cat['area']} routine to a {cat['label'].lower()} document")
    return errs


def _check_reservation(rec: dict, ix: Index) -> list[str]:
    errs: list[str] = []
    _subject_for(rec, ix, "reservation", errs)
    errs += check_fields(rec.get("fields", {}), registry.registry()["reservationFields"], _label(rec), ix)
    return errs


def _check_routine(rec: dict, ix: Index) -> list[str]:
    return []


def _check_assignment(rec: dict, ix: Index) -> list[str]:
    errs: list[str] = []
    r = ix.get("routine", rec["routineId"])
    if not r:
        errs.append(f"{_label(rec)}: routine {rec['routineId']!r} doesn't exist")
    s = _subject_for(rec, ix, "assignment", errs)
    if s and r and r["area"] not in registry.subject_type(s["subjectType"])["routineAreas"]:
        errs.append(f"{_label(rec)}: a {s['subjectType']} can't have {r['area']} routines")
    if rec.get("contactId") and not ix.get("contact", rec["contactId"]):
        errs.append(f"{_label(rec)}: contact {rec['contactId']!r} doesn't exist")
    return errs


def _check_contact(rec: dict, ix: Index) -> list[str]:
    errs = [
        f"{_label(rec)}: linked to a missing subject {link['subjectId']!r}"
        for link in rec.get("links", [])
        if not ix.get("subject", link["subjectId"])
    ]
    ids = [link["subjectId"] for link in rec.get("links", [])]
    if len(ids) != len(set(ids)):
        errs.append(f"{_label(rec)}: link each subject once")
    return errs


_CHECKS = {
    "subject": _check_subject, "task": _check_task, "document": _check_document,
    "reservation": _check_reservation, "routine": _check_routine, "assignment": _check_assignment,
    "contact": _check_contact,
}


# ── references (for deletes) ────────────────────────────────────────────────


def references(rec: dict) -> list[tuple[str, str]]:
    """Every (kind, id) a record points at."""
    out: list[tuple[str, str]] = []
    k = rec["kind"]
    if rec.get("subjectId"):
        out.append(("subject", rec["subjectId"]))
    if k == "task":
        if rec.get("parentId"):
            out.append(("task", rec["parentId"]))
        if rec.get("source"):
            out.append((rec["source"]["kind"], rec["source"]["id"]))
        if (rec.get("appointment") or {}).get("providerId"):
            out.append(("contact", rec["appointment"]["providerId"]))
    elif k == "document":
        if rec.get("attachedTo"):
            out.append((rec["attachedTo"]["kind"], rec["attachedTo"]["id"]))
        if rec.get("assignmentId"):
            out.append(("assignment", rec["assignmentId"]))
        for d in registry.category_fields(rec["category"], rec["type"]):
            out += _field_refs(d, rec.get("fields", {}).get(d["key"]))
    elif k == "assignment":
        out.append(("routine", rec["routineId"]))
        if rec.get("contactId"):
            out.append(("contact", rec["contactId"]))
    elif k == "contact":
        out += [("subject", link["subjectId"]) for link in rec.get("links", [])]
    elif k == "subject":
        for d in registry.subject_type(rec["subjectType"])["attributes"]:
            out += _field_refs(d, rec.get("attributes", {}).get(d["key"]))
    elif k == "reservation":
        for d in registry.registry()["reservationFields"]:
            out += _field_refs(d, rec.get("fields", {}).get(d["key"]))
    return out


def _field_refs(d: dict, v: Any) -> list[tuple[str, str]]:
    if not v:
        return []
    if d["type"] == "contact" and isinstance(v, str):
        return [("contact", v)]
    if d["type"] == "subject" and isinstance(v, str):
        return [("subject", v)]
    if d["type"] == "subjects" and isinstance(v, list):
        return [("subject", i) for i in v if isinstance(i, str)]
    return []


# ── entry points ────────────────────────────────────────────────────────────


def check(after: dict[str, list[dict]], changed: Iterable[dict], deleted: Iterable[dict]) -> list[str]:
    ix = Index(after)
    errs: list[str] = []
    for rec in changed:
        try:
            errs += _CHECKS[rec["kind"]](rec, ix)
        except KeyError as e:  # unknown registry key slipped past the models
            errs.append(f"{_label(rec)}: unknown {e}")
    gone = {(d["kind"], d["id"]) for d in deleted}
    if gone:
        for kind in COLLECTIONS:
            for rec in ix.all(kind):
                for ref in references(rec):
                    if ref in gone:
                        errs.append(f"{ref[0]} {ref[1]} is still referenced by {_label(rec)}; delete or update it in the same batch")
    return errs


def check_all(state: dict[str, list[dict]]) -> list[str]:
    every = [r for coll in COLLECTIONS.values() for r in state.get(coll, [])]
    return check(state, every, [])


def apply(state: dict[str, list[dict]], puts: Iterable[dict], deletes: Iterable[dict]) -> dict[str, list[dict]]:
    """The state after a change (records keyed by kind+id; puts replace)."""
    recs = {(r["kind"], r["id"]): r for coll in COLLECTIONS.values() for r in state.get(coll, [])}
    for d in deletes:
        recs.pop((d["kind"], d["id"]), None)
    for p in puts:
        recs[(p["kind"], p["id"])] = p
    out: dict[str, list[dict]] = {coll: [] for coll in COLLECTIONS.values()}
    for (kind, _), r in recs.items():
        out[COLLECTIONS[kind]].append(r)
    return out

"""Documents over MCP: one tool for any document on any subject (data model v2).

The rules (archiving the older document on a routine, closing "add the
document" tasks, renewal reminders, routines following an expiry, one active
ID per type) live in the coo API's POST /api/documents
(backend/src/documents.py), and every write passes the API's household checks.
This module only turns what Claude says into that request: it resolves names to
ids (subject, provider contact, routine), matches the category and type against
the registry (GET /api/registry, the same backend/src/registry.json the app
uses) and maps the tool's parameters onto the category's registry fields. New
subject types, categories or fields in the registry need no change here.

Files can't be attached over MCP; add them in the app.
"""

from __future__ import annotations

from typing import Any, Optional

from .logic import ToolError, _norm, find_subject, parse_date, subject_label, today

# Tool parameter → registry field key (when the category defines that field).
PARAM_FIELDS = {
    "id_number": "idNumber",
    "issuer": "issuer",
    "issue_date": "issueDate",
    "provider": "providerId",
    "about": "about",
    "episode": "episode",
}
GENERIC = "attachment"


# ── registry lookups ────────────────────────────────────────────────────────


def category_fields(reg: dict, kind: str, doc_type: Optional[str]) -> list[dict]:
    """A category's field definitions plus the type's (type wins on a clash)."""
    c = reg["documentCategories"][kind]
    out = {f["key"]: f for f in c.get("fields", [])}
    for f in c.get("typeFields", {}).get(doc_type or "", []):
        out[f["key"]] = f
    return [f for f in out.values() if not f.get("deprecated")]


def _match_type_or_none(cat: dict, value: str) -> Optional[str]:
    q = _norm(value)
    for t in cat["types"]:
        if _norm(t) == q:
            return t
    if q in cat.get("typeAliases", {}):
        return cat["typeAliases"][q]
    hits = [t for t in cat["types"] if q and q in _norm(t)]
    return hits[0] if len(hits) == 1 else None


def match_category(reg: dict, stype: str, query: Optional[str], doc_type: Optional[str]) -> str:
    """The category: as given (key, label, short or plural), else inferred from the subject or the type."""
    allowed = reg["subjectTypes"][stype]["documentCategories"]
    label = reg["subjectTypes"][stype]["label"].lower()
    cats = reg["documentCategories"]
    choices = ", ".join(f"{k} ({cats[k]['label']})" for k in allowed)
    if query:
        q = _norm(query)
        for k in allowed:
            c = cats[k]
            if q in {_norm(k), _norm(c["label"]), _norm(c["short"]), _norm(c["plural"])}:
                return k
        raise ToolError(f"A {label} can hold: {choices}; not {query!r}.")
    # The generic file category only when nothing more specific fits.
    specific = [k for k in allowed if k != GENERIC] or allowed
    if doc_type:
        fits = [k for k in specific if _match_type_or_none(cats[k], doc_type)]
        if len(fits) == 1:
            return fits[0]
    if len(specific) == 1:
        return specific[0]
    raise ToolError(f"Say which kind of document (`category`): a {label} can hold {choices}.")


def match_type(cat: dict, value: Optional[str]) -> str:
    if not value:
        return cat["defaultType"]
    t = _match_type_or_none(cat, value)
    if t is None:
        raise ToolError(f"Unknown {cat['label'].lower()} document type {value!r}. Use one of: {', '.join(cat['types'])}.")
    return t


def find_contact(state: dict, query: str, tags: Optional[list[str]]) -> dict:
    pool = [c for c in state.get("contacts", []) if not tags or set(c.get("tags", [])) & set(tags)]
    q = _norm(query)
    exact = [c for c in pool if _norm(c["name"]) == q]
    hits = exact or [c for c in pool if q and (q in _norm(c["name"]) or q in _norm(c.get("role", "")))]
    if len(hits) == 1:
        return hits[0]
    names = ", ".join(c["name"] for c in pool) or "none"
    if not hits:
        raise ToolError(f"No contact matches {query!r}. Contacts: {names}. Add new contacts in the app.")
    raise ToolError(f"{query!r} matches several contacts ({', '.join(c['name'] for c in hits)}); be more specific.")


def find_assignment(state: dict, subject: dict, area: str, query: str) -> tuple[dict, dict]:
    routines = {r["id"]: r for r in state.get("routines", [])}
    who = subject_label(subject)
    mine = [
        (a, routines[a["routineId"]])
        for a in state.get("assignments", [])
        if a.get("subjectId") == subject["id"] and a.get("routineId") in routines and routines[a["routineId"]].get("area") == area
    ]
    q = _norm(query)
    exact = [x for x in mine if _norm(x[1]["title"]) == q]
    hits = exact or [x for x in mine if q and q in _norm(x[1]["title"])]
    if len(hits) == 1:
        return hits[0]
    titles = ", ".join(r["title"] for _, r in mine) or "none"
    if not hits:
        raise ToolError(f"{who} has no {area} routine matching {query!r}. {area.capitalize()} routines for {who}: {titles}.")
    raise ToolError(f"{query!r} matches several of {who}'s routines; be more specific.")


def _clip(s: Optional[str], n: int) -> str:
    return (s or "").strip()[:n]


# ── the request ─────────────────────────────────────────────────────────────


def build_request(
    state: dict,
    reg: dict,
    subject: str,
    name: Optional[str] = None,
    category: Optional[str] = None,
    doc_type: Optional[str] = None,
    valid_until: Optional[str] = None,
    on: Optional[str] = None,
    id_number: Optional[str] = None,
    issuer: Optional[str] = None,
    issue_date: Optional[str] = None,
    details: Optional[dict[str, str]] = None,
    provider: Optional[str] = None,
    about: Optional[str] = None,
    episode: Optional[str] = None,
    routine: Optional[str] = None,
    pin: Optional[bool] = None,
    remind: bool = True,
    remind_days: Optional[int] = None,
    keep_both: bool = False,
) -> tuple[dict, dict]:
    """The POST /api/documents body, plus context for the reply."""
    sub = find_subject(state, subject)
    stype = sub["subjectType"]
    if stype not in reg["subjectTypes"]:
        raise ToolError(f"{subject_label(sub)} is a {stype}, which coo doesn't know documents for.")
    allowed = reg["subjectTypes"][stype]["documentCategories"]
    if not allowed:
        raise ToolError(f"A {stype} can't hold documents.")
    kind = match_category(reg, stype, category, doc_type)
    cat = reg["documentCategories"][kind]
    t = match_type(cat, doc_type)
    defs = {f["key"]: f for f in category_fields(reg, kind, t)}

    doc: dict[str, Any] = {
        "subjectId": sub["id"],
        "category": kind,
        "type": t,
        "title": _clip(name, 300) or f"{sub['name']}’s {t.lower()}",
    }
    if valid_until:
        if not cat.get("expiring"):
            raise ToolError(f"{cat['label']} documents don't expire; drop valid_until.")
        doc["expiry"] = {"validUntil": parse_date(valid_until), "outdated": False}
    if on:
        doc["date"] = parse_date(on)
    if pin is not None:
        doc["pinned"] = bool(pin)

    context: dict[str, Any] = {"subject": subject_label(sub), "category": kind}
    fields: dict[str, Any] = {}
    given = {"id_number": id_number, "issuer": issuer, "issue_date": issue_date, "provider": provider, "about": about, "episode": episode}
    for param, value in given.items():
        if not value:
            continue
        key = PARAM_FIELDS[param]
        if key not in defs:
            raise ToolError(f"{cat['label']} documents don't use `{param}`. Their fields: {', '.join(d['label'] for d in defs.values()) or 'none'}.")
        d = defs[key]
        if d["type"] == "contact":
            c = find_contact(state, value, d.get("tags"))
            fields[key] = c["id"]
            context["provider"] = c["name"]
        elif d["type"] == "date":
            fields[key] = parse_date(value)
        else:
            fields[key] = _clip(value, 5000 if d["type"] == "longtext" else 300)
    if fields.get("episode"):
        # Reuse an existing episode's spelling when it matches.
        existing = {
            _norm(x["fields"]["episode"]): x["fields"]["episode"]
            for x in state.get("documents", [])
            if x.get("subjectId") == sub["id"] and isinstance((x.get("fields") or {}).get("episode"), str)
        }
        fields["episode"] = existing.get(_norm(fields["episode"]), fields["episode"])

    custom: list[dict] = []
    if details:
        # Registry fields when the label (or key) matches, else custom fields — as the app does.
        by_name = {}
        for d in defs.values():
            by_name[_norm(d["label"])] = d
            by_name[_norm(d["key"])] = d
        for k, v in details.items():
            v = (v or "").strip()
            if not k.strip() or not v:
                continue
            d = by_name.get(_norm(k))
            if d and d["type"] in ("text", "longtext", "secret") and d["key"] not in fields:
                fields[d["key"]] = v[:5000 if d["type"] == "longtext" else 300]
            else:
                custom.append({"label": k.strip()[:300], "value": v[:5000]})
    if fields:
        doc["fields"] = fields
    if custom:
        doc["customFields"] = custom

    if routine:
        if not cat.get("area"):
            raise ToolError(f"{cat['label']} documents aren't linked to routines.")
        a, r = find_assignment(state, sub, cat["area"], routine)
        doc["assignmentId"] = a["id"]
        context["routine"] = r["title"]

    body: dict[str, Any] = {
        "document": doc,
        "duplicates": "allow" if keep_both else "reject",
        "today": today().isoformat(),
    }
    if (cat.get("rules") or {}).get("renewal") and remind and not routine:
        if remind_days is not None and not 0 <= remind_days <= 3650:
            raise ToolError("remind_days must be between 0 and 3650.")
        body["renewal"] = {"remindDays": remind_days} if remind_days is not None else {}
    return body, context


def duplicate_message(detail: str, existing: list[dict]) -> str:
    """Turn the API's 409 into instructions for Claude."""
    parts = [
        f"{d.get('title') or d.get('name')!r} (expires {d.get('validUntil') or 'unknown'}"
        + (f", renewal routine {d['routine']!r})" if d.get("routine") else ", no renewal routine)")
        for d in existing
    ]
    with_routine = any(d.get("routine") for d in existing)
    return (
        f"{detail}: {'; '.join(parts)}. "
        "If the new one replaces it, call again with `routine` set to that routine's title "
        "(the old one is archived and the routine moves to the new expiry). "
        "To add it alongside, call again with keep_both=true."
        + ("" if with_routine else " The current one has no renewal routine, so use keep_both=true and archive the old one in the app.")
    )


def reply(result: dict, context: dict) -> dict:
    """What the tool returns: the saved document and what else changed."""
    d = result["document"]
    s = result.get("summary", {})
    doc: dict[str, Any] = {
        "id": d["id"],
        "subject": context["subject"],
        "category": d["category"],
        "title": d["title"],
        "type": d["type"],
    }
    if d.get("expiry"):
        doc["validUntil"] = d["expiry"]["validUntil"]
    if d.get("date"):
        doc["date"] = d["date"]
    if context.get("provider"):
        doc["provider"] = context["provider"]
    if (d.get("fields") or {}).get("episode"):
        doc["episode"] = d["fields"]["episode"]
    doc["pinned"] = d["pinned"]
    out: dict[str, Any] = {"document": doc}
    for k in ("linkedRoutine", "archivedOlder", "closedTasks", "renewalRoutine", "remindersPlannedFrom", "routineMovedTo", "steps", "note"):
        if s.get(k):
            out[k] = s[k]
    out["files"] = "Attach the file itself (photo or PDF) in the coo app."
    return out


_KEY_PARAMS = {v: k for k, v in PARAM_FIELDS.items()}


def describe_registry(reg: dict) -> dict:
    """A compact view of the registry for list_document_types."""
    out: dict[str, Any] = {}
    for stype, info in reg["subjectTypes"].items():
        cats: dict[str, Any] = {}
        for k in info["documentCategories"]:
            c = reg["documentCategories"][k]
            params = ["date"] + (["valid_until"] if c.get("expiring") else [])
            params += [_KEY_PARAMS[f["key"]] for f in c.get("fields", []) if f["key"] in _KEY_PARAMS]
            entry: dict[str, Any] = {
                "label": c["label"],
                "types": c["types"],
                "defaultType": c["defaultType"],
                "parameters": params,
                "pin": f"{c['pin']['label']} (default {'on' if c['pin']['default'] else 'off'})",
            }
            if c.get("typeFields"):
                entry["detailsPerType"] = {t: [f["label"] for f in fs] for t, fs in c["typeFields"].items()}
            if c.get("area"):
                entry["routineArea"] = c["area"]
            renewal = (c.get("rules") or {}).get("renewal")
            if renewal:
                days = ", ".join(f"{t} {d}" for t, d in renewal["remindDays"].items())
                entry["renewalReminders"] = f"on by default when there's an expiry; remind_days defaults: {days}, others {renewal['defaultRemindDays']}"
            cats[k] = entry
        out[stype] = {"label": info["label"], "attributes": [a["label"] for a in info.get("attributes", [])], "categories": cats}
    return out

"""Documents over MCP: one tool for any document on any subject.

The rules (archiving the older document on a routine, closing "add the
document" tasks, renewal reminders, routines following an expiry, one active
ID per type) live in the coo API's POST /api/documents
(backend/src/documents.py). This module only turns what Claude says into that
request: it resolves names to ids (subject, provider contact, routine), matches
the category and type against the registry (GET /api/registry, the same
backend/src/registry.json the app uses) and orders detail rows the way the app
does. New subject types or categories in the registry need no change here.

Files can't be attached over MCP; add them in the app.
"""

from __future__ import annotations

from typing import Any, Optional

from .logic import ToolError, _norm, _plate, parse_date, today


# ── registry lookups ────────────────────────────────────────────────────────


def subject_label(reg: dict, stype: str, record: dict) -> str:
    name = str(record.get(reg["subjectTypes"][stype]["nameField"], ""))
    return f"{name} ({record['plate']})" if record.get("plate") else name


def find_subject(state: dict, reg: dict, query: str) -> tuple[str, dict]:
    """Resolve a name (or a car plate, or an id) across every registry subject type."""
    q = _norm(query)
    pool = [
        (stype, rec)
        for stype, info in reg["subjectTypes"].items()
        for rec in state.get(info["collection"], [])
    ]

    def name(stype: str, rec: dict) -> str:
        return _norm(str(rec.get(reg["subjectTypes"][stype]["nameField"], "")))

    hits = [
        (t, r) for t, r in pool
        if r["id"] == query or name(t, r) == q or _norm(subject_label(reg, t, r)) == q
        or (r.get("plate") and _plate(query) and _plate(r["plate"]) == _plate(query))
    ]
    if not hits:
        hits = [(t, r) for t, r in pool if q and q in name(t, r)]
    if len(hits) == 1:
        return hits[0]
    known = "; ".join(
        f"{info['plural']}: {', '.join(subject_label(reg, t, r) for r in state.get(info['collection'], [])) or 'none'}"
        for t, info in reg["subjectTypes"].items()
    )
    if not hits:
        raise ToolError(f"Nothing matches {query!r}. {known}.")
    raise ToolError(f"{query!r} is ambiguous ({', '.join(subject_label(reg, t, r) for t, r in hits)}); be more specific.")


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
    """The category: as given (key, label or plural), else inferred from the subject or the type."""
    allowed = reg["subjectTypes"][stype]["categories"]
    label = reg["subjectTypes"][stype]["label"].lower()
    cats = reg["categories"]
    choices = ", ".join(f"{k} ({cats[k]['label']})" for k in allowed)
    if query:
        q = _norm(query)
        for k in allowed:
            c = cats[k]
            if q in {_norm(k), _norm(c["label"]), _norm(c["short"]), _norm(c["plural"])}:
                return k
        raise ToolError(f"A {label} can hold: {choices}; not {query!r}.")
    if len(allowed) == 1:
        return allowed[0]
    if doc_type:
        fits = [k for k in allowed if _match_type_or_none(cats[k], doc_type)]
        if len(fits) == 1:
            return fits[0]
    raise ToolError(f"Say which kind of document (`category`): a {label} can hold {choices}.")


def match_type(cat: dict, value: Optional[str]) -> str:
    if not value:
        return cat["defaultType"]
    t = _match_type_or_none(cat, value)
    if t is None:
        raise ToolError(f"Unknown {cat['label'].lower()} document type {value!r}. Use one of: {', '.join(cat['types'])}.")
    return t


def find_contact(state: dict, query: str, groups: Optional[list[str]]) -> dict:
    pool = [c for c in state.get("contacts", []) if not groups or c.get("group") in groups]
    q = _norm(query)
    exact = [c for c in pool if _norm(c["name"]) == q]
    hits = exact or [c for c in pool if q and (q in _norm(c["name"]) or q in _norm(c.get("role", "")))]
    if len(hits) == 1:
        return hits[0]
    names = ", ".join(c["name"] for c in pool) or "none"
    if not hits:
        raise ToolError(f"No contact matches {query!r}. Contacts: {names}. Add new contacts in the app.")
    raise ToolError(f"{query!r} matches several contacts ({', '.join(c['name'] for c in hits)}); be more specific.")


def find_assignment(state: dict, stype: str, subject: dict, who: str, area: str, query: str) -> tuple[dict, dict]:
    routines = {r["id"]: r for r in state.get("routines", [])}
    mine = [
        (a, routines[a["routineId"]])
        for a in state.get("assignments", [])
        if a.get("subjectType") == stype and a.get("subjectId") == subject["id"]
        and a.get("routineId") in routines and routines[a["routineId"]].get("area") == area
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
    stype, rec = find_subject(state, reg, subject)
    who = subject_label(reg, stype, rec)
    kind = match_category(reg, stype, category, doc_type)
    cat = reg["categories"][kind]
    t = match_type(cat, doc_type)
    plain_name = str(rec.get(reg["subjectTypes"][stype]["nameField"], ""))

    doc: dict[str, Any] = {
        "subjectType": stype,
        "subjectId": rec["id"],
        "docKind": kind,
        "type": t,
        "name": _clip(name, 300) or f"{plain_name}’s {t.lower()}",
    }
    if valid_until:
        doc["validUntil"] = parse_date(valid_until)
    if on:
        doc["date"] = parse_date(on)
    if id_number:
        doc["idNumber"] = _clip(id_number, 300)
    if issuer:
        doc["issuer"] = _clip(issuer, 300)
    if issue_date:
        doc["issueDate"] = parse_date(issue_date)
    if about:
        doc["about"] = _clip(about, 5000)
    if pin is not None:
        doc["pinned"] = bool(pin)

    if details:
        # The type's suggested fields first (matched case-insensitively), then
        # the rest; empty values dropped, as in the app.
        given = {_norm(k): (k.strip(), (v or "").strip()) for k, v in details.items()}
        rows = []
        for field in cat.get("detailFields", {}).get(t, []):
            hit = given.pop(_norm(field), None)
            if hit and hit[1]:
                rows.append({"name": field, "value": hit[1][:5000]})
        rows += [{"name": k[:300], "value": v[:5000]} for k, v in given.values() if k and v]
        if rows:
            doc["details"] = rows

    if episode:
        # Reuse an existing episode's spelling when it matches.
        ep = _clip(episode, 300)
        existing = {
            _norm(d["episode"]): d["episode"]
            for d in state.get("documents", [])
            if d.get("subjectId") == rec["id"] and d.get("episode")
        }
        doc["episode"] = existing.get(_norm(ep), ep)

    context: dict[str, Any] = {"subject": who, "category": kind}
    if provider:
        c = find_contact(state, provider, cat.get("providerGroups"))
        doc["providerId"] = c["id"]
        context["provider"] = c["name"]
    if routine:
        a, r = find_assignment(state, stype, rec, who, cat["area"], routine)
        doc["assignmentId"] = a["id"]
        context["routine"] = r["title"]

    body: dict[str, Any] = {
        "document": doc,
        "duplicates": "allow" if keep_both else "reject",
        "today": today().isoformat(),
    }
    if cat.get("renewal") and remind and not routine:
        if remind_days is not None and not 0 <= remind_days <= 3650:
            raise ToolError("remind_days must be between 0 and 3650.")
        body["renewal"] = {"remindDays": remind_days} if remind_days is not None else {}
    return body, context


def duplicate_message(detail: str, existing: list[dict]) -> str:
    """Turn the API's 409 into instructions for Claude."""
    parts = [
        f"{d['name']!r} (expires {d.get('validUntil') or 'unknown'}"
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
        "category": d["docKind"],
        "name": d["name"],
        "type": d["type"],
    }
    for k in ("validUntil", "date", "episode"):
        if d.get(k):
            doc[k] = d[k]
    if context.get("provider"):
        doc["provider"] = context["provider"]
    doc["pinned"] = d["pinned"]
    out: dict[str, Any] = {"document": doc}
    for k in ("linkedRoutine", "archivedOlder", "closedTasks", "renewalRoutine", "remindersPlannedFrom", "routineMovedTo", "steps", "note"):
        if s.get(k):
            out[k] = s[k]
    out["files"] = "Attach the file itself (photo or PDF) in the coo app."
    return out


_FEATURE_PARAMS = {
    "validUntil": "valid_until", "date": "date", "idNumber": "id_number", "issuer": "issuer",
    "issueDate": "issue_date", "details": "details", "provider": "provider", "about": "about",
    "episode": "episode",
}


def describe_registry(reg: dict) -> dict:
    """A compact view of the registry for list_document_types."""
    out: dict[str, Any] = {}
    for stype, info in reg["subjectTypes"].items():
        cats: dict[str, Any] = {}
        for k in info["categories"]:
            c = reg["categories"][k]
            entry: dict[str, Any] = {
                "label": c["label"],
                "types": c["types"],
                "defaultType": c["defaultType"],
                "parameters": [_FEATURE_PARAMS[f] for f in c["features"] if f in _FEATURE_PARAMS],
                "pin": f"{c['pin']['label']} (default {'on' if c['pin']['default'] else 'off'})",
                "routineArea": c["area"],
            }
            if c.get("detailFields"):
                entry["detailFields"] = c["detailFields"]
            if c.get("renewal"):
                days = ", ".join(f"{t} {d}" for t, d in c["renewal"]["remindDays"].items())
                entry["renewalReminders"] = (
                    f"on by default when there's an expiry; remind_days defaults: {days}, others {c['renewal']['defaultRemindDays']}"
                )
            cats[k] = entry
        out[stype] = {"label": info["label"], "categories": cats}
    return out

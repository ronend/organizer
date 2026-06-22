"""ID generation matching data-structure.md.

| Entity             | Format            | Example          |
|--------------------|-------------------|------------------|
| Event              | evt_ + nanoid(8)  | evt_abc12345     |
| Item               | itm_ + nanoid(6)  | itm_a1b2c3       |
| Reminder           | rem_ + nanoid(6)  | rem_x9y8z7       |
| Checklist instance | cl_  + nanoid(6)  | cl_p1q2r3        |
| Checklist item     | cli_ + nanoid(6)  | cli_m4n5o6       |
| Attachment         | att_ + nanoid(6)  | att_d7e8f9       |
| Template           | tmpl_ + slug      | tmpl_backpacking |

IDs inside embedded arrays must be globally unique (not just within their
parent) so the reminders_index sync is unambiguous.
"""

import re
import secrets

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def nanoid(size: int) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(size))


def event_id() -> str:
    return f"evt_{nanoid(8)}"


def item_id() -> str:
    return f"itm_{nanoid(6)}"


def reminder_id() -> str:
    return f"rem_{nanoid(6)}"


def checklist_id() -> str:
    return f"cl_{nanoid(6)}"


def checklist_item_id() -> str:
    return f"cli_{nanoid(6)}"


def attachment_id() -> str:
    return f"att_{nanoid(6)}"


def template_id(name: str) -> str:
    """tmpl_ + slugified name, with a short random suffix to avoid collisions."""
    slug = re.sub(r"[^a-z0-9]+", "_", (name or "").strip().lower()).strip("_")
    slug = slug[:40] or "template"
    return f"tmpl_{slug}_{nanoid(4)}"

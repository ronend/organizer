"""ID generation for the flat entity model (see entity-model-proposal.md).

Every top-level entity is one document with a type-prefixed id:

    <type>_<nanoid(6)>   e.g. todo_a1b2c3, story_x9y8z7, reservation_m4n5o6

The prefix is derived from the discriminator (`type`) so an id is self-describing
and collisions across types are impossible even before the random suffix.
"""

import secrets

_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def nanoid(size: int = 6) -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(size))


def entity_id(entity_type: str) -> str:
    """`<type>_<nanoid(6)>`. `entity_type` is the discriminator, e.g. "reservation"."""
    prefix = (entity_type or "item").strip().lower() or "item"
    return f"{prefix}_{nanoid(6)}"

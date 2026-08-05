"""Resource registrations — addressable, read-only views Claude can pull in
proactively. The browsable axes mirror the webapp: all items and the upcoming
reminders projection.

Resource read functions are called with no arguments (FastMCP does not inject
Context into resources), so they obtain the caller's token via mcp.get_context(),
which reads the current request context set during the read.
"""

from __future__ import annotations

import json

from mcp.server.fastmcp import FastMCP

from . import client
from .client import token_from_context


def register_resources(mcp: FastMCP) -> None:
    @mcp.resource(
        "organizer://items",
        name="all-items",
        description="Every entity (todo/appointment/habit/routine/reservation/event/story) for the user",
        mime_type="application/json",
    )
    async def all_items() -> str:
        token = token_from_context(mcp.get_context())
        return json.dumps(await client.list_items(token), indent=2, default=str)

    @mcp.resource(
        "organizer://reminders/upcoming",
        name="upcoming-reminders",
        description="Pending reminders across all items, ordered by fire_at (what fires next)",
        mime_type="application/json",
    )
    async def upcoming_reminders() -> str:
        token = token_from_context(mcp.get_context())
        return json.dumps(await client.upcoming_reminders(token), indent=2, default=str)

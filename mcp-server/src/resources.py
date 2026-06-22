"""Resource registrations — addressable, read-only views Claude can pull in
proactively. The browsable axes mirror the webapp: all events, the distinct
tags in use, and the upcoming reminders projection.

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
        "organizer://events",
        name="all-events",
        description="Every event document (container/occurrence/habit/list) for the user",
        mime_type="application/json",
    )
    async def all_events() -> str:
        token = token_from_context(mcp.get_context())
        return json.dumps(await client.list_events(token), indent=2, default=str)

    @mcp.resource(
        "organizer://tags",
        name="all-tags",
        description="All distinct free-form tags in use and how many events carry each",
        mime_type="application/json",
    )
    async def all_tags() -> str:
        token = token_from_context(mcp.get_context())
        return json.dumps(await client.list_tags(token), indent=2, default=str)

    @mcp.resource(
        "organizer://reminders/upcoming",
        name="upcoming-reminders",
        description="Pending reminders across all events, ordered by fire_at (what fires next)",
        mime_type="application/json",
    )
    async def upcoming_reminders() -> str:
        token = token_from_context(mcp.get_context())
        return json.dumps(await client.upcoming_reminders(token), indent=2, default=str)

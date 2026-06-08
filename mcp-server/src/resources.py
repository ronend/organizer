"""Resource registrations — addressable, read-only views Claude can pull in
proactively. Mirroring the webapp, the browsable axes are all entries and the
distinct tags in use (there are no lists/projects).

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
        "organizer://entries",
        name="all-entries",
        description="Every organizer entry (tasks, trips, recurring) for the user",
        mime_type="application/json",
    )
    async def all_entries() -> str:
        token = token_from_context(mcp.get_context())
        return json.dumps(await client.list_entries(token), indent=2, default=str)

    @mcp.resource(
        "organizer://tags",
        name="all-tags",
        description="All distinct free-form tags in use and how many entries carry each",
        mime_type="application/json",
    )
    async def all_tags() -> str:
        token = token_from_context(mcp.get_context())
        return json.dumps(await client.list_tags(token), indent=2, default=str)

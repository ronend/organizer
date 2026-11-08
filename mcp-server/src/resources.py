"""Resource registrations — addressable, read-only views Claude can pull in
proactively: the raw household state and the current agenda.

Resource read functions are called with no arguments (FastMCP does not inject
Context into resources), so they obtain the caller's token via mcp.get_context(),
which reads the current request context set during the read.
"""

from __future__ import annotations

import json

from mcp.server.fastmcp import FastMCP

from . import client, logic
from .client import token_from_context


def register_resources(mcp: FastMCP) -> None:
    @mcp.resource(
        "coo://state",
        name="state",
        description="Every coo record (people, cars, contacts, routines, assignments, tasks, documents, trips, reservations)",
        mime_type="application/json",
    )
    async def state() -> str:
        token = token_from_context(mcp.get_context())
        return json.dumps(await client.get_state(token), indent=2, default=str, ensure_ascii=False)

    @mcp.resource(
        "coo://agenda",
        name="agenda",
        description="Open tasks bucketed into overdue / today / next_7_days / later",
        mime_type="application/json",
    )
    async def agenda() -> str:
        token = token_from_context(mcp.get_context())
        state = await client.get_state(token)
        return json.dumps(logic.agenda(state), indent=2, default=str, ensure_ascii=False)

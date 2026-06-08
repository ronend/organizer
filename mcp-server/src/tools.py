"""Tool registrations. One tool per distinct action against the Organizer API.

Names are verb_noun snake_case; descriptions tell Claude WHEN to call each tool.
FastMCP turns any exception raised here into a tool result with isError=True, so
handlers don't need their own try/except — they just call the client and return.

Each tool receives the MCP `Context` so it can forward the CALLER's Cognito token
to the API (per-user pass-through). Inputs are typed via annotations + pydantic
Field; FastMCP derives the JSON Schema.
"""

from __future__ import annotations

import json
from typing import Annotated, Optional

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from . import client
from .client import (
    Contact,
    DependsOnRef,
    EntryType,
    Recurrence,
    Reminder,
    Segment,
    token_from_context,
)


def _dumps(data) -> str:
    return json.dumps(data, indent=2, default=str)


def _compact(body: dict) -> dict:
    """Drop keys whose value is None and serialize pydantic models to dicts."""
    out: dict = {}
    for key, value in body.items():
        if value is None:
            continue
        if isinstance(value, list):
            out[key] = [v.model_dump() if hasattr(v, "model_dump") else v for v in value]
        elif hasattr(value, "model_dump"):
            out[key] = value.model_dump()
        else:
            out[key] = value
    return out


def register_tools(mcp: FastMCP) -> None:
    # ── READ ────────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Return all organizer entries (tasks, trips, recurring items) for the "
            "user, optionally filtered by type, tag, or done state. Call this before "
            "any bulk operation so you know the current entry IDs. Filtering is "
            "applied client-side."
        )
    )
    async def list_entries(
        ctx: Context,
        type: Annotated[Optional[EntryType], Field(description="Filter by entry type")] = None,
        tag: Annotated[
            Optional[str], Field(description="Filter to entries carrying this tag (case-insensitive)")
        ] = None,
        done: Annotated[Optional[bool], Field(description="Filter by completion state")] = None,
    ) -> str:
        token = token_from_context(ctx)
        return _dumps(await client.list_entries(token, type, tag, done))

    @mcp.tool(
        description=(
            "Get full details for a single entry by its ID. (The webapp has no "
            "single-GET route, so this fetches the list and selects the entry.)"
        )
    )
    async def get_entry(ctx: Context, id: Annotated[str, Field(description="Entry ID")]) -> str:
        return _dumps(await client.get_entry(token_from_context(ctx), id))

    @mcp.tool(
        description=(
            "Return all distinct free-form tags in use, with how many entries carry "
            "each. Tags replace the notion of lists/projects — call this to discover "
            "valid tag names before filtering or tagging entries."
        )
    )
    async def list_tags(ctx: Context) -> str:
        return _dumps(await client.list_tags(token_from_context(ctx)))

    # ── CREATE ──────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Create a new organizer entry. `title` and `dueDate` (YYYY-MM-DD) are "
            "required. Default type is 'task'. Use type='trip' with "
            "startDate/endDate/segments for travel, or type='recurring' with a "
            "recurrence rule for repeating items. Returns the created entry with its ID."
        )
    )
    async def create_entry(
        ctx: Context,
        title: Annotated[str, Field(description="Entry title (required)")],
        dueDate: Annotated[str, Field(description="Due date, YYYY-MM-DD (required)")],
        type: Annotated[Optional[EntryType], Field(description="Entry type; defaults to 'task'")] = None,
        dueTime: Annotated[Optional[str], Field(description="Due time HH:MM; defaults to '09:00'")] = None,
        description: Annotated[Optional[str], Field(description="Description / notes (may be HTML)")] = None,
        done: Optional[bool] = None,
        tags: Annotated[
            Optional[list[str]], Field(description="Free-form labels (lowercased server-side)")
        ] = None,
        link: Annotated[Optional[str], Field(description="Related URL (task)")] = None,
        contacts: Annotated[Optional[list[Contact]], Field(description="Contacts (task)")] = None,
        dependsOn: Annotated[
            Optional[list[DependsOnRef]], Field(description="Dependencies on other entries (task)")
        ] = None,
        startDate: Annotated[Optional[str], Field(description="Trip start date YYYY-MM-DD")] = None,
        endDate: Annotated[Optional[str], Field(description="Trip end date YYYY-MM-DD")] = None,
        segments: Annotated[Optional[list[Segment]], Field(description="Trip itinerary segments")] = None,
        recurrence: Annotated[
            Optional[Recurrence], Field(description="Recurrence rule (type=recurring)")
        ] = None,
        reminders: Annotated[
            Optional[list[Reminder]], Field(description="Reminder sub-tasks for a recurring entry")
        ] = None,
    ) -> str:
        body = _compact(
            {
                "title": title,
                "dueDate": dueDate,
                "type": type,
                "dueTime": dueTime,
                "description": description,
                "done": done,
                "tags": tags,
                "link": link,
                "contacts": contacts,
                "dependsOn": dependsOn,
                "startDate": startDate,
                "endDate": endDate,
                "segments": segments,
                "recurrence": recurrence,
                "reminders": reminders,
            }
        )
        return _dumps(await client.create_entry(token_from_context(ctx), body))

    # ── UPDATE ──────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Update one or more fields on an existing entry (HTTP PUT with a partial "
            "body). Only supply the fields you want to change. To complete a regular "
            "task, set done=true. For recurring entries, prefer complete_recurring."
        )
    )
    async def update_entry(
        ctx: Context,
        id: Annotated[str, Field(description="Entry ID to update")],
        title: Optional[str] = None,
        dueDate: Annotated[Optional[str], Field(description="YYYY-MM-DD")] = None,
        dueTime: Annotated[Optional[str], Field(description="HH:MM")] = None,
        type: Optional[EntryType] = None,
        description: Optional[str] = None,
        done: Optional[bool] = None,
        tags: Annotated[Optional[list[str]], Field(description="Replaces the full tags array")] = None,
        link: Optional[str] = None,
        contacts: Optional[list[Contact]] = None,
        dependsOn: Optional[list[DependsOnRef]] = None,
        startDate: Optional[str] = None,
        endDate: Optional[str] = None,
        segments: Optional[list[Segment]] = None,
        recurrence: Optional[Recurrence] = None,
        reminders: Optional[list[Reminder]] = None,
    ) -> str:
        body = _compact(
            {
                "title": title,
                "dueDate": dueDate,
                "dueTime": dueTime,
                "type": type,
                "description": description,
                "done": done,
                "tags": tags,
                "link": link,
                "contacts": contacts,
                "dependsOn": dependsOn,
                "startDate": startDate,
                "endDate": endDate,
                "segments": segments,
                "recurrence": recurrence,
                "reminders": reminders,
            }
        )
        return _dumps(await client.update_entry(token_from_context(ctx), id, body))

    # ── COMPLETE RECURRING ────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Mark the current occurrence of a recurring entry done and atomically "
            "spawn the next occurrence plus its reminder sub-tasks. Use this for "
            "type=recurring entries instead of update_entry done=true. Returns the "
            "newly created entries."
        )
    )
    async def complete_recurring(
        ctx: Context, id: Annotated[str, Field(description="Recurring entry ID")]
    ) -> str:
        return _dumps(await client.complete_recurring(token_from_context(ctx), id))

    # ── DELETE ────────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Permanently delete an entry by ID. This cannot be undone — confirm with "
            "the user before calling."
        )
    )
    async def delete_entry(
        ctx: Context, id: Annotated[str, Field(description="Entry ID to delete")]
    ) -> str:
        await client.delete_entry(token_from_context(ctx), id)
        return f"Entry {id} deleted."

"""Tool registrations. One tool per distinct action against the Organizer API.

Names are verb_noun snake_case; descriptions tell Claude WHEN to call each tool.
FastMCP turns any exception raised here into a tool result with isError=True, so
handlers don't need their own try/except — they just call the client and return.

Each tool receives the MCP `Context` so it can forward the CALLER's Cognito token
to the API (per-user pass-through). Inputs are typed via annotations + pydantic
Field; FastMCP derives the JSON Schema.

The data model is the flat 7-type entity model (see entity-model-proposal.md):
each item is one of todo | appointment | habit | routine | reservation | event |
story, tagged by `type`. The API validates the correct shape per type.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Optional

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from . import client
from .client import EntityType, ReservationSubtype, token_from_context


def _dumps(data) -> str:
    return json.dumps(data, indent=2, default=str)


def _compact(body: dict) -> dict:
    """Drop keys whose value is None."""
    return {k: v for k, v in body.items() if v is not None}


def register_tools(mcp: FastMCP) -> None:
    # ── READ ────────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Return all entities for the user, optionally filtered by type. Each "
            "item is one of todo/appointment/habit/routine/reservation/event/story. "
            "Call this before any bulk operation so you know the current item IDs."
        )
    )
    async def list_items(
        ctx: Context,
        type: Annotated[
            Optional[EntityType],
            Field(description="Filter by entity type"),
        ] = None,
    ) -> str:
        return _dumps(await client.list_items(token_from_context(ctx), type))

    @mcp.tool(description="Get a single entity by ID (any type).")
    async def get_item(ctx: Context, id: Annotated[str, Field(description="Item ID")]) -> str:
        return _dumps(await client.get_item(token_from_context(ctx), id))

    @mcp.tool(
        description=(
            "Return upcoming reminders from the flat reminder index, ordered by "
            "fire_at. Use this for 'what's due / what fires next' questions. Routines "
            "contribute one row per scheduled reminder; other dated items contribute "
            "a single trigger at their own date/time. Defaults to pending; pass "
            "before=<ISO datetime> for a 'due by' window."
        )
    )
    async def upcoming_reminders(
        ctx: Context,
        before: Annotated[
            Optional[str], Field(description="Only reminders firing at/before this ISO datetime")
        ] = None,
        status: Annotated[Optional[str], Field(description="Reminder status filter (default 'pending')")] = "pending",
    ) -> str:
        return _dumps(await client.upcoming_reminders(token_from_context(ctx), before, status))

    @mcp.tool(
        description=(
            "Return a story's chronological timeline: its referenced reservations and "
            "events, resolved and sorted by start time. Pass the story's ID."
        )
    )
    async def get_story_timeline(ctx: Context, id: Annotated[str, Field(description="Story ID")]) -> str:
        return _dumps(await client.story_timeline(token_from_context(ctx), id))

    # ── CREATE ──────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Create a new item. `type` and `title` are always required. Provide the "
            "fields for that type (the API validates and rejects mismatches):\n"
            "- todo: due_at (required), completed\n"
            "- appointment: date_time (required), location, contact {name,phone,email}, "
            "things_to_bring [str], completed\n"
            "- habit: recurrence (required) — one of {freq:'daily',interval?}, "
            "{freq:'weekly',interval?,days:[mon..sun]}, {freq:'every_n_days',n}, "
            "{freq:'monthly',interval?,day_of_month}\n"
            "- routine: due_at (required), reminders [{kind:'offset',offset:'-2h'} | "
            "{kind:'absolute',at:ISO}], completed\n"
            "- reservation: subtype (required: hotel/flight/tour/activity/restaurant), "
            "date_time (required), location, details (str or object), reservation_number\n"
            "- event: start_at (required), end_at (required, >= start_at), details\n"
            "- story: item_refs [ids of reservations/events only]\n"
            "Datetimes are ISO 8601. Returns the created item with its server ID."
        )
    )
    async def create_item(
        ctx: Context,
        type: Annotated[EntityType, Field(description="Entity type (required)")],
        title: Annotated[str, Field(description="Title (required)")],
        due_at: Annotated[Optional[str], Field(description="todo/routine: ISO datetime")] = None,
        date_time: Annotated[Optional[str], Field(description="appointment/reservation: ISO datetime")] = None,
        start_at: Annotated[Optional[str], Field(description="event: ISO start datetime")] = None,
        end_at: Annotated[Optional[str], Field(description="event: ISO end datetime (>= start_at)")] = None,
        location: Annotated[Optional[str], Field(description="appointment/reservation location")] = None,
        contact: Annotated[Optional[dict[str, Any]], Field(description="appointment: {name,phone,email}")] = None,
        things_to_bring: Annotated[Optional[list[str]], Field(description="appointment: list of strings")] = None,
        recurrence: Annotated[Optional[dict[str, Any]], Field(description="habit: recurrence rule object")] = None,
        completion_log: Annotated[Optional[dict[str, bool]], Field(description="habit: date->completed map")] = None,
        reminders: Annotated[Optional[list[dict[str, Any]]], Field(description="routine: list of reminder-time objects")] = None,
        subtype: Annotated[Optional[ReservationSubtype], Field(description="reservation subtype")] = None,
        details: Annotated[Optional[Any], Field(description="reservation/event: free text or object")] = None,
        reservation_number: Annotated[Optional[str], Field(description="reservation confirmation number")] = None,
        item_refs: Annotated[Optional[list[str]], Field(description="story: ordered reservation/event IDs")] = None,
        completed: Annotated[Optional[bool], Field(description="todo/appointment/routine completion flag")] = None,
    ) -> str:
        body = _compact(
            {
                "type": type,
                "title": title,
                "due_at": due_at,
                "date_time": date_time,
                "start_at": start_at,
                "end_at": end_at,
                "location": location,
                "contact": contact,
                "things_to_bring": things_to_bring,
                "recurrence": recurrence,
                "completion_log": completion_log,
                "reminders": reminders,
                "subtype": subtype,
                "details": details,
                "reservation_number": reservation_number,
                "item_refs": item_refs,
                "completed": completed,
            }
        )
        return _dumps(await client.create_item(token_from_context(ctx), body))

    # ── UPDATE ──────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Update fields on an existing item (HTTP PUT, partial body). Only supply "
            "the fields you want to change; the API merges over the existing item and "
            "re-validates against its type. `type` is immutable. Array/object fields "
            "REPLACE the existing value — fetch the item first if you need to merge."
        )
    )
    async def update_item(
        ctx: Context,
        id: Annotated[str, Field(description="Item ID to update")],
        title: Optional[str] = None,
        due_at: Optional[str] = None,
        date_time: Optional[str] = None,
        start_at: Optional[str] = None,
        end_at: Optional[str] = None,
        location: Optional[str] = None,
        contact: Optional[dict[str, Any]] = None,
        things_to_bring: Optional[list[str]] = None,
        recurrence: Optional[dict[str, Any]] = None,
        completion_log: Optional[dict[str, bool]] = None,
        reminders: Optional[list[dict[str, Any]]] = None,
        subtype: Optional[ReservationSubtype] = None,
        details: Optional[Any] = None,
        reservation_number: Optional[str] = None,
        item_refs: Optional[list[str]] = None,
        completed: Optional[bool] = None,
    ) -> str:
        body = _compact(
            {
                "title": title,
                "due_at": due_at,
                "date_time": date_time,
                "start_at": start_at,
                "end_at": end_at,
                "location": location,
                "contact": contact,
                "things_to_bring": things_to_bring,
                "recurrence": recurrence,
                "completion_log": completion_log,
                "reminders": reminders,
                "subtype": subtype,
                "details": details,
                "reservation_number": reservation_number,
                "item_refs": item_refs,
                "completed": completed,
            }
        )
        return _dumps(await client.update_item(token_from_context(ctx), id, body))

    # ── HABIT LOG ────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Record a habit occurrence as completed (or not) for a specific date. "
            "Pass the habit's ID and a 'YYYY-MM-DD' date. Use this to check off a "
            "habit for today or backfill its completion log."
        )
    )
    async def log_habit(
        ctx: Context,
        id: Annotated[str, Field(description="Habit ID")],
        date: Annotated[str, Field(description="Occurrence date, 'YYYY-MM-DD'")],
        completed: Annotated[bool, Field(description="Whether the occurrence was completed")] = True,
    ) -> str:
        return _dumps(await client.log_habit(token_from_context(ctx), id, date, completed))

    # ── DELETE ────────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Permanently delete an item by ID (also removes its reminder-index "
            "entries). This cannot be undone — confirm with the user before calling."
        )
    )
    async def delete_item(ctx: Context, id: Annotated[str, Field(description="Item ID to delete")]) -> str:
        await client.delete_item(token_from_context(ctx), id)
        return f"Item {id} deleted."

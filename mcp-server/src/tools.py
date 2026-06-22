"""Tool registrations. One tool per distinct action against the Organizer API.

Names are verb_noun snake_case; descriptions tell Claude WHEN to call each tool.
FastMCP turns any exception raised here into a tool result with isError=True, so
handlers don't need their own try/except — they just call the client and return.

Each tool receives the MCP `Context` so it can forward the CALLER's Cognito token
to the API (per-user pass-through). Inputs are typed via annotations + pydantic
Field; FastMCP derives the JSON Schema.

The data model is the event model from data-structure.md: an EventDocument embeds
its items, reminders, checklists and attachments. `kind` drives behavior
(container/occurrence/habit/list); `subtype` is a free-form user label.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Optional

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from . import client
from .client import (
    Attachment,
    ChecklistInstance,
    EventKind,
    Item,
    Reminder,
    TemplateItem,
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
            "Return all event documents for the user, optionally filtered by kind, "
            "tag, or status. Each event embeds its items, reminders, checklists and "
            "attachments. Call this before any bulk operation so you know the current "
            "event IDs. Filtering is applied client-side."
        )
    )
    async def list_events(
        ctx: Context,
        kind: Annotated[
            Optional[EventKind],
            Field(description="Filter by event kind (container/occurrence/habit/list)"),
        ] = None,
        tag: Annotated[
            Optional[str], Field(description="Filter to events carrying this tag (case-insensitive)")
        ] = None,
        status: Annotated[Optional[str], Field(description="Filter by event status")] = None,
    ) -> str:
        token = token_from_context(ctx)
        return _dumps(await client.list_events(token, kind, tag, status))

    @mcp.tool(description="Get the full event document (with embedded items/reminders/checklists) by ID.")
    async def get_event(ctx: Context, id: Annotated[str, Field(description="Event ID")]) -> str:
        return _dumps(await client.get_event(token_from_context(ctx), id))

    @mcp.tool(
        description=(
            "Return all distinct free-form tags in use across events, with how many "
            "events carry each. Call this to discover valid tag names before filtering."
        )
    )
    async def list_tags(ctx: Context) -> str:
        return _dumps(await client.list_tags(token_from_context(ctx)))

    @mcp.tool(
        description=(
            "Return upcoming reminders from the flat reminders_index, ordered by "
            "fire_at. Use this for 'what's due / what fires next' questions. Defaults "
            "to pending reminders; pass before=<ISO datetime> for a 'due by' window."
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
            "Return the derived shopping list: every checklist item across all events "
            "that needs purchasing and isn't yet purchased, annotated with event/"
            "checklist context."
        )
    )
    async def shopping_list(ctx: Context) -> str:
        return _dumps(await client.shopping_list(token_from_context(ctx)))

    @mcp.tool(description="List the user's reusable checklist templates.")
    async def list_templates(ctx: Context) -> str:
        return _dumps(await client.list_templates(token_from_context(ctx)))

    # ── CREATE ──────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Create a new event. `title` is required; `kind` defaults to 'list'. Use "
            "kind='container' (with start_date/end_date and reservation items) for "
            "trips/projects, kind='occurrence' for appointments/deadlines (optionally "
            "with a recurrence_rule), kind='habit' for reminder-driven recurring "
            "entries, kind='list' for check-off lists. `subtype` is a free-form label "
            "(e.g. 'flight', 'dental checkup'). Reminders may use offset_rule (e.g. "
            "'-30d') which the server resolves against start_date to compute fire_at. "
            "Returns the created event with server-assigned IDs."
        )
    )
    async def create_event(
        ctx: Context,
        title: Annotated[str, Field(description="Event title (required)")],
        kind: Annotated[Optional[EventKind], Field(description="Event kind; defaults to 'list'")] = None,
        subtype: Annotated[Optional[str], Field(description="Free-form label, e.g. 'backpacking'")] = None,
        status: Annotated[Optional[str], Field(description="planned/active/done/cancelled")] = None,
        tags: Annotated[Optional[list[str]], Field(description="Free-form labels (lowercased server-side)")] = None,
        start_date: Annotated[Optional[str], Field(description="ISO date, e.g. '2026-07-14'")] = None,
        end_date: Annotated[Optional[str], Field(description="ISO date")] = None,
        recurrence_rule: Annotated[
            Optional[str], Field(description="RFC 5545 RRULE, e.g. 'RRULE:FREQ=MONTHLY;INTERVAL=6'")
        ] = None,
        attrs: Annotated[Optional[dict[str, Any]], Field(description="Open extension key/value bag")] = None,
        items: Annotated[Optional[list[Item]], Field(description="Embedded items")] = None,
        reminders: Annotated[Optional[list[Reminder]], Field(description="Event-level reminders")] = None,
        checklists: Annotated[Optional[list[ChecklistInstance]], Field(description="Checklist instances")] = None,
        attachments: Annotated[Optional[list[Attachment]], Field(description="Attachments")] = None,
    ) -> str:
        body = _compact(
            {
                "title": title,
                "kind": kind,
                "subtype": subtype,
                "status": status,
                "tags": tags,
                "start_date": start_date,
                "end_date": end_date,
                "recurrence_rule": recurrence_rule,
                "attrs": attrs,
                "items": items,
                "reminders": reminders,
                "checklists": checklists,
                "attachments": attachments,
            }
        )
        return _dumps(await client.create_event(token_from_context(ctx), body))

    # ── UPDATE ──────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Update one or more fields on an existing event (HTTP PUT, partial body). "
            "Only supply the fields you want to change. Array fields (items, reminders, "
            "checklists, attachments) REPLACE the existing array — fetch the event "
            "first, mutate the array, and send it back whole. To complete a regular "
            "event set status='done'; for recurring events prefer complete_event."
        )
    )
    async def update_event(
        ctx: Context,
        id: Annotated[str, Field(description="Event ID to update")],
        title: Optional[str] = None,
        kind: Optional[EventKind] = None,
        subtype: Optional[str] = None,
        status: Optional[str] = None,
        tags: Annotated[Optional[list[str]], Field(description="Replaces the full tags array")] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        recurrence_rule: Optional[str] = None,
        attrs: Optional[dict[str, Any]] = None,
        items: Optional[list[Item]] = None,
        reminders: Optional[list[Reminder]] = None,
        checklists: Optional[list[ChecklistInstance]] = None,
        attachments: Optional[list[Attachment]] = None,
    ) -> str:
        body = _compact(
            {
                "title": title,
                "kind": kind,
                "subtype": subtype,
                "status": status,
                "tags": tags,
                "start_date": start_date,
                "end_date": end_date,
                "recurrence_rule": recurrence_rule,
                "attrs": attrs,
                "items": items,
                "reminders": reminders,
                "checklists": checklists,
                "attachments": attachments,
            }
        )
        return _dumps(await client.update_event(token_from_context(ctx), id, body))

    # ── COMPLETE (recurrence rollover) ────────────────────────────────────────

    @mcp.tool(
        description=(
            "Mark an event done. If it carries a recurrence_rule, the server also "
            "spawns the next occurrence as a fresh event document (copied structure, "
            "reset statuses). Returns {'completed': <event>, 'next': <event|null>}."
        )
    )
    async def complete_event(
        ctx: Context, id: Annotated[str, Field(description="Event ID")]
    ) -> str:
        return _dumps(await client.complete_event(token_from_context(ctx), id))

    # ── TEMPLATES ──────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Create a reusable checklist template. If auto_apply=true and "
            "applies_to_subtype is set, the template's checklist (and any item "
            "default_reminder_offset reminders) is auto-attached to new events whose "
            "subtype matches."
        )
    )
    async def create_template(
        ctx: Context,
        name: Annotated[str, Field(description="Template name (required)")],
        applies_to_subtype: Annotated[
            Optional[str], Field(description="Auto-apply to new events with this subtype")
        ] = None,
        auto_apply: Annotated[Optional[bool], Field(description="Enable auto-apply")] = None,
        description: Optional[str] = None,
        tags: Optional[list[str]] = None,
        items: Annotated[Optional[list[TemplateItem]], Field(description="Template items")] = None,
    ) -> str:
        body = _compact(
            {
                "name": name,
                "applies_to_subtype": applies_to_subtype,
                "auto_apply": auto_apply,
                "description": description,
                "tags": tags,
                "items": items,
            }
        )
        return _dumps(await client.create_template(token_from_context(ctx), body))

    # ── DELETE ────────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Permanently delete an event by ID (also removes its reminders_index "
            "entries). This cannot be undone — confirm with the user before calling."
        )
    )
    async def delete_event(
        ctx: Context, id: Annotated[str, Field(description="Event ID to delete")]
    ) -> str:
        await client.delete_event(token_from_context(ctx), id)
        return f"Event {id} deleted."

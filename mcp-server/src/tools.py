"""Tool registrations for the coo MCP server.

A deliberately small set over the coo API. Reads fetch the whole state
(GET /api/state) and project it (see logic.py); task writes send FULL records
back (POST /api/batch upserts). Documents go through POST /api/documents, which
applies the document rules server-side (see documents.py). Records mirror
frontend/src/types/coo.ts.

Names are verb_noun snake_case; descriptions tell Claude WHEN to call each tool.
FastMCP turns any exception raised here into a tool result with isError=True, so
refusals are raised as ToolError with a user-facing message.

Each tool receives the MCP `Context` so it can forward the CALLER's Cognito token
to the API (per-user pass-through).
"""

from __future__ import annotations

import json
from typing import Annotated, Optional

from mcp.server.fastmcp import Context, FastMCP
from pydantic import Field

from . import client, documents, logic
from .client import token_from_context


def _dumps(data) -> str:
    return json.dumps(data, indent=2, default=str, ensure_ascii=False)


def register_tools(mcp: FastMCP) -> None:
    # ── READ ────────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "The household agenda: open tasks bucketed into overdue, today, "
            "next_7_days (1-7 days ahead) and later (8+ days ahead or no date), "
            "sorted by date then the user's manual order. Each task has its id, "
            "title, date, who it is for (a person, a car, a trip or 'General'), the "
            "routine it belongs to (if any) and whether it is a booked appointment. "
            "Use for 'what do I have to do', 'what's due', 'what's overdue'. "
            "Optionally filter to 'general' or to one person / car (name or plate) / trip."
        )
    )
    async def get_agenda(
        ctx: Context,
        filter: Annotated[
            Optional[str],
            Field(description="'everything' (default), 'general', or a person name, car name/plate, or trip name"),
        ] = None,
    ) -> str:
        state = await client.get_state(token_from_context(ctx))
        return _dumps(logic.agenda(state, filter))

    @mcp.tool(description="List the household's people and cars (ids, names, plates).")
    async def list_people_and_cars(ctx: Context) -> str:
        state = await client.get_state(token_from_context(ctx))
        return _dumps(logic.people_and_cars(state))

    @mcp.tool(
        description=(
            "List routines (recurring obligations such as passport renewal, car "
            "inspection, dental checkups, medication refills) with each assignee: "
            "the person or car, their due/expiry date, and whether it is done."
        )
    )
    async def list_routines(ctx: Context) -> str:
        state = await client.get_state(token_from_context(ctx))
        return _dumps(logic.routines(state))

    @mcp.tool(description="List trips (name, destination, dates, travelers, reservation count), soonest first.")
    async def list_trips(ctx: Context) -> str:
        state = await client.get_state(token_from_context(ctx))
        return _dumps(logic.trips(state))

    @mcp.tool(
        description=(
            "Get one trip with its reservations (flights, stays, cars, activities, ...) "
            "sorted by start time, plus its open trip tasks. Pass the trip's name "
            "(or part of it, or its destination) or its id."
        )
    )
    async def get_trip(
        ctx: Context,
        name_or_id: Annotated[str, Field(description="Trip name, destination or id")],
    ) -> str:
        state = await client.get_state(token_from_context(ctx))
        return _dumps(logic.trip_detail(state, name_or_id))

    # ── WRITE ───────────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Add a plain task to the agenda. `who` is a person's name, a car's "
            "make/model or plate, or 'general' (the default) for household tasks. "
            "`date` is YYYY-MM-DD and defaults to today. `subtasks` is an "
            "optional checklist of sub-task titles."
        )
    )
    async def add_task(
        ctx: Context,
        title: Annotated[str, Field(description="What needs doing")],
        date: Annotated[Optional[str], Field(description="Due date YYYY-MM-DD (default today)")] = None,
        who: Annotated[
            Optional[str],
            Field(description="Who/what it is for: person name, car name or plate, or 'general' (default)"),
        ] = None,
        notes: Annotated[Optional[str], Field(description="Optional notes")] = None,
        subtasks: Annotated[
            Optional[list[str]], Field(description="Optional checklist of sub-task titles")
        ] = None,
    ) -> str:
        token = token_from_context(ctx)
        state = await client.get_state(token)
        task = logic.new_task(state, title, date, who, notes, subtasks)
        await client.batch(token, put=[task])
        return _dumps({"created": task})

    @mcp.tool(
        description=(
            "Mark a plain task done (by id from get_agenda). Routine steps that need "
            "input (book an appointment, record a renewal, log a refill) and trip "
            "booking tasks are refused — those must be completed in the coo app."
        )
    )
    async def complete_task(
        ctx: Context,
        task_id: Annotated[str, Field(description="Task id from get_agenda (sub-tasks look like <task id>~<sub-task id>)")],
    ) -> str:
        token = token_from_context(ctx)
        state = await client.get_state(token)
        if logic.SUB_SEP in task_id:
            parent, sub = logic.find_subtask(state, task_id)
            await client.batch(token, put=[logic.completed_subtask(parent, sub)])
            return f"Done: {sub['title']} (sub-task of {parent['title']!r})"
        task = logic.completed_task(logic.find_task(state, task_id))
        await client.batch(token, put=[task])
        return f"Done: {task['title']}"

    @mcp.tool(
        description=(
            "Move a task to another date (YYYY-MM-DD). Booked appointments are "
            "refused — change those in the coo app."
        )
    )
    async def reschedule_task(
        ctx: Context,
        task_id: Annotated[str, Field(description="Task id from get_agenda (sub-tasks look like <task id>~<sub-task id>)")],
        date: Annotated[str, Field(description="New date YYYY-MM-DD")],
    ) -> str:
        token = token_from_context(ctx)
        state = await client.get_state(token)
        if logic.SUB_SEP in task_id:
            parent, sub = logic.find_subtask(state, task_id)
            updated = logic.rescheduled_subtask(parent, sub, date)
            await client.batch(token, put=[updated])
            new_date = next(s["date"] for s in updated["subtasks"] if s["id"] == sub["id"])
            return f"Moved sub-task {sub['title']!r} to {new_date}."
        task = logic.rescheduled_task(logic.find_task(state, task_id), date)
        await client.batch(token, put=[task])
        return f"Moved {task['title']!r} to {task['date']}."

    # ── DOCUMENTS ───────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "List which documents each kind of subject (person, car, ...) can hold: the categories, their "
            "types, which add_document parameters each uses, suggested detail fields per type, the pin "
            "label/default and renewal reminder defaults. Call it before add_document when unsure which "
            "category, type or fields fit."
        )
    )
    async def list_document_types(ctx: Context) -> str:
        reg = await client.get_registry(token_from_context(ctx))
        return _dumps(documents.describe_registry(reg))

    @mcp.tool(
        description=(
            "Add a document to any subject: a person (Identity: passport, driver license, ...; Health: "
            "results, referrals, prescriptions, ...), a car (insurance ID card, policy, registration, "
            "inspection, receipt, ...) or any other subject type coo knows (see list_document_types). "
            "`subject` is the person's name, the car's make/model or plate. `category` is only needed "
            "when the subject holds several kinds and `type` doesn't settle it (e.g. a person: identity "
            "or health). Only pass the fields the category uses; the API refuses others. "
            "`routine` links one of the subject's routines in the category's area: for IDs and car "
            "documents the older document of the same type on it is archived, and its open \"add the "
            "document\" task is closed; for IDs the routine moves to the new expiry. IDs with an expiry "
            "and no `routine` get a renewal routine with reminder steps (`remind` false to skip). If the "
            "person already has an active ID of that type the call is refused until you choose `routine` "
            "(replace) or `keep_both` (add alongside). Files can't be attached here; add them in the app."
        )
    )
    async def add_document(
        ctx: Context,
        subject: Annotated[str, Field(description="Whose document: person name, car make/model or plate")],
        name: Annotated[Optional[str], Field(description="Display name, e.g. \"GEICO insurance card\" (default: \"<Subject>’s <type>\")")] = None,
        category: Annotated[Optional[str], Field(description="identity, health, car, ... (inferred when the subject holds one kind)")] = None,
        type: Annotated[Optional[str], Field(description="Document type, e.g. Passport, Result, ID card (default: the category's)")] = None,
        valid_until: Annotated[Optional[str], Field(description="Expiry / valid until YYYY-MM-DD (identity, car)")] = None,
        date: Annotated[Optional[str], Field(description="Document date YYYY-MM-DD (health; default today)")] = None,
        id_number: Annotated[Optional[str], Field(description="Document number (identity; shown masked in lists)")] = None,
        issuer: Annotated[Optional[str], Field(description="Issued by (identity), e.g. U.S. Department of State")] = None,
        issue_date: Annotated[Optional[str], Field(description="Issue date YYYY-MM-DD (identity)")] = None,
        details: Annotated[Optional[dict[str, str]], Field(description="Extra fields (identity), e.g. {\"Nationality\": \"Portugal\"}")] = None,
        provider: Annotated[Optional[str], Field(description="Provider: a contact's name (health)")] = None,
        about: Annotated[Optional[str], Field(description="One line on what it's about (health)")] = None,
        episode: Annotated[Optional[str], Field(description="Episode grouping related documents (health), e.g. \"Knee injury\"")] = None,
        routine: Annotated[Optional[str], Field(description="Title of one of the subject's routines to link")] = None,
        pin: Annotated[Optional[bool], Field(description="Pin it at the top of the subject's page (Keep handy / glovebox); default per category")] = None,
        remind: Annotated[bool, Field(description="IDs: create renewal reminders from the expiry (default true)")] = True,
        remind_days: Annotated[Optional[int], Field(description="IDs: start reminding this many days before expiry")] = None,
        keep_both: Annotated[bool, Field(description="Add it even if the subject already has an active ID of this type")] = False,
    ) -> str:
        token = token_from_context(ctx)
        state = await client.get_state(token)
        reg = await client.get_registry(token)
        body, context = documents.build_request(
            state, reg, subject, name, category, type, valid_until, date, id_number, issuer, issue_date,
            details, provider, about, episode, routine, pin, remind, remind_days, keep_both,
        )
        try:
            result = await client.save_document(token, body)
        except client.ApiError as e:
            if e.status == 409:
                raise logic.ToolError(documents.duplicate_message(str(e.detail), e.body.get("existing", [])))
            if e.status in (400, 404):
                raise logic.ToolError(str(e.detail))
            raise
        return _dumps(documents.reply(result, context))

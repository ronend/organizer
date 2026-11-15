"""Tool registrations for the coo MCP server.

A deliberately small set over the coo API's two endpoints (GET /api/state,
POST /api/batch). Reads fetch the whole state and project it (see logic.py);
writes send FULL records back (the API upserts). Records mirror
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

from . import client, logic
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

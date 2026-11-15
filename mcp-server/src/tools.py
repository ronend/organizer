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
            "Add an identity document (passport, driver license, city or state ID, birth certificate, "
            "Social Security card, visa or residence card, other) to a person's Identity page. "
            "`details` is a map of extra fields; the usual ones per type are "
            "Passport: Full name, Nationality, Place of birth, Date of birth; "
            "Driver license: Full name, Class, Restrictions and endorsements, Date of birth; "
            "City or state ID: Full name, Date of birth; Birth certificate: Full name, Place of birth, Date of birth; "
            "Social Security card: Full name; Visa or residence card: Full name, Category, Nationality. "
            "With an expiry date and no `renewal_routine`, coo creates a renewal routine with reminder steps "
            "(set `remind` false to skip; `remind_days` defaults to 180 for passports, 60 for driver licenses "
            "and city/state IDs, else 90). Naming an existing renewal routine links it instead and archives "
            "the older ID of the same type on it, moving the routine to the new expiry. If the person already "
            "has an active ID of this type, the call is refused until you choose: pass `renewal_routine` "
            "(replace) or `keep_both` (add alongside). Images can't be attached here; add them in the app."
        )
    )
    async def add_id_document(
        ctx: Context,
        person: Annotated[str, Field(description="Whose document (person name)")],
        type: Annotated[str, Field(description="ID type, e.g. Passport, Driver license, City or state ID")],
        name: Annotated[Optional[str], Field(description="Display name (default: \"<Person>’s <type>\")")] = None,
        id_number: Annotated[Optional[str], Field(description="Document number (shown masked in lists)")] = None,
        issuer: Annotated[Optional[str], Field(description="Issued by, e.g. U.S. Department of State")] = None,
        issue_date: Annotated[Optional[str], Field(description="Issue date YYYY-MM-DD")] = None,
        expiry_date: Annotated[Optional[str], Field(description="Expiry date YYYY-MM-DD")] = None,
        details: Annotated[Optional[dict[str, str]], Field(description="Extra fields, e.g. {\"Nationality\": \"Portugal\"}")] = None,
        renewal_routine: Annotated[Optional[str], Field(description="Existing Identity routine of this person to link")] = None,
        remind: Annotated[bool, Field(description="Create renewal reminders from the expiry date (default true)")] = True,
        remind_days: Annotated[Optional[int], Field(description="Start reminding this many days before expiry")] = None,
        keep_handy: Annotated[bool, Field(description="Pin it to the person's Identity page")] = False,
        keep_both: Annotated[
            bool,
            Field(description="Add it even though the person already has an active ID of this type (e.g. two passports)"),
        ] = False,
    ) -> str:
        token = token_from_context(ctx)
        state = await client.get_state(token)
        puts, summary = documents.new_id_document(
            state, person, type, name, id_number, issuer, issue_date, expiry_date,
            details, renewal_routine, remind, remind_days, keep_handy, keep_both,
        )
        deletes = summary.pop("_delete", [])
        await client.batch(token, put=puts, delete=deletes)
        return _dumps(summary)

    @mcp.tool(
        description=(
            "Add a health document to a person's treatment history: Result, Referral, Prescription, "
            "Visit summary, Imaging, Vaccination record, Insurance or Other. `provider` is a Health or "
            "Other contact's name; `episode` groups related documents (e.g. \"Knee injury\"); `routine` "
            "links one of the person's Health routines and closes its open \"file the document\" task. "
            "The file itself can't be attached here; add it in the app."
        )
    )
    async def add_health_document(
        ctx: Context,
        person: Annotated[str, Field(description="Whose document (person name)")],
        name: Annotated[str, Field(description="Document name, e.g. \"MRI report, left knee\"")],
        type: Annotated[Optional[str], Field(description="Document type (default Other)")] = None,
        date: Annotated[Optional[str], Field(description="Document date YYYY-MM-DD (default today)")] = None,
        provider: Annotated[Optional[str], Field(description="Provider: a contact's name")] = None,
        about: Annotated[Optional[str], Field(description="One line on what this is about")] = None,
        episode: Annotated[Optional[str], Field(description="Episode name; reuses an existing one when it matches")] = None,
        routine: Annotated[Optional[str], Field(description="One of the person's Health routines to link")] = None,
        keep_handy: Annotated[bool, Field(description="Pin it to the person's Health page")] = False,
    ) -> str:
        token = token_from_context(ctx)
        state = await client.get_state(token)
        puts, summary = documents.new_health_document(
            state, person, name, type, date, provider, about, episode, routine, keep_handy
        )
        await client.batch(token, put=puts)
        return _dumps(summary)

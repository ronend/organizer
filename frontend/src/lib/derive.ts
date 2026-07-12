// Client-side derived views over the loaded events (mirrors the server's
// reminders_index and shopping-list derivations in backend/src/db/dynamo.py).
// We derive locally so the UI needs no extra fetch; the API endpoints exist for
// programmatic/MCP consumers.

import type {
  EventDocument,
  ReminderIndexEntry,
  ShoppingEntry,
  UpdateEvent,
} from '../types/organizer';
import { toDateStr } from './dates';

/** Flat list of every reminder across events, sorted by fire_at. */
export function deriveReminders(
  events: EventDocument[],
  opts: { status?: string } = {},
): (ReminderIndexEntry & { event_title: string })[] {
  const wantStatus = opts.status ?? 'pending';
  const out: (ReminderIndexEntry & { event_title: string })[] = [];
  for (const event of events) {
    const push = (
      rem: EventDocument['reminders'][number],
      itemId: string | null,
    ) => {
      if (!rem.fire_at) return;
      if (wantStatus && rem.status !== wantStatus) return;
      out.push({
        id: rem.id,
        event_id: event.id,
        item_id: itemId,
        title: rem.title,
        fire_at: rem.fire_at,
        recurrence_rule: rem.recurrence_rule,
        status: rem.status,
        event_title: event.title,
      });
    };
    event.reminders.forEach((r) => push(r, null));
    event.items.forEach((it) => it.reminders.forEach((r) => push(r, it.id)));
  }
  out.sort((a, b) => a.fire_at.localeCompare(b.fire_at));
  return out;
}

/** Checklist items that need purchasing and aren't yet purchased. */
export function deriveShopping(events: EventDocument[]): ShoppingEntry[] {
  const out: ShoppingEntry[] = [];
  for (const event of events) {
    for (const cl of event.checklists) {
      for (const ci of cl.items) {
        if (ci.needs_purchase && !ci.purchased) {
          out.push({
            ...ci,
            event_id: event.id,
            event_title: event.title,
            checklist_id: cl.id,
            checklist_name: cl.name,
          });
        }
      }
    }
  }
  out.sort((a, b) => a.event_title.localeCompare(b.event_title) || a.sort_order - b.sort_order);
  return out;
}

// ── Timeline ─────────────────────────────────────────────────────────────────
// A single agenda over EVERYTHING: events (by start_date), their tasks/items
// (by scheduled_at/due_at), and reminders (by fire_at). Anything without a date
// still appears — in an "unscheduled" bucket — so nothing is hidden. Each entry
// knows which date field it owns, so the UI can drag rows onto a day to (re)set
// that date.

export type TimelineSource = 'event' | 'item' | 'reminder';
export type TimelineDateField = 'start_date' | 'scheduled_at' | 'due_at' | 'fire_at';

export interface TimelineEntry {
  key: string;
  eventId: string;
  source: TimelineSource;
  reminderId: string | null;
  itemId: string | null; // set for item entries and item-level reminders
  dateField: TimelineDateField; // the field a reschedule writes to
  title: string;
  eventTitle: string;
  kind: EventDocument['kind'];
  date: string | null; // ISO date/datetime, or null when unscheduled
  hasTime: boolean;
  status: string;
  tags: string[];
  recurrenceRule: string | null;
}

function isDoneStatus(status: string): boolean {
  return status === 'done' || status === 'cancelled';
}

/** Flatten every event, item and reminder into timeline entries. */
export function deriveTimeline(
  events: EventDocument[],
  opts: { includeDone?: boolean } = {},
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const event of events) {
    const eventTitle = event.title || '(untitled)';

    // The event itself.
    if (opts.includeDone || !isDoneStatus(event.status)) {
      out.push({
        key: `event:${event.id}`,
        eventId: event.id,
        source: 'event',
        reminderId: null,
        itemId: null,
        dateField: 'start_date',
        title: eventTitle,
        eventTitle,
        kind: event.kind,
        date: event.start_date ?? null,
        hasTime: !!event.start_date && event.start_date.includes('T'),
        status: event.status,
        tags: event.tags,
        recurrenceRule: event.recurrence_rule,
      });
    }

    // Its tasks / items (each may carry its own schedule or due date).
    for (const item of event.items) {
      if (!opts.includeDone && isDoneStatus(item.status)) continue;
      const dateField: TimelineDateField = item.scheduled_at
        ? 'scheduled_at'
        : item.due_at
          ? 'due_at'
          : item.kind === 'task'
            ? 'due_at'
            : 'scheduled_at';
      const date = item.scheduled_at ?? item.due_at ?? null;
      out.push({
        key: `item:${event.id}:${item.id}`,
        eventId: event.id,
        source: 'item',
        reminderId: null,
        itemId: item.id,
        dateField,
        title: item.title || 'Task',
        eventTitle,
        kind: event.kind,
        date,
        hasTime: !!date && date.includes('T'),
        status: item.status,
        tags: item.tags.length ? item.tags : event.tags,
        recurrenceRule: null,
      });
    }

    // Reminders (event-level + item-level).
    const pushReminder = (rem: EventDocument['reminders'][number], itemId: string | null) => {
      if (!opts.includeDone && rem.status !== 'pending' && rem.status !== 'snoozed') return;
      out.push({
        key: `reminder:${event.id}:${itemId ?? 'event'}:${rem.id}`,
        eventId: event.id,
        source: 'reminder',
        reminderId: rem.id,
        itemId,
        dateField: 'fire_at',
        title: rem.title || 'Reminder',
        eventTitle,
        kind: event.kind,
        date: rem.fire_at ?? null,
        hasTime: !!rem.fire_at && rem.fire_at.includes('T'),
        status: rem.status,
        tags: event.tags,
        recurrenceRule: rem.recurrence_rule,
      });
    };
    event.reminders.forEach((r) => pushReminder(r, null));
    event.items.forEach((it) => it.reminders.forEach((r) => pushReminder(r, it.id)));
  }

  // Dated entries first (earliest → latest), then unscheduled ones by title.
  out.sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.title.localeCompare(b.title);
  });
  return out;
}

/** The local YYYY-MM-DD an entry falls on, or null when unscheduled. */
export function timelineDay(entry: TimelineEntry): string | null {
  return entry.date ? entry.date.slice(0, 10) : null;
}

/**
 * Apply `day` to an ISO value. Keeps an existing time-of-day; when there was no
 * date at all, date-only fields get just the day and timed fields default to 9am.
 */
function applyDay(iso: string | null, day: string, dateOnly: boolean): string {
  if (!iso) return dateOnly ? day : `${day}T09:00:00`;
  return iso.includes('T') ? `${day}T${iso.split('T')[1]}` : day;
}

/**
 * Build the update payload that moves an entry onto `day`. Returns null when
 * the entry is already on that day (no write needed).
 */
export function rescheduleEntry(
  event: EventDocument,
  entry: TimelineEntry,
  day: string,
): UpdateEvent | null {
  if (timelineDay(entry) === day) return null;
  const dateOnly = entry.dateField === 'start_date';
  const nextDate = applyDay(entry.date, day, dateOnly);

  if (entry.source === 'event') {
    return { start_date: nextDate };
  }

  if (entry.source === 'item') {
    const items = event.items.map((it) =>
      it.id === entry.itemId ? { ...it, [entry.dateField]: nextDate } : it,
    );
    return { items };
  }

  // Reminder: rebuild the array it belongs to with a new fire_at.
  if (entry.itemId) {
    const items = event.items.map((it) =>
      it.id === entry.itemId
        ? {
            ...it,
            reminders: it.reminders.map((r) =>
              r.id === entry.reminderId ? { ...r, fire_at: nextDate } : r,
            ),
          }
        : it,
    );
    return { items };
  }
  const reminders = event.reminders.map((r) =>
    r.id === entry.reminderId ? { ...r, fire_at: nextDate } : r,
  );
  return { reminders };
}

/**
 * The ordered list of day-buckets to render for the DATED entries, plus a
 * rolling window of upcoming days so there are always empty drop targets.
 */
export function timelineDays(entries: TimelineEntry[], upcomingDays = 14): string[] {
  const set = new Set<string>();
  entries.forEach((e) => {
    const day = timelineDay(e);
    if (day) set.add(day);
  });
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < upcomingDays; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    set.add(toDateStr(d));
  }
  return Array.from(set).sort();
}

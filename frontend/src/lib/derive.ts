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
// A single chronological agenda over everything with a date: events (by
// start_date) and pending reminders (by fire_at). Each entry knows how to
// reschedule itself so the UI can drag rows between days.

export type TimelineSource = 'event' | 'reminder';

export interface TimelineEntry {
  key: string;
  eventId: string;
  source: TimelineSource;
  reminderId: string | null;
  itemId: string | null; // set when a reminder lives on an event item
  title: string;
  eventTitle: string;
  kind: EventDocument['kind'];
  date: string; // ISO date ("2026-07-14") or datetime ("...T09:00")
  hasTime: boolean;
  status: string;
  tags: string[];
  recurrenceRule: string | null;
}

function isDoneStatus(status: string): boolean {
  return status === 'done' || status === 'cancelled';
}

/** Everything with a date, flattened and sorted earliest-first. */
export function deriveTimeline(
  events: EventDocument[],
  opts: { includeDone?: boolean } = {},
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const event of events) {
    const done = isDoneStatus(event.status);
    if (event.start_date && (opts.includeDone || !done)) {
      out.push({
        key: `event:${event.id}`,
        eventId: event.id,
        source: 'event',
        reminderId: null,
        itemId: null,
        title: event.title || '(untitled)',
        eventTitle: event.title || '(untitled)',
        kind: event.kind,
        date: event.start_date,
        hasTime: event.start_date.includes('T'),
        status: event.status,
        tags: event.tags,
        recurrenceRule: event.recurrence_rule,
      });
    }

    const pushReminder = (
      rem: EventDocument['reminders'][number],
      itemId: string | null,
    ) => {
      if (!rem.fire_at) return;
      if (!opts.includeDone && rem.status !== 'pending' && rem.status !== 'snoozed') return;
      out.push({
        key: `reminder:${event.id}:${itemId ?? 'event'}:${rem.id}`,
        eventId: event.id,
        source: 'reminder',
        reminderId: rem.id,
        itemId,
        title: rem.title || 'Reminder',
        eventTitle: event.title || '(untitled)',
        kind: event.kind,
        date: rem.fire_at,
        hasTime: rem.fire_at.includes('T'),
        status: rem.status,
        tags: event.tags,
        recurrenceRule: rem.recurrence_rule,
      });
    };
    event.reminders.forEach((r) => pushReminder(r, null));
    event.items.forEach((it) => it.reminders.forEach((r) => pushReminder(r, it.id)));
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** The local YYYY-MM-DD an entry falls on. */
export function timelineDay(entry: TimelineEntry): string {
  return entry.date.slice(0, 10);
}

/** Replace the calendar day of an ISO value, keeping any time-of-day intact. */
function withDay(iso: string, day: string): string {
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
  const nextDate = withDay(entry.date, day);

  if (entry.source === 'event') {
    return { start_date: nextDate };
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
 * The ordered list of day-buckets to render: every day that has an entry, plus
 * a rolling window of upcoming days so there are always empty drop targets.
 */
export function timelineDays(entries: TimelineEntry[], upcomingDays = 14): string[] {
  const set = new Set<string>();
  entries.forEach((e) => set.add(timelineDay(e)));
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  for (let i = 0; i < upcomingDays; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    set.add(toDateStr(d));
  }
  return Array.from(set).sort();
}

// Client-side derived views over the loaded entities. We derive locally so the
// UI needs no extra fetch; the equivalent API endpoints (reminders, story
// timeline) exist for programmatic/MCP consumers.

import type { Entity, EntityType, Reservation, EventEntity, Story } from '../types/organizer';
import { entityDate, isCompleted } from '../types/organizer';
import { applyOffset, epoch } from './dates';

/** Entities sorted by their relevant date (earliest first); undated last. */
export function sortedByDate(items: Entity[]): Entity[] {
  return [...items].sort((a, b) => {
    const ea = epoch(entityDate(a));
    const eb = epoch(entityDate(b));
    if (ea !== eb) return ea - eb;
    return a.title.localeCompare(b.title);
  });
}

// ── Story timeline ───────────────────────────────────────────────────────────

export type TimelineItem = Reservation | EventEntity;

/** Resolve a story's ordered refs to its reservations/events, chronologically.
 * Missing or wrong-type refs are skipped (mirrors the server derivation). */
export function storyTimeline(items: Entity[], story: Story): TimelineItem[] {
  const byId = new Map(items.map((e) => [e.id, e]));
  const resolved: TimelineItem[] = [];
  for (const ref of story.item_refs) {
    const target = byId.get(ref);
    if (target && (target.type === 'reservation' || target.type === 'event')) {
      resolved.push(target);
    }
  }
  return resolved.sort((a, b) => epoch(entityDate(a)) - epoch(entityDate(b)));
}

// ── Reminders ────────────────────────────────────────────────────────────────

export interface ReminderRow {
  key: string;
  sourceId: string;
  sourceType: EntityType;
  title: string;
  fireAt: string;
  done: boolean;
}

/**
 * Flatten every entity's notification triggers into reminder rows, sorted by
 * fire time. Mirrors backend/src/db/dynamo._index_entries: routines contribute
 * one row per scheduled reminder; dated non-routine items contribute a single
 * row at their own date/time; habits and stories contribute none.
 */
export function deriveReminders(items: Entity[], opts: { upcomingOnly?: boolean } = {}): ReminderRow[] {
  const now = Date.now();
  const rows: ReminderRow[] = [];

  for (const e of items) {
    const done = isCompleted(e);
    const push = (key: string, fireAt: string | null | undefined) => {
      if (fireAt) rows.push({ key, sourceId: e.id, sourceType: e.type, title: e.title, fireAt, done });
    };

    switch (e.type) {
      case 'routine':
        e.reminders.forEach((r, i) => {
          const fireAt = r.kind === 'absolute' ? r.at : applyOffset(e.due_at, r.offset);
          push(`${e.id}#r${i}`, fireAt);
        });
        break;
      case 'todo':
        push(e.id, e.due_at);
        break;
      case 'appointment':
      case 'reservation':
        push(e.id, e.date_time);
        break;
      case 'event':
        push(e.id, e.start_at);
        break;
      default:
        break; // habit, story
    }
  }

  let out = rows.sort((a, b) => a.fireAt.localeCompare(b.fireAt));
  if (opts.upcomingOnly) out = out.filter((r) => !r.done && epoch(r.fireAt) >= now);
  return out;
}

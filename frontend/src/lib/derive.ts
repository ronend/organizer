// Client-side derived views over the loaded events (mirrors the server's
// reminders_index and shopping-list derivations in backend/src/db/dynamo.py).
// We derive locally so the UI needs no extra fetch; the API endpoints exist for
// programmatic/MCP consumers.

import type { EventDocument, ReminderIndexEntry, ShoppingEntry } from '../types/organizer';

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

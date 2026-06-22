// Domain types mirroring backend/src/routes/events.py and data-structure.md.
// Field names are snake_case to match the API payloads exactly (no remapping).

// `kind` drives behavior (rendering, reminder/recurrence logic).
export const EVENT_KINDS = ['container', 'occurrence', 'habit', 'list'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

// `kind` on an item.
export const ITEM_KINDS = ['task', 'reservation', 'entry', 'checklist_item'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

// Tags are free-form, user-defined labels.
export type Tag = string;

// `attrs` is an open extension bag — arbitrary key/value pairs.
export type Attrs = Record<string, unknown>;

/** A reminder, embedded on an event or on a specific item. */
export interface Reminder {
  id: string;
  title: string;
  status: string; // "pending" | "snoozed" | "done" | "skipped"
  fire_at: string; // ISO 8601 datetime — computed absolute time
  offset_rule: string | null; // relative rule, e.g. "-30d", "-2h", "+1d", "0"
  recurrence_rule: string | null; // RFC 5545 RRULE for repeating reminders
  notes: string | null;
  url: string | null;
  login_hint: string | null;
  attrs: Attrs;
}

/** An item embedded in an event (task / reservation / entry / checklist_item). */
export interface Item {
  id: string;
  kind: ItemKind;
  subtype: string;
  tags: Tag[];
  title: string;
  status: string; // "todo" | "confirmed" | "done" | "cancelled" — extensible
  scheduled_at: string | null; // ISO 8601 datetime — when this item happens
  due_at: string | null; // ISO 8601 datetime — when a task is due
  sort_order: number;
  // Reservation fields:
  confirmation_ref: string | null;
  cost: number | null;
  currency: string | null;
  address: string | null;
  phone: string | null;
  url: string | null;
  login_hint: string | null;
  // Task fields:
  prereq_ids: string[];
  attrs: Attrs;
  reminders: Reminder[];
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  needs_purchase: boolean;
  purchased: boolean;
  notes: string | null;
  sort_order: number;
}

export interface ChecklistInstance {
  id: string;
  template_id: string | null;
  name: string;
  items: ChecklistItem[];
}

export interface Attachment {
  id: string;
  label: string;
  item_id: string | null; // null → belongs to the event; else to a specific item
  mime_type: string | null;
  url: string | null;
  storage_key: string | null;
}

/** The top-level entity. Everything about an event lives in this one document. */
export interface EventDocument {
  id: string;
  parent_id: string | null;
  kind: EventKind;
  subtype: string;
  tags: Tag[];
  title: string;
  status: string; // "planned" | "active" | "done" | "cancelled" — extensible
  start_date: string | null; // ISO 8601 date "2026-07-14"
  end_date: string | null;
  recurrence_rule: string | null; // RFC 5545 RRULE
  attrs: Attrs;
  items: Item[];
  reminders: Reminder[]; // event-level reminders
  checklists: ChecklistInstance[];
  attachments: Attachment[];
  created_at: string;
  updated_at: string;
}

// ── Templates ──────────────────────────────────────────────────────────────

export interface TemplateItem {
  id: string;
  label: string;
  category: string | null;
  needs_purchase: boolean;
  sort_order: number;
  default_reminder_offset: string | null;
  notes: string | null;
}

export interface Template {
  id: string;
  name: string;
  applies_to_subtype: string | null;
  auto_apply: boolean;
  description: string | null;
  tags: Tag[];
  items: TemplateItem[];
  created_at: string;
  updated_at: string;
}

// ── Derived views ────────────────────────────────────────────────────────────

/** A flat reminders_index row (what fires next). */
export interface ReminderIndexEntry {
  id: string;
  event_id: string;
  item_id: string | null;
  title: string;
  fire_at: string;
  recurrence_rule: string | null;
  status: string;
}

/** A row of the derived shopping list. */
export interface ShoppingEntry extends ChecklistItem {
  event_id: string;
  event_title: string;
  checklist_id: string;
  checklist_name: string;
}

// ── Create/update payloads ────────────────────────────────────────────────────

/** Fields the client sends when creating an event. Server fills ids + timestamps
 * + reminder fire_at. Subdocument ids may be omitted on create. */
export type NewEvent = {
  kind: EventKind;
  subtype?: string;
  tags?: Tag[];
  title: string;
  status?: string;
  parent_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  recurrence_rule?: string | null;
  attrs?: Attrs;
  items?: Partial<Item>[];
  reminders?: Partial<Reminder>[];
  checklists?: Partial<ChecklistInstance>[];
  attachments?: Partial<Attachment>[];
};

export type UpdateEvent = Partial<NewEvent>;

export type NewTemplate = {
  name: string;
  applies_to_subtype?: string | null;
  auto_apply?: boolean;
  description?: string | null;
  tags?: Tag[];
  items?: Partial<TemplateItem>[];
};

// ── Display helpers ────────────────────────────────────────────────────────

/** Normalize a free-form tag label (lowercase, trimmed, capped). */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 40);
}

/** Title-case a tag/tab label for display. */
export function labelize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const EVENT_KIND_META: Record<EventKind, { icon: string; label: string; blurb: string }> = {
  container: {
    icon: '🧳',
    label: 'Trip / Project',
    blurb: 'A trip, project, or life area with a date span. Holds items and reminders.',
  },
  occurrence: {
    icon: '📅',
    label: 'Appointment',
    blurb: 'A single appointment or deadline that may recur (dentist, inspection).',
  },
  habit: {
    icon: '🔄',
    label: 'Habit',
    blurb: 'A lightweight recurring entry driven by reminders (medication, payments).',
  },
  list: {
    icon: '✅',
    label: 'List',
    blurb: 'No dates — check-off items and checklists (groceries, shopping).',
  },
};

export const ITEM_KIND_META: Record<ItemKind, { icon: string; label: string }> = {
  task: { icon: '☑️', label: 'Task' },
  reservation: { icon: '🎟️', label: 'Reservation' },
  entry: { icon: '📝', label: 'Entry' },
  checklist_item: { icon: '✔️', label: 'Checklist item' },
};

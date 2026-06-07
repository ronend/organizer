// 'errand' is the one permanent category: it's always a tab (even with zero
// items) and is the fallback when another label is deleted. Every other
// category is a free-form label that exists only while an item uses it.
export const DEFAULT_CATEGORY = 'errand';
export type Category = string;

export const ITEM_TYPES = ['simple', 'complex', 'repeat', 'project', 'routine'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

// --- Routine support ---
export type RecurrenceFreq = 'day' | 'week' | 'month';

export interface Recurrence {
  freq: RecurrenceFreq;
  interval: number; // every N freq units (>= 1)
  weekdays?: number[]; // for 'week': 0=Sun .. 6=Sat
  monthDay?: number; // for 'month': 1..31
}

/** A prerequisite template on a routine: a sub-item due `leadDays`/`leadHours`
 * before each occurrence. */
export interface Prerequisite {
  title: string;
  leadDays: number;
  leadHours?: number;
}

/** Normalize a free-form category label (lowercase, trimmed, capped). */
export function normalizeCategory(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 40);
}

/** Title-case a category/tab label for display. */
export function labelize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface Organizer {
  id: string;
  userId: string;
  createdAt: string;
  category: Category;
  type: ItemType;
  title: string;
  description: string; // rich text (HTML)
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:MM
  done: boolean;
  // Routine fields (only on type === 'routine'):
  recurrence?: Recurrence | null;
  prerequisites?: Prerequisite[];
  // Prerequisite-item fields (a sub-item spawned from a routine):
  parentId?: string | null;
  isPrereq?: boolean;
}

/** Fields the client sends when creating an item. */
export type NewOrganizer = Omit<Organizer, 'id' | 'userId' | 'createdAt'>;

// 'errand' is the one permanent category: it's always a tab (even with zero
// items) and is the fallback when another label is deleted. Every other
// category is a free-form label that exists only while an item uses it.
export const DEFAULT_CATEGORY = 'errand';
export type Category = string;

export const ITEM_TYPES = ['simple', 'complex', 'repeat', 'project', 'routine'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

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
}

/** Fields the client sends when creating an item. */
export type NewOrganizer = Omit<Organizer, 'id' | 'userId' | 'createdAt'>;

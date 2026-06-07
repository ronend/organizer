export const CATEGORIES = ['errand', 'project', 'health', 'finance', 'home'] as const;
export type Category = (typeof CATEGORIES)[number];

export const ITEM_TYPES = ['simple', 'complex', 'repeat', 'project'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

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

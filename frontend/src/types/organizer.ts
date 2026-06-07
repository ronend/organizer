// The three purpose-built entry types. 'trip' is reserved for Phase 2 (not yet
// creatable in the UI) but the type is defined so stored/legacy data is typed.
export const ENTRY_TYPES = ['task', 'trip', 'recurring'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

// Tags are free-form, user-defined labels. An entry may carry several.
export type Tag = string;

// --- Recurring support (recurrence engine shape is reused unchanged) ---
export type RecurrenceFreq = 'day' | 'week' | 'month';

export interface Recurrence {
  freq: RecurrenceFreq;
  interval: number; // every N freq units (>= 1)
  weekdays?: number[]; // for 'week': 0=Sun .. 6=Sat (not exposed in the new UI)
  monthDay?: number; // for 'month': 1..31
}

/** A reminder on a recurring entry: a sub-task auto-created `daysBefore` each
 * occurrence. (Replaces the old "prerequisite".) */
export interface Reminder {
  label: string;
  daysBefore: number;
  note?: string;
}

/** A contact attached to a task. */
export interface Contact {
  name: string;
  role: string;
  phone: string;
  email: string;
}

/** A "depends on" link from a task to another entry. */
export interface DependsOnRef {
  entryId: string;
  daysBefore: number;
}

/** Normalize a free-form tag label (lowercase, trimmed, capped). */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 40);
}

/** Title-case a tag/tab label for display. */
export function labelize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface Organizer {
  id: string;
  userId: string;
  createdAt: string;
  type: EntryType;
  title: string;
  description: string; // rich text (HTML)
  tags: Tag[];
  dueDate: string; // YYYY-MM-DD
  dueTime: string; // HH:MM
  done: boolean;
  // Task fields:
  link?: string;
  contacts?: Contact[];
  dependsOn?: DependsOnRef[];
  // Recurring fields (only on type === 'recurring'):
  recurrence?: Recurrence | null;
  reminders?: Reminder[];
  // Spawned-reminder fields (a sub-task auto-created from a recurring entry):
  parentId?: string | null;
  isPrereq?: boolean;
}

/** Fields the client sends when creating an entry. */
export type NewOrganizer = Omit<Organizer, 'id' | 'userId' | 'createdAt'>;

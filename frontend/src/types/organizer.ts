// Domain types for the flat 7-type entity model. Mirrors the backend Pydantic
// union in backend/src/routes/items.py exactly (snake_case field names — no
// remapping between API payloads and the client).

export const ENTITY_TYPES = [
  'todo',
  'appointment',
  'habit',
  'routine',
  'reservation',
  'event',
  'story',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const RESERVATION_SUBTYPES = ['hotel', 'flight', 'tour', 'activity', 'restaurant'] as const;
export type ReservationSubtype = (typeof RESERVATION_SUBTYPES)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

// ── Sub-schemas ──────────────────────────────────────────────────────────────

export interface ContactDetails {
  name?: string;
  phone?: string;
  email?: string;
}

export type RecurrenceRule =
  | { freq: 'daily'; interval?: number }
  | { freq: 'weekly'; interval?: number; days: Weekday[] }
  | { freq: 'every_n_days'; n: number }
  | { freq: 'monthly'; interval?: number; day_of_month: number };

export type ReminderTime =
  | { kind: 'offset'; offset: string } // relative to due_at, e.g. "-2h", "-1d"
  | { kind: 'absolute'; at: string }; // absolute ISO datetime

// ── Base + the seven entities ────────────────────────────────────────────────

interface BaseEntity {
  id: string;
  type: EntityType;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Todo extends BaseEntity {
  type: 'todo';
  due_at: string;
  completed: boolean;
}

export interface Appointment extends BaseEntity {
  type: 'appointment';
  date_time: string;
  location: string | null;
  contact: ContactDetails;
  things_to_bring: string[];
  completed: boolean;
}

export interface Habit extends BaseEntity {
  type: 'habit';
  recurrence: RecurrenceRule;
  completion_log: Record<string, boolean>;
}

export interface Routine extends BaseEntity {
  type: 'routine';
  due_at: string;
  reminders: ReminderTime[];
  completed: boolean;
}

export interface Reservation extends BaseEntity {
  type: 'reservation';
  subtype: ReservationSubtype;
  date_time: string;
  location: string | null;
  details: string | Record<string, unknown> | null;
  reservation_number: string | null;
}

export interface EventEntity extends BaseEntity {
  type: 'event';
  start_at: string;
  end_at: string;
  details: string | null;
}

export interface Story extends BaseEntity {
  type: 'story';
  item_refs: string[]; // ordered ids of reservation/event entities only
}

export type Entity = Todo | Appointment | Habit | Routine | Reservation | EventEntity | Story;

// ── Create/update payloads ────────────────────────────────────────────────────

// Distributive Omit so each union member keeps its own shape.
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** What a form submits: a full, valid entity minus the server-owned fields. */
export type NewEntity = DistributiveOmit<Entity, 'id' | 'created_at' | 'updated_at'>;

/** A partial update sent to PUT (server re-validates the merged document). */
export type EntityUpdate = Record<string, unknown>;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** The date field an entity is sorted/displayed by, or null when it has none. */
export function entityDate(e: Entity): string | null {
  switch (e.type) {
    case 'todo':
    case 'routine':
      return e.due_at;
    case 'appointment':
    case 'reservation':
      return e.date_time;
    case 'event':
      return e.start_at;
    case 'habit':
    case 'story':
      return null;
  }
}

/** True for the types that carry a `completed` flag. */
export function isCompletable(e: Entity): e is Todo | Appointment | Routine {
  return e.type === 'todo' || e.type === 'appointment' || e.type === 'routine';
}

export function isCompleted(e: Entity): boolean {
  return isCompletable(e) && e.completed;
}

/** Title-case a short label for display. */
export function labelize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const ENTITY_META: Record<EntityType, { label: string; blurb: string }> = {
  todo: { label: 'Todo', blurb: 'A single task with a due date and time.' },
  appointment: {
    label: 'Appointment',
    blurb: 'A dated meeting with a location, contact, and things to bring.',
  },
  habit: { label: 'Habit', blurb: 'A recurring practice with no fixed end — tracked by a completion log.' },
  routine: { label: 'Routine', blurb: 'A dated task that can carry several scheduled reminders.' },
  reservation: {
    label: 'Reservation',
    blurb: 'A booking — hotel, flight, tour, activity, or restaurant — with a confirmation number.',
  },
  event: { label: 'Event', blurb: 'Something with a start and end time.' },
  story: { label: 'Story', blurb: 'An ordered collection of reservations and events on a timeline.' },
};

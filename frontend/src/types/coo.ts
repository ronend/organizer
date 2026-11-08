/**
 * coo data model — the contract shared with the backend.
 *
 * The backend (backend/src/models.py) mirrors these shapes exactly (pydantic,
 * extra fields forbidden). Every stored record carries a `kind` discriminator
 * and an `id`. All records belong to the signed-in user's household; the
 * backend scopes them by the Cognito `sub`.
 *
 * Date conventions
 *   ISODate        'YYYY-MM-DD'        (calendar day, no time zone)
 *   LocalDateTime  'YYYY-MM-DDTHH:mm'  (wall-clock time at the destination)
 *   Timestamp      full ISO 8601 with zone (createdAt / updatedAt / doneAt)
 */

export type ISODate = string;
export type LocalDateTime = string;
export type Timestamp = string;

export interface FileRef {
  /** S3 object key, always under the user's own prefix. */
  key: string;
  name: string;
  contentType: string;
  size: number;
}

interface Base {
  id: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type SubjectType = 'person' | 'car';

// ── Subjects ────────────────────────────────────────────────────────────────

export interface Person extends Base {
  kind: 'person';
  name: string;
  birthYear: number | null;
}

export interface Car extends Base {
  kind: 'car';
  makeModel: string;
  /** Stored uppercase, unique across cars. */
  plate: string;
  odometer: number | null;
}

export type ContactGroup = 'health' | 'cars' | 'other';

export interface Contact extends Base {
  kind: 'contact';
  name: string;
  role: string;
  phone: string;
  group: ContactGroup;
  notes: string;
}

// ── Routines ────────────────────────────────────────────────────────────────

export type Area = 'health' | 'identity' | 'car';

/**
 * plain    — completing just marks it done
 * schedule — completing asks for date/time/provider/prep and books an appointment
 * renew    — completing asks for the next date and plans the next cycle
 * pickup   — completing asks quantity received + refills left (medication)
 */
export type StepKind = 'plain' | 'schedule' | 'renew' | 'pickup';

export type DocKind = 'car' | 'health' | 'identity';

/** Marks a "file the new document" task; its detail offers "Add document". */
export interface DocTaskSpec {
  docKind: DocKind;
  docType: string;
}

export interface StepPlan {
  title: string;
  /** Days relative to the due date (plan) or to the completion date (follow-ups). */
  offsetDays: number;
  kind: StepKind;
  /** Default prep note offered when booking (schedule steps). */
  prep: string;
  docTask: DocTaskSpec | null;
}

/** A routine is written once; per-subject state lives on Assignment. */
export interface Routine extends Base {
  kind: 'routine';
  area: Area;
  /** Template key (see lib/templates.ts) or null for Blank. */
  template: string | null;
  icon: string;
  title: string;
  description: string;
  /** "Expires", "Due", "Valid until", "Next due", "Runs out". */
  dateLabel: string;
  /** Steps planned before each due date. Empty for medication (computed). */
  plan: StepPlan[];
  /** Tasks filed after a cycle completes (offset from the completion date). */
  followUps: StepPlan[];
  /** Default repeat for new assignees (months), null = doesn't repeat. */
  repeatMonths: number | null;
  /** Base for the next due date: the day it was done, or the previous due date. */
  countFrom: 'done' | 'due';
  medication: boolean;
}

export interface MedicationSupply {
  /** Units on hand as of `asOf`. */
  onHand: number;
  asOf: ISODate;
  perDay: number;
  unit: string;
  perRefill: number;
  refillsLeft: number;
  orderLeadDays: number;
}

export interface HistoryEntry {
  date: ISODate;
  text: string;
}

/** One routine assigned to one person or car, with its own date and status. */
export interface Assignment extends Base {
  kind: 'assignment';
  routineId: string;
  subjectType: SubjectType;
  subjectId: string;
  /** Due / expiry / run-out date. null = no schedule. */
  date: ISODate | null;
  repeatMonths: number | null;
  /** A non-repeating routine that was completed. */
  done: boolean;
  /** Preferred contact. */
  contactId: string | null;
  supply: MedicationSupply | null;
  history: HistoryEntry[];
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export interface AppointmentInfo {
  /** 'HH:mm' or '' */
  time: string;
  providerId: string | null;
  /** Free-text provider / location note. */
  providerNote: string;
  prep: string;
}

export type TripTaskKind = 'book' | 'checkin';

export interface Task extends Base {
  kind: 'task';
  title: string;
  notes: string;
  /** null = unscheduled ("Needs a date"). */
  date: ISODate | null;
  /** Secondary sort after date; the user's manual order within a day. */
  order: number;
  done: boolean;
  doneAt: Timestamp | null;
  /** null subject = General (or a trip task when tripId is set). */
  subjectType: SubjectType | null;
  subjectId: string | null;
  /** Routine step when set. */
  assignmentId: string | null;
  stepKind: StepKind;
  /** Booked appointment (not draggable). */
  appointment: AppointmentInfo | null;
  tripId: string | null;
  reservationId: string | null;
  tripTask: TripTaskKind | null;
  docTask: DocTaskSpec | null;
}

// ── Documents ───────────────────────────────────────────────────────────────

export interface DetailRow {
  name: string;
  value: string;
}

export interface Document extends Base {
  kind: 'document';
  docKind: DocKind;
  subjectType: SubjectType;
  subjectId: string;
  name: string;
  type: string;
  /** Health: document date. */
  date: ISODate | null;
  /** Car: valid until. Identity: expiry date. */
  validUntil: ISODate | null;
  /** Identity only. */
  idNumber: string;
  issuer: string;
  issueDate: ISODate | null;
  details: DetailRow[];
  front: FileRef | null;
  back: FileRef | null;
  /** Health: provider contact + one-line context + episode. */
  providerId: string | null;
  about: string;
  episode: string;
  /** Car and health: the uploaded file. */
  file: FileRef | null;
  assignmentId: string | null;
  /** "Keep handy" / "Keep in the glovebox". */
  pinned: boolean;
  archived: boolean;
  /** Replaced by a renewal; shown with an amber "Outdated" chip. */
  outdated: boolean;
}

// ── Trips ───────────────────────────────────────────────────────────────────

export interface Trip extends Base {
  kind: 'trip';
  name: string;
  destination: string;
  start: ISODate;
  end: ISODate;
  /** Person ids. */
  travelers: string[];
  notes: string;
}

export type ReservationType = 'flight' | 'stay' | 'car' | 'activity' | 'hike' | 'train' | 'other';

export interface Reservation extends Base {
  kind: 'reservation';
  tripId: string;
  type: ReservationType;
  title: string;
  start: LocalDateTime;
  end: LocalDateTime | null;
  address: string;
  confirmation: string;
  link: string;
  files: FileRef[];
  status: 'booked' | 'planned';
  bookBy: ISODate | null;
  details: string;
  /** Flights: "Remind me to check in online the day before". */
  checkinReminder: boolean;
}

// ── Union + API shapes ──────────────────────────────────────────────────────

export type Entity =
  | Person
  | Car
  | Contact
  | Routine
  | Assignment
  | Task
  | Document
  | Trip
  | Reservation;

export type EntityKind = Entity['kind'];

export const ENTITY_KINDS: EntityKind[] = [
  'person',
  'car',
  'contact',
  'routine',
  'assignment',
  'task',
  'document',
  'trip',
  'reservation',
];

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

/** POST /api/batch body. Puts are full records (upserts); deletes by ref. */
export interface ChangeSet {
  put: Entity[];
  delete: EntityRef[];
}

/** GET /api/state response. */
export interface CooState {
  people: Person[];
  cars: Car[];
  contacts: Contact[];
  routines: Routine[];
  assignments: Assignment[];
  tasks: Task[];
  documents: Document[];
  trips: Trip[];
  reservations: Reservation[];
}

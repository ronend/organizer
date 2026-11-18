/**
 * coo data model, version 2 — the contract shared with the backend.
 *
 * The backend (backend/src/models.py) mirrors these shapes exactly (pydantic,
 * extra fields forbidden) and checks every write against the whole household
 * (backend/src/integrity.py). Everything extensible — subject types and their
 * attributes, document categories and fields, reservation types, routine
 * areas — comes from the registry (lib/registry.json). See data-structure.md.
 *
 * Date conventions
 *   ISODate        'YYYY-MM-DD'        (calendar day, no time zone)
 *   LocalDateTime  'YYYY-MM-DDTHH:mm'  (wall-clock time at the destination)
 *   Timestamp      full ISO 8601 with zone (createdAt / updatedAt / doneAt)
 */

export type ISODate = string;
export type LocalDateTime = string;
export type Timestamp = string;

type Registry = typeof import('../lib/registry.json');

/**
 * person, car, trip (built into the registry) or a type the household defined
 * through the API / MCP (a `subjectType` record), e.g. "apartment".
 */
export type SubjectType = keyof Registry['subjectTypes'] | (string & {});
/** identity, health, car, attachment, ... (registry documentCategories). */
export type DocCategory = keyof Registry['documentCategories'];
/** health, identity, car, ... (registry routineAreas). */
export type RoutineArea = keyof Registry['routineAreas'];
/** flight, stay, ... (registry reservationTypes). */
export type ReservationType = keyof Registry['reservationTypes'];

/** A registry-defined field value. */
export type FieldValue = string | number | boolean | null | string[];
export type Fields = Record<string, FieldValue>;

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
  archived: boolean;
}

// ── Subjects ────────────────────────────────────────────────────────────────

/** A container — a person, a car, a trip, ... — that tasks, documents, routines and reservations belong to. */
export interface Subject extends Base {
  kind: 'subject';
  subjectType: SubjectType;
  name: string;
  notes: string;
  /** Registry attributes, e.g. car.plate, trip.start/end/travelers. */
  attributes: Fields;
}

// ── Contacts ────────────────────────────────────────────────────────────────

export interface ContactLink {
  subjectId: string;
  role: string;
}

/** Household-wide; linked to the subjects it serves. */
export interface Contact extends Base {
  kind: 'contact';
  name: string;
  /** The contact's own title, e.g. "Orthopedist". */
  role: string;
  phone: string;
  email: string;
  notes: string;
  /** e.g. health, cars, other. */
  tags: string[];
  links: ContactLink[];
}

// ── Routines ────────────────────────────────────────────────────────────────

/**
 * plain    — completing just marks it done
 * schedule — completing asks for date/time/provider/prep and books an appointment
 * renew    — completing asks for the next date and plans the next cycle
 * pickup   — completing asks quantity received + refills left (medication)
 */
export type StepKind = 'plain' | 'schedule' | 'renew' | 'pickup';

/** A task or routine step that asks for a document; its detail offers "Add document". */
export interface DocumentRequest {
  category: DocCategory;
  type: string;
}

export interface StepPlan {
  title: string;
  /** Days relative to the due date (plan) or to the completion date (follow-ups). */
  offsetDays: number;
  kind: StepKind;
  /** Default prep note offered when booking (schedule steps). */
  prep: string;
  requestsDocument: DocumentRequest | null;
}

/** A reusable template; each Assignment applies it to one subject. */
export interface Routine extends Base {
  kind: 'routine';
  area: RoutineArea;
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
  /** Default repeat for new assignments (months), null = doesn't repeat. */
  repeatMonths: number | null;
  /** Default base for the next due date: the day it was done, or the previous due date. */
  countFrom: 'done' | 'due';
  extension: { medication: boolean } | null;
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

/** One routine applied to one subject, with its own date, schedule and status. */
export interface Assignment extends Base {
  kind: 'assignment';
  routineId: string;
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
  /** This assignee's own steps, overriding the routine's. null = use the routine's. */
  plan: StepPlan[] | null;
  /** Override of the routine's countFrom. null = use the routine's. */
  countFrom: 'done' | 'due' | null;
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

/** Why a task exists: a routine step, or a reservation's booking / check-in. */
export type TaskSource =
  | { kind: 'assignment'; id: string; step: StepKind }
  | { kind: 'reservation'; id: string; step: 'book' | 'checkin' };

export interface Task extends Base {
  kind: 'task';
  /** null = General. */
  subjectId: string | null;
  /** Set = a subtask (one level: a subtask's parent is never a subtask). Same subject as the parent. */
  parentId: string | null;
  title: string;
  /** Rich text (sanitized HTML) or plain text. */
  notes: string;
  /** null = unscheduled ("Needs a date"). A dated subtask is its own Agenda row. */
  date: ISODate | null;
  /** Secondary sort after date; the user's manual order within a day (or among siblings). */
  order: number;
  done: boolean;
  doneAt: Timestamp | null;
  source: TaskSource | null;
  /** Booked appointment (not draggable). */
  appointment: AppointmentInfo | null;
  requestsDocument: DocumentRequest | null;
}

// ── Documents ───────────────────────────────────────────────────────────────

export interface DocumentFile {
  /** One of the category's fileRoles (front / back) or null. */
  role: string | null;
  file: FileRef;
}

export interface CustomField {
  label: string;
  value: string;
}

export interface Expiry {
  validUntil: ISODate;
  /** Replaced by a renewal; shown with an amber "Outdated" chip. */
  outdated: boolean;
}

/** Any file(s) plus metadata. */
export interface Document extends Base {
  kind: 'document';
  subjectId: string;
  /** An attachment of a task or reservation (same subject). */
  attachedTo: { kind: 'task' | 'reservation'; id: string } | null;
  category: DocCategory;
  type: string;
  title: string;
  /** The document's own date (health: visit/result date). */
  date: ISODate | null;
  files: DocumentFile[];
  /** Registry fields of the category and type. */
  fields: Fields;
  /** Ad-hoc fields the user added. */
  customFields: CustomField[];
  /** Linked routine. */
  assignmentId: string | null;
  /** "Keep handy" / "Keep in the glovebox". */
  pinned: boolean;
  /** Only on expiring categories. */
  expiry: Expiry | null;
}

// ── Reservations ────────────────────────────────────────────────────────────

export interface Reservation extends Base {
  kind: 'reservation';
  /** A subject whose type allows reservations (a trip). */
  subjectId: string;
  type: ReservationType;
  title: string;
  start: LocalDateTime;
  end: LocalDateTime | null;
  status: 'booked' | 'planned';
  bookBy: ISODate | null;
  /** Flights: "Remind me to check in online the day before". */
  checkinReminder: boolean;
  /** address, confirmation, link, details (registry reservationFields). */
  fields: Fields;
}

// ── Union + API shapes ──────────────────────────────────────────────────────

/**
 * A subject type the household defined (no UI; POST /api/subject-types or the
 * MCP tool). Same shape as a registry subjectTypes entry; its id is the key.
 */
export interface SubjectTypeRecord extends Base {
  kind: 'subjectType';
  label: string;
  plural: string;
  nameLabel: string;
  namePlaceholder: string;
  icon: string;
  attributes: import('../lib/registry').FieldDef[];
  allows: ('task' | 'document' | 'assignment' | 'reservation')[];
  documentCategories: DocCategory[];
  routineAreas: RoutineArea[];
  rules: { rule: 'dateOrder'; fields: [string, string] }[];
}

export type Entity = Subject | Task | Document | Reservation | Routine | Assignment | Contact | SubjectTypeRecord;

export type EntityKind = Entity['kind'];

export const ENTITY_KINDS: EntityKind[] = ['subject', 'task', 'document', 'reservation', 'routine', 'assignment', 'contact', 'subjectType'];

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

/** POST /api/batch body. Puts are full records (upserts); deletes by ref. */
export interface ChangeSet {
  put: Entity[];
  delete: EntityRef[];
}

/** GET /api/state (the collections). */
export interface CooState {
  subjects: Subject[];
  tasks: Task[];
  documents: Document[];
  reservations: Reservation[];
  routines: Routine[];
  assignments: Assignment[];
  contacts: Contact[];
  /** The household's own subject types. */
  subjectTypes: SubjectTypeRecord[];
}

export const COLLECTION: Record<EntityKind, keyof CooState> = {
  subject: 'subjects',
  task: 'tasks',
  document: 'documents',
  reservation: 'reservations',
  routine: 'routines',
  assignment: 'assignments',
  contact: 'contacts',
  subjectType: 'subjectTypes',
};

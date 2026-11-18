/** Read-only selectors and derived status. Pure functions over CooState. */
import type {
  Assignment,
  Contact,
  CooState,
  DocCategory,
  Document,
  ISODate,
  MedicationSupply,
  Reservation,
  Routine,
  RoutineArea,
  StepPlan,
  Subject,
  SubjectType,
  Task,
} from '../types/coo';
import { SUBJECT_TYPES, attr, fieldList, subjectType as subjectTypeInfo } from './registry';
import {
  addDays,
  addMonths,
  daysFromToday,
  diffDays,
  fmtDate,
  fmtRange,
  plural,
  relativeDay,
  today,
} from './dates';
import { repeatText, templateByKey } from './templates';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'none';
export interface Status {
  tone: Tone;
  text: string;
}

// ── Subjects ────────────────────────────────────────────────────────────────

export function findSubject(s: CooState, id: string | null | undefined): Subject | null {
  return id ? s.subjects.find((x) => x.id === id) ?? null : null;
}

export function subjectName(s: CooState, id: string | null | undefined): string {
  return findSubject(s, id)?.name ?? 'General';
}

/** The line under a subject's name: a car's plate, a trip's dates; nothing for people. */
export function subjectSub(sub: Subject): string {
  if (sub.subjectType === 'car') return attr(sub, 'plate');
  if (sub.subjectType === 'trip') {
    const t = tripInfo(sub);
    return t.start && t.end ? fmtRange(t.start, t.end, true) : '';
  }
  return '';
}

/** Name plus sub-label, e.g. "Toyota Yaris · LMN 7305". */
export function subjectLabel(sub: Subject): string {
  const extra = subjectSub(sub);
  return extra ? `${sub.name} · ${extra}` : sub.name;
}

const BASE_PATH: Partial<Record<SubjectType, string>> = { person: '/people', car: '/cars', trip: '/trips' };

/** A subject's page (one per subject; trips at /trips/:id). */
export function subjectPath(sub: Pick<Subject, 'subjectType' | 'id'>) {
  return `${BASE_PATH[sub.subjectType] ?? '/subjects'}/${sub.id}`;
}

export function subjectsOfType(s: CooState, type: SubjectType): Subject[] {
  return s.subjects
    .filter((x) => x.subjectType === type && !x.archived)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Subjects shown in the sidebar and subject pickers (everything but trips, which have their own page). */
export function allSubjects(s: CooState): Subject[] {
  return (Object.keys(SUBJECT_TYPES) as SubjectType[]).filter((t) => t !== 'trip').flatMap((t) => subjectsOfType(s, t));
}

export function sortedPeople(s: CooState): Subject[] {
  return subjectsOfType(s, 'person');
}

export function sortedCars(s: CooState): Subject[] {
  return subjectsOfType(s, 'car');
}

export function subjectIcon(sub: Pick<Subject, 'subjectType'>): string {
  return subjectTypeInfo(sub.subjectType).icon;
}

// ── Routines and assignments ────────────────────────────────────────────────

export function routineOf(s: CooState, a: Assignment | null | undefined): Routine | undefined {
  return a ? s.routines.find((r) => r.id === a.routineId) : undefined;
}

export function assignmentById(s: CooState, id: string | null): Assignment | undefined {
  return id ? s.assignments.find((a) => a.id === id) : undefined;
}

export function assignmentsOf(s: CooState, r: Routine): Assignment[] {
  return s.assignments
    .filter((a) => a.routineId === r.id)
    .sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}

export function assignmentsFor(s: CooState, id: string, area?: RoutineArea): Assignment[] {
  return s.assignments.filter((a) => {
    if (a.subjectId !== id) return false;
    if (!area) return true;
    return routineOf(s, a)?.area === area;
  });
}

export function runOutDate(sup: MedicationSupply): ISODate {
  if (sup.perDay <= 0) return addDays(sup.asOf, 3650);
  return addDays(sup.asOf, Math.floor(sup.onHand / sup.perDay));
}

/** Units on hand today, assuming steady use since `asOf`. */
export function onHandNow(sup: MedicationSupply): number {
  const used = Math.max(0, diffDays(sup.asOf, today())) * sup.perDay;
  return Math.max(0, sup.onHand - used);
}

export function openAppointment(s: CooState, a: Assignment): Task | undefined {
  return s.tasks
    .filter((t) => stepOf(t, a.id) && t.appointment && !t.done)
    .sort(byDate)[0];
}

function isExpiryLabel(r: Routine) {
  return r.area === 'identity' || r.dateLabel === 'Expires' || r.dateLabel === 'Valid until';
}

export function assignmentStatus(s: CooState, a: Assignment): Status {
  const r = routineOf(s, a);
  if (a.done) return { tone: 'ok', text: 'Done' };
  if (isMedication(r) && a.supply) {
    const n = daysFromToday(runOutDate(a.supply));
    if (n < 0) return { tone: 'bad', text: `Ran out ${plural(-n, 'day')} ago` };
    if (n <= a.supply.orderLeadDays + 3)
      return { tone: 'warn', text: n === 0 ? 'Runs out today' : `Runs out in ${plural(n, 'day')}` };
    return { tone: 'ok', text: 'Supply OK' };
  }
  if (!a.date) return { tone: 'none', text: 'No schedule' };
  const n = daysFromToday(a.date);
  const expiry = r ? r.area === 'identity' : false;
  if (n < 0)
    return {
      tone: 'bad',
      text: expiry ? `Expired ${plural(-n, 'day')} ago` : `Overdue by ${plural(-n, 'day')}`,
    };
  const appt = openAppointment(s, a);
  if (appt) return { tone: 'info', text: `Booked · ${fmtDate(appt.date, true)}` };
  if (n <= 30) {
    if (n === 0) return { tone: 'warn', text: expiry ? 'Expires today' : 'Due today' };
    return { tone: 'warn', text: `${expiry ? 'Expires' : 'Due'} in ${plural(n, 'day')}` };
  }
  return { tone: 'ok', text: 'On track' };
}

export function scheduleLine(s: CooState, a: Assignment): string {
  const r = routineOf(s, a);
  if (!r) return '';
  if (isMedication(r) && a.supply) {
    return `Runs out ${fmtDate(runOutDate(a.supply), true)} · ${plural(a.supply.refillsLeft, 'refill')} left`;
  }
  if (!a.date && !a.repeatMonths) return 'No dates or repeats';
  if (!a.date) return `No date yet · ${repeatText(a.repeatMonths)}`;
  return `${r.dateLabel} ${fmtDate(a.date)} · ${repeatText(a.repeatMonths)}`;
}

/** True when the task is a step of the given assignment (or of any, without an id). */
export function stepOf(t: Task, assignmentId?: string): boolean {
  return t.source?.kind === 'assignment' && (assignmentId === undefined || t.source.id === assignmentId);
}

export function assignmentIdOf(t: Task): string | null {
  return t.source?.kind === 'assignment' ? t.source.id : null;
}

export function reservationIdOf(t: Task): string | null {
  return t.source?.kind === 'reservation' ? t.source.id : null;
}

/** plain / schedule / renew / pickup for routine steps; plain otherwise. */
export function stepKindOf(t: Task) {
  return t.source?.kind === 'assignment' ? t.source.step : 'plain';
}

export function isMedication(r: Routine | undefined | null): boolean {
  return !!r?.extension?.medication;
}

export function stepsOf(s: CooState, a: Assignment): Task[] {
  return s.tasks.filter((t) => stepOf(t, a.id));
}

export function nextStep(s: CooState, a: Assignment): Task | undefined {
  return stepsOf(s, a).filter((t) => !t.done).sort(byDate)[0];
}

export function docsOfAssignment(s: CooState, a: Assignment): Document[] {
  return s.documents.filter((d) => d.assignmentId === a.id && !d.archived);
}

export function routineSummary(r: Routine): string {
  if (isMedication(r)) return 'Tracks supply';
  if (!r.repeatMonths) return 'No schedule';
  return `By default repeats ${repeatText(r.repeatMonths)}`;
}

export function doneVerb(r: Routine | undefined): string {
  return templateByKey(r?.template)?.doneVerb ?? 'Done';
}

/** Default next date offered when a renewal or appointment cycle completes. */
/** This assignee's steps: its own override, else the routine's defaults. */
export function effectivePlan(r: Routine, a: Assignment): StepPlan[] {
  return a.plan ?? r.plan;
}

export function effectiveCountFrom(r: Routine, a: Assignment): 'done' | 'due' {
  return a.countFrom ?? r.countFrom;
}

export function hasOverrides(a: Assignment): boolean {
  return a.plan != null || a.countFrom != null;
}

export function samePlan(x: StepPlan[], y: StepPlan[]): boolean {
  return JSON.stringify(x) === JSON.stringify(y);
}

export function suggestedNextDate(r: Routine, a: Assignment, doneOn: ISODate): ISODate | null {
  if (!a.repeatMonths) return null;
  const base = effectiveCountFrom(r, a) === 'due' && a.date ? a.date : doneOn;
  return addMonths(base, a.repeatMonths);
}

export function renewQuestion(r: Routine): string {
  return isExpiryLabel(r) ? 'Done. What’s the new expiry date?' : 'When is the next one due?';
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export function byDate(a: Task, b: Task): number {
  if (a.date !== b.date) {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? -1 : 1;
  }
  if (a.order !== b.order) return a.order - b.order;
  return a.createdAt.localeCompare(b.createdAt);
}

export function isAdHoc(t: Task) {
  return !t.source;
}

export function isGeneral(t: Task) {
  return !t.subjectId;
}

/** A subject's top-level tasks (subtasks live inside their parent). */
export function tasksForSubject(s: CooState, id: string): Task[] {
  return s.tasks.filter((t) => t.subjectId === id && !t.parentId);
}

export function subtasksOf(s: CooState | Task[], parentId: string): Task[] {
  const tasks = Array.isArray(s) ? s : s.tasks;
  return tasks.filter((t) => t.parentId === parentId).sort((a, b) => a.order - b.order);
}

export function taskWho(s: CooState, t: Task): string {
  return findSubject(s, t.subjectId)?.name ?? 'General';
}

export function taskWhat(s: CooState, t: Task): string {
  if (t.source?.kind === 'reservation') return 'Trip';
  const r = routineOf(s, assignmentById(s, assignmentIdOf(t)));
  return r ? r.title : 'Ad-hoc';
}

export function contactName(s: CooState, id: string | null): string {
  return id ? s.contacts.find((c) => c.id === id)?.name ?? '' : '';
}

export function appointmentNote(s: CooState, t: Task): string {
  if (!t.appointment) return '';
  return [t.appointment.time, contactName(s, t.appointment.providerId), t.appointment.providerNote]
    .filter(Boolean)
    .join(' · ');
}

export function subtaskProgress(s: CooState, t: Task): string {
  const list = subtasksOf(s, t.id);
  if (list.length === 0) return '';
  const base = `${list.filter((x) => x.done).length} of ${list.length} sub-tasks`;
  const open = list.filter((x) => !x.done && x.date).sort((a, b) => (a.date! < b.date! ? -1 : 1));
  const late = open.filter((x) => x.date! < today()).length;
  if (late) return `${base}, ${late} overdue`;
  if (open.length) return `${base}, next ${relativeDay(open[0].date!)}`;
  return base;
}

export function taskMeta(s: CooState, t: Task): string {
  const parts = [taskWho(s, t), taskWhat(s, t)];
  const progress = subtaskProgress(s, t);
  if (progress) parts.push(progress);
  if (t.appointment) {
    parts.push('Appointment');
    const note = appointmentNote(s, t);
    if (note) parts.push(note);
  }
  if (!t.date) parts.push('Needs a date');
  return parts.join(' · ');
}

export type Bucket = 'overdue' | 'today' | 'week' | 'later';
export const BUCKETS: Bucket[] = ['overdue', 'today', 'week', 'later'];
export const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'Next 7 days',
  later: 'Later',
};

export function bucketOf(date: ISODate | null): Bucket {
  if (!date) return 'later';
  const n = daysFromToday(date);
  if (n < 0) return 'overdue';
  if (n === 0) return 'today';
  if (n <= 7) return 'week';
  return 'later';
}

export function bucketDefaultDate(b: Bucket): ISODate {
  const t = today();
  return { overdue: addDays(t, -1), today: t, week: addDays(t, 1), later: addDays(t, 8) }[b];
}

export interface Indicators {
  overdue: number;
  dueToday: number;
  reminders: number;
  appointments: number;
  nextDate: ISODate | null;
}

export function indicators(tasks: Task[]): Indicators {
  const out: Indicators = { overdue: 0, dueToday: 0, reminders: 0, appointments: 0, nextDate: null };
  for (const t of agendaTasks(tasks)) {
    if (t.done || !t.date) continue;
    const n = daysFromToday(t.date);
    if (n < 0) out.overdue++;
    if (n === 0) out.dueToday++;
    if (!t.appointment && n >= 0 && n <= 14) out.reminders++;
    if (t.appointment && n >= 0 && n <= 30) out.appointments++;
    if (n >= 0 && (!out.nextDate || t.date < out.nextDate)) out.nextDate = t.date;
  }
  return out;
}

export function urgencyCompare(a: Indicators, b: Indicators): number {
  if (a.overdue !== b.overdue) return b.overdue - a.overdue;
  if (a.dueToday !== b.dueToday) return b.dueToday - a.dueToday;
  if (a.nextDate !== b.nextDate) {
    if (!a.nextDate) return 1;
    if (!b.nextDate) return -1;
    return a.nextDate < b.nextDate ? -1 : 1;
  }
  return 0;
}

// ── Agenda items: tasks plus their dated subtasks ───────────────────────────

/** A row on the Agenda; `parent` is set for a subtask. */
export interface AgendaItem extends Task {
  parent?: Task;
}

export function isSubItem(t: Task): t is AgendaItem & { parent: Task } {
  return !!t.parentId && !!(t as AgendaItem).parent;
}

/**
 * What the Agenda lists: every top-level task, plus each dated subtask —
 * open ones while the parent is open, completed ones (with a completion
 * stamp) on the Done tab. Undated subtasks live only inside their parent.
 */
export function agendaTasks(tasks: Task[]): AgendaItem[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: AgendaItem[] = [];
  for (const t of tasks) {
    if (!t.parentId) {
      out.push(t);
      continue;
    }
    const parent = byId.get(t.parentId);
    if (!parent || !t.date) continue;
    if (!t.done && parent.done) continue;
    if (t.done && !t.doneAt) continue;
    out.push({ ...t, parent });
  }
  return out;
}

export function agendaBadge(s: CooState): number {
  const t = today();
  return agendaTasks(s.tasks).filter((x) => !x.done && x.date && x.date <= t).length;
}

// ── Documents ───────────────────────────────────────────────────────────────

export function validUntil(d: Document): ISODate | null {
  return d.expiry?.validUntil ?? null;
}

export function isOutdated(d: Document): boolean {
  return !!d.expiry?.outdated;
}

export function docValidity(d: Document): Status | null {
  if (isOutdated(d)) return { tone: 'warn', text: 'Outdated' };
  const until = validUntil(d);
  if (!until) return null;
  const n = daysFromToday(until);
  if (n < 0) return { tone: 'bad', text: 'Expired' };
  const window = d.category === 'car' ? 30 : 90;
  if (n <= window) return { tone: 'warn', text: n === 0 ? 'Expires today' : `Expires in ${plural(n, 'day')}` };
  return { tone: 'ok', text: `Valid until ${fmtDate(until)}` };
}

export function maskId(n: string): string {
  const clean = n.replace(/\s+/g, '');
  if (!clean) return '';
  return `•••• ${clean.slice(-4)}`;
}

/** A subject's documents of one category (not attachments of tasks/reservations unless asked). */
export function docsFor(s: CooState, id: string, category: DocCategory): Document[] {
  return s.documents.filter((d) => d.subjectId === id && d.category === category);
}

export function attachmentsOf(s: CooState, kind: 'task' | 'reservation', id: string): Document[] {
  return s.documents.filter((d) => d.attachedTo?.kind === kind && d.attachedTo.id === id);
}

export function fileOf(d: Document, role: string | null = null) {
  return d.files.find((f) => f.role === role)?.file ?? null;
}

// ── Trips ───────────────────────────────────────────────────────────────────

export interface TripInfo {
  destination: string;
  start: ISODate;
  end: ISODate;
  travelers: string[];
}

export function tripInfo(t: Subject): TripInfo {
  return {
    destination: attr(t, 'destination'),
    start: attr(t, 'start'),
    end: attr(t, 'end'),
    travelers: fieldList(t.attributes, 'travelers'),
  };
}

export function trips(s: CooState): Subject[] {
  return s.subjects.filter((x) => x.subjectType === 'trip');
}

export function tripReservations(s: CooState, t: Subject): Reservation[] {
  return s.reservations.filter((r) => r.subjectId === t.id).sort((a, b) => a.start.localeCompare(b.start));
}

export function isUpcomingTrip(t: Subject) {
  return tripInfo(t).end >= today();
}

export function tripWhen(t: Subject): { text: string; tone: Tone; days: number | null } {
  const { start, end } = tripInfo(t);
  const n = daysFromToday(start);
  if (end < today()) return { text: 'Ended', tone: 'none', days: null };
  if (n <= 0) return { text: 'Happening now', tone: 'ok', days: 0 };
  return { text: n === 1 ? 'Tomorrow' : `In ${n} days`, tone: 'info', days: n };
}

export function tripDates(t: Subject, compact = false): string {
  const { start, end } = tripInfo(t);
  return fmtRange(start, end, compact);
}

export function nights(t: Subject): number {
  const { start, end } = tripInfo(t);
  return Math.max(0, diffDays(start, end));
}

export function passportOf(s: CooState, personId: string): Document | undefined {
  return s.documents
    .filter((d) => d.category === 'identity' && d.subjectId === personId && d.type === 'Passport' && !d.archived && !isOutdated(d))
    .sort((a, b) => (validUntil(b) ?? '').localeCompare(validUntil(a) ?? ''))[0];
}

export function passportStatus(s: CooState, personId: string, trip: Subject): Status {
  const p = passportOf(s, personId);
  const end = tripInfo(trip).end;
  if (!p) return { tone: 'none', text: 'No passport on file' };
  const until = validUntil(p);
  if (!until) return { tone: 'none', text: 'No expiry date' };
  if (until < end) return { tone: 'bad', text: `Expires ${fmtDate(until, true)}, before the trip ends` };
  if (until < addMonths(end, 6)) return { tone: 'warn', text: `Valid until ${fmtDate(until)}, under 6 months after the trip` };
  return { tone: 'ok', text: `Valid until ${fmtDate(until)}` };
}

// ── Contacts ────────────────────────────────────────────────────────────────

/** Contacts for an area: health → health + other, car → cars + other. */
export function contactsFor(s: CooState, area: 'health' | 'car' | 'any'): Contact[] {
  const tags = area === 'health' ? ['health', 'other'] : area === 'car' ? ['cars', 'other'] : null;
  return s.contacts
    .filter((c) => !tags || c.tags.some((t) => tags.includes(t)) || c.tags.length === 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Contacts with one of the tags (for a contact field's `tags`). */
export function contactsTagged(s: CooState, tags: string[] | undefined): Contact[] {
  return s.contacts.filter((c) => !tags?.length || c.tags.some((t) => tags.includes(t))).sort((a, b) => a.name.localeCompare(b.name));
}

export function contactGroup(c: Contact): 'health' | 'cars' | 'other' {
  return (['health', 'cars', 'other'] as const).find((g) => c.tags.includes(g)) ?? 'other';
}

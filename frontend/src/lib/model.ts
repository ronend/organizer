/** Read-only selectors and derived status. Pure functions over CooState. */
import type {
  Assignment,
  Car,
  Contact,
  CooState,
  Document,
  ISODate,
  MedicationSupply,
  Person,
  Reservation,
  Routine,
  StepPlan,
  SubjectType,
  Task,
  Trip,
} from '../types/coo';
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

export type Subject = { type: 'person'; entity: Person } | { type: 'car'; entity: Car };

export function findSubject(s: CooState, type: SubjectType | null, id: string | null): Subject | null {
  if (!type || !id) return null;
  if (type === 'person') {
    const p = s.people.find((x) => x.id === id);
    return p ? { type, entity: p } : null;
  }
  const c = s.cars.find((x) => x.id === id);
  return c ? { type, entity: c } : null;
}

export function subjectName(s: CooState, type: SubjectType | null, id: string | null): string {
  const sub = findSubject(s, type, id);
  if (!sub) return 'General';
  return sub.type === 'person' ? sub.entity.name : sub.entity.makeModel;
}

/** People have no sub-label (age is not shown). */
export function personSub(_p: Person): string {
  return '';
}

export function subjectSub(sub: Subject): string {
  return sub.type === 'person' ? personSub(sub.entity) : sub.entity.plate;
}

export function subjectKey(type: SubjectType, id: string) {
  return `${type}:${id}`;
}

export function subjectPath(type: SubjectType, id: string, page?: string) {
  const base = type === 'person' ? `/people/${id}` : `/cars/${id}`;
  return page && page !== 'overview' ? `${base}/${page}` : base;
}

export function allSubjects(s: CooState): Subject[] {
  return [
    ...sortedPeople(s).map((p) => ({ type: 'person' as const, entity: p })),
    ...sortedCars(s).map((c) => ({ type: 'car' as const, entity: c })),
  ];
}

export function sortedPeople(s: CooState): Person[] {
  return [...s.people].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function sortedCars(s: CooState): Car[] {
  return [...s.cars].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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

export function assignmentsFor(s: CooState, type: SubjectType, id: string, area?: string): Assignment[] {
  return s.assignments.filter((a) => {
    if (a.subjectType !== type || a.subjectId !== id) return false;
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
    .filter((t) => t.assignmentId === a.id && t.appointment && !t.done)
    .sort(byDate)[0];
}

function isExpiryLabel(r: Routine) {
  return r.area === 'identity' || r.dateLabel === 'Expires' || r.dateLabel === 'Valid until';
}

export function assignmentStatus(s: CooState, a: Assignment): Status {
  const r = routineOf(s, a);
  if (a.done) return { tone: 'ok', text: 'Done' };
  if (r?.medication && a.supply) {
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
  if (r.medication && a.supply) {
    return `Runs out ${fmtDate(runOutDate(a.supply), true)} · ${plural(a.supply.refillsLeft, 'refill')} left`;
  }
  if (!a.date && !a.repeatMonths) return 'No dates or repeats';
  if (!a.date) return `No date yet · ${repeatText(a.repeatMonths)}`;
  return `${r.dateLabel} ${fmtDate(a.date)} · ${repeatText(a.repeatMonths)}`;
}

export function stepsOf(s: CooState, a: Assignment): Task[] {
  return s.tasks.filter((t) => t.assignmentId === a.id);
}

export function nextStep(s: CooState, a: Assignment): Task | undefined {
  return stepsOf(s, a).filter((t) => !t.done).sort(byDate)[0];
}

export function docsOfAssignment(s: CooState, a: Assignment): Document[] {
  return s.documents.filter((d) => d.assignmentId === a.id && !d.archived);
}

export function routineSummary(r: Routine): string {
  if (r.medication) return 'Tracks supply';
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
  return !t.assignmentId && !t.tripId;
}

export function isGeneral(t: Task) {
  return !t.subjectId && !t.tripId;
}

export function tasksForSubject(s: CooState, type: SubjectType, id: string): Task[] {
  return s.tasks.filter((t) => t.subjectType === type && t.subjectId === id);
}

export function taskWho(s: CooState, t: Task): string {
  if (t.tripId) return s.trips.find((x) => x.id === t.tripId)?.name ?? 'Trip';
  return subjectName(s, t.subjectType, t.subjectId);
}

export function taskWhat(s: CooState, t: Task): string {
  if (t.tripId) return 'Trip';
  const r = routineOf(s, assignmentById(s, t.assignmentId));
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

export function subtaskProgress(t: Task): string {
  const list = t.subtasks ?? [];
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
  const progress = subtaskProgress(t);
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
  for (const t of tasks) {
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

export function agendaBadge(s: CooState): number {
  const t = today();
  return s.tasks.filter((x) => !x.done && x.date && x.date <= t).length;
}

// ── Documents ───────────────────────────────────────────────────────────────

export function docValidity(d: Document): Status | null {
  if (d.outdated) return { tone: 'warn', text: 'Outdated' };
  if (!d.validUntil) return null;
  const n = daysFromToday(d.validUntil);
  if (n < 0) return { tone: 'bad', text: 'Expired' };
  const window = d.docKind === 'car' ? 30 : 90;
  if (n <= window) return { tone: 'warn', text: n === 0 ? 'Expires today' : `Expires in ${plural(n, 'day')}` };
  return { tone: 'ok', text: `Valid until ${fmtDate(d.validUntil)}` };
}

export function maskId(n: string): string {
  const clean = n.replace(/\s+/g, '');
  if (!clean) return '';
  return `•••• ${clean.slice(-4)}`;
}

export function docsFor(s: CooState, type: SubjectType, id: string, kind: Document['docKind']): Document[] {
  return s.documents.filter((d) => d.subjectType === type && d.subjectId === id && d.docKind === kind);
}

// ── Trips ───────────────────────────────────────────────────────────────────

export function tripReservations(s: CooState, t: Trip): Reservation[] {
  return s.reservations.filter((r) => r.tripId === t.id).sort((a, b) => a.start.localeCompare(b.start));
}

export function isUpcomingTrip(t: Trip) {
  return t.end >= today();
}

export function tripWhen(t: Trip): { text: string; tone: Tone; days: number | null } {
  const n = daysFromToday(t.start);
  if (t.end < today()) return { text: 'Ended', tone: 'none', days: null };
  if (n <= 0) return { text: 'Happening now', tone: 'ok', days: 0 };
  return { text: n === 1 ? 'Tomorrow' : `In ${n} days`, tone: 'info', days: n };
}

export function tripDates(t: Trip, compact = false): string {
  return fmtRange(t.start, t.end, compact);
}

export function nights(t: Trip): number {
  return Math.max(0, diffDays(t.start, t.end));
}

export function passportOf(s: CooState, personId: string): Document | undefined {
  return s.documents
    .filter(
      (d) =>
        d.docKind === 'identity' &&
        d.subjectId === personId &&
        d.type === 'Passport' &&
        !d.archived &&
        !d.outdated,
    )
    .sort((a, b) => (b.validUntil ?? '').localeCompare(a.validUntil ?? ''))[0];
}

export function passportStatus(s: CooState, personId: string, trip: Trip): Status {
  const p = passportOf(s, personId);
  if (!p) return { tone: 'none', text: 'No passport on file' };
  if (!p.validUntil) return { tone: 'none', text: 'No expiry date' };
  if (p.validUntil < trip.end) return { tone: 'bad', text: `Expires ${fmtDate(p.validUntil, true)}, before the trip ends` };
  if (p.validUntil < addMonths(trip.end, 6))
    return { tone: 'warn', text: `Valid until ${fmtDate(p.validUntil)}, under 6 months after the trip` };
  return { tone: 'ok', text: `Valid until ${fmtDate(p.validUntil)}` };
}

export function contactsFor(s: CooState, area: 'health' | 'car' | 'any'): Contact[] {
  const groups = area === 'health' ? ['health', 'other'] : area === 'car' ? ['cars', 'other'] : ['health', 'cars', 'other'];
  return s.contacts.filter((c) => groups.includes(c.group)).sort((a, b) => a.name.localeCompare(b.name));
}

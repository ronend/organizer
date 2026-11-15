/**
 * Mutations. Each op reads the current state and writes into a Tx; the store
 * applies the resulting ChangeSet optimistically and derives Undo from it.
 */
import type {
  AppointmentInfo,
  Area,
  Assignment,
  Car,
  ChangeSet,
  Contact,
  CooState,
  Document,
  Entity,
  EntityRef,
  ISODate,
  MedicationSupply,
  Person,
  Reservation,
  Routine,
  StepPlan,
  Subtask,
  SubjectType,
  Task,
  Trip,
} from '../types/coo';
import { addDays, datePart, diffDays, nowStamp, today } from './dates';
import {
  assignmentById,
  assignmentsOf,
  byDate,
  contactName,
  doneVerb,
  effectivePlan,
  routineOf,
  samePlan,
  runOutDate,
  onHandNow,
} from './model';
import { step } from './templates';

// ── Tx ──────────────────────────────────────────────────────────────────────

export class Tx {
  private puts = new Map<string, Entity>();
  private dels = new Map<string, EntityRef>();

  constructor(public s: CooState) {}

  put<T extends Entity>(e: T): T {
    const k = `${e.kind}#${e.id}`;
    this.dels.delete(k);
    const out = { ...e, updatedAt: nowStamp() };
    this.puts.set(k, out);
    return out;
  }

  del(e: Entity | EntityRef) {
    const k = `${e.kind}#${e.id}`;
    const wasNew = this.puts.has(k) && !findIn(this.s, e.kind, e.id);
    this.puts.delete(k);
    if (!wasNew) this.dels.set(k, { kind: e.kind, id: e.id });
  }

  /** Latest version of an entity, including writes made earlier in this Tx. */
  get<T extends Entity>(e: T): T {
    return (this.puts.get(`${e.kind}#${e.id}`) as T) ?? e;
  }

  isDeleted(e: Entity) {
    return this.dels.has(`${e.kind}#${e.id}`);
  }

  /** Tasks from state plus pending puts, minus pending deletes. */
  tasks(): Task[] {
    const map = new Map<string, Task>();
    for (const t of this.s.tasks) map.set(t.id, t);
    for (const e of this.puts.values()) if (e.kind === 'task') map.set(e.id, e);
    for (const d of this.dels.values()) if (d.kind === 'task') map.delete(d.id);
    return [...map.values()];
  }

  changes(): ChangeSet {
    return { put: [...this.puts.values()], delete: [...this.dels.values()] };
  }
}

const COLL: Record<Entity['kind'], keyof CooState> = {
  person: 'people', car: 'cars', contact: 'contacts', routine: 'routines',
  assignment: 'assignments', task: 'tasks', document: 'documents', trip: 'trips',
  reservation: 'reservations',
};

export function findIn(s: CooState, kind: Entity['kind'], id: string): Entity | undefined {
  return (s[COLL[kind]] as Entity[]).find((e) => e.id === id);
}

/** Applies a change set to state (pure). */
export function applyChanges(s: CooState, cs: ChangeSet): CooState {
  const next = { ...s } as CooState;
  const touched = new Set<keyof CooState>();
  const work = {} as Record<keyof CooState, Map<string, Entity>>;
  const coll = (k: keyof CooState) => {
    if (!work[k]) {
      work[k] = new Map((s[k] as Entity[]).map((e) => [e.id, e]));
      touched.add(k);
    }
    return work[k];
  };
  for (const e of cs.put) coll(COLL[e.kind]).set(e.id, e);
  for (const d of cs.delete) coll(COLL[d.kind]).delete(d.id);
  for (const k of touched) (next[k] as Entity[]) = [...work[k].values()];
  return next;
}

/** The change set that reverts `cs` against the state it was applied to. */
export function inverse(s: CooState, cs: ChangeSet): ChangeSet {
  const out: ChangeSet = { put: [], delete: [] };
  for (const e of cs.put) {
    const old = findIn(s, e.kind, e.id);
    if (old) out.put.push(old);
    else out.delete.push({ kind: e.kind, id: e.id });
  }
  for (const d of cs.delete) {
    const old = findIn(s, d.kind, d.id);
    if (old) out.put.push(old);
  }
  return out;
}

// ── Factories ───────────────────────────────────────────────────────────────

export function newId(prefix: string): string {
  const rand = crypto.getRandomValues(new Uint8Array(9));
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  return `${prefix}_${Array.from(rand, (b) => chars[b % 36]).join('')}`;
}

function base(prefix: string) {
  const now = nowStamp();
  return { id: newId(prefix), createdAt: now, updatedAt: now };
}

let orderSeq = 0;
/** Monotonic default order so new tasks land after existing ones on the same day. */
export function nextOrder(): number {
  orderSeq = Math.max(orderSeq + 1, Date.now());
  return orderSeq;
}

export function makeTask(p: Partial<Task> & { title: string }): Task {
  return {
    kind: 'task',
    ...base('t'),
    notes: '',
    date: today(),
    order: nextOrder(),
    done: false,
    doneAt: null,
    subjectType: null,
    subjectId: null,
    assignmentId: null,
    stepKind: 'plain',
    appointment: null,
    tripId: null,
    reservationId: null,
    tripTask: null,
    docTask: null,
    subtasks: [],
    ...p,
  };
}

export function makePerson(name: string, birthYear: number | null): Person {
  return { kind: 'person', ...base('p'), name, birthYear };
}

export function makeCar(makeModel: string, plate: string, odometer: number | null): Car {
  return { kind: 'car', ...base('c'), makeModel, plate: plate.toUpperCase(), odometer };
}

export function makeContact(p: Omit<Contact, 'kind' | 'id' | 'createdAt' | 'updatedAt'>): Contact {
  return { kind: 'contact', ...base('k'), ...p };
}

export function makeRoutine(p: Omit<Routine, 'kind' | 'id' | 'createdAt' | 'updatedAt'>): Routine {
  return { kind: 'routine', ...base('r'), ...p };
}

export function makeAssignment(
  p: Partial<Assignment> & { routineId: string; subjectType: SubjectType; subjectId: string },
): Assignment {
  return {
    kind: 'assignment',
    ...base('a'),
    date: null,
    repeatMonths: null,
    done: false,
    contactId: null,
    supply: null,
    history: [],
    plan: null,
    countFrom: null,
    ...p,
  };
}

export function makeDocument(p: Partial<Document> & Pick<Document, 'docKind' | 'subjectType' | 'subjectId' | 'name' | 'type'>): Document {
  return {
    kind: 'document',
    ...base('d'),
    date: null,
    validUntil: null,
    idNumber: '',
    issuer: '',
    issueDate: null,
    details: [],
    front: null,
    back: null,
    providerId: null,
    about: '',
    episode: '',
    file: null,
    assignmentId: null,
    pinned: false,
    archived: false,
    outdated: false,
    ...p,
  };
}

export function makeTrip(p: Omit<Trip, 'kind' | 'id' | 'createdAt' | 'updatedAt'>): Trip {
  return { kind: 'trip', ...base('trip'), ...p };
}

export function makeReservation(p: Omit<Reservation, 'kind' | 'id' | 'createdAt' | 'updatedAt'>): Reservation {
  return { kind: 'reservation', ...base('res'), ...p };
}

// ── Step planning ───────────────────────────────────────────────────────────

const clampToday = (d: ISODate) => (d < today() ? today() : d);

function stepTask(a: Assignment, p: StepPlan, date: ISODate): Task {
  return makeTask({
    title: p.title,
    date,
    subjectType: a.subjectType,
    subjectId: a.subjectId,
    assignmentId: a.id,
    stepKind: p.kind,
    docTask: p.docTask,
    notes: p.prep ? `Prep: ${p.prep}` : '',
  });
}

export function medicationSteps(r: Routine, a: Assignment): Task[] {
  if (!a.supply) return [];
  const out = runOutDate(a.supply);
  const orderOn = clampToday(addDays(out, -a.supply.orderLeadDays));
  const title =
    a.supply.refillsLeft > 0 ? `Order a refill: ${r.title}` : `Get a new prescription: ${r.title}`;
  return [
    stepTask(a, step(title, 0), orderOn),
    stepTask(a, step(`Pick up refill: ${r.title}`, 0, 'pickup'), clampToday(addDays(orderOn, 2))),
  ];
}

/** Tasks for one cycle of a routine ending on `due`. Past dates are clamped to today. */
export function planCycle(r: Routine, a: Assignment, due: ISODate): Task[] {
  if (r.medication) return medicationSteps(r, a);
  return [...effectivePlan(r, a)]
    .sort((x, y) => x.offsetDays - y.offsetDays)
    .map((p) => stepTask(a, p, clampToday(addDays(due, p.offsetDays))));
}

function followUpTasks(r: Routine, a: Assignment, doneOn: ISODate): Task[] {
  return r.followUps.map((p) => stepTask(a, p, clampToday(addDays(doneOn, p.offsetDays))));
}

// ── Task ops ────────────────────────────────────────────────────────────────

export function addTask(
  s: CooState,
  p: {
    title: string;
    date: ISODate | null;
    subjectType: SubjectType | null;
    subjectId: string | null;
    assignmentId?: string | null;
    notes?: string;
    subtasks?: Subtask[];
  },
): ChangeSet {
  const tx = new Tx(s);
  tx.put(
    makeTask({
      title: p.title,
      date: p.date,
      subjectType: p.subjectType,
      subjectId: p.subjectId,
      assignmentId: p.assignmentId ?? null,
      notes: p.notes ?? '',
      subtasks: p.subtasks ?? [],
    }),
  );
  return tx.changes();
}

/** Updates one sub-task of a task. */
export function updateSubtask(s: CooState, parent: Task, subId: string, patch: Partial<Subtask>): ChangeSet {
  const tx = new Tx(s);
  const cur = s.tasks.find((t) => t.id === parent.id) ?? parent;
  tx.put({ ...cur, subtasks: (cur.subtasks ?? []).map((x) => (x.id === subId ? { ...x, ...patch } : x)) });
  return tx.changes();
}

export function setSubtaskDone(s: CooState, parent: Task, subId: string, done: boolean): ChangeSet {
  return updateSubtask(s, parent, subId, { done, doneAt: done ? nowStamp() : null });
}

export function setTaskDone(s: CooState, t: Task, done: boolean): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...t, done, doneAt: done ? nowStamp() : null });
  return tx.changes();
}

export function updateTask(s: CooState, t: Task, patch: Partial<Task>): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...t, ...patch });
  return tx.changes();
}

export function deleteTask(s: CooState, t: Task): ChangeSet {
  const tx = new Tx(s);
  tx.del(t);
  return tx.changes();
}

/** Completes a schedule step and books the appointment (+ a prep reminder). */
export function bookAppointment(
  s: CooState,
  t: Task,
  p: { date: ISODate; info: AppointmentInfo },
): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...t, done: true, doneAt: nowStamp() });
  const a = assignmentById(s, t.assignmentId);
  const r = routineOf(s, a);
  const title = r ? r.title : t.title.replace(/^(book|schedule)\s+/i, '');
  tx.put(
    makeTask({
      title: title[0].toUpperCase() + title.slice(1),
      date: p.date,
      subjectType: t.subjectType,
      subjectId: t.subjectId,
      assignmentId: t.assignmentId,
      stepKind: a ? 'renew' : 'plain',
      appointment: p.info,
    }),
  );
  if (p.info.prep.trim() && t.subjectType === 'person') {
    tx.put(
      makeTask({
        title: `Prepare: ${p.info.prep.trim()}`,
        date: clampToday(addDays(p.date, -1)),
        subjectType: t.subjectType,
        subjectId: t.subjectId,
        assignmentId: t.assignmentId,
      }),
    );
  }
  if (a && p.info.providerId && !a.contactId) tx.put({ ...a, contactId: p.info.providerId });
  return tx.changes();
}

/**
 * Completes a renewal (or an appointment that closes a cycle). With a next
 * date it plans the next cycle; a routine that doesn't repeat becomes Done.
 */
export function completeCycle(s: CooState, t: Task, nextDate: ISODate | null): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...t, done: true, doneAt: nowStamp() });
  const a = assignmentById(s, t.assignmentId);
  const r = routineOf(s, a);
  if (!a || !r) return tx.changes();
  const doneOn = t.appointment && t.date && t.date < today() ? t.date : today();
  const provider = contactName(s, t.appointment?.providerId ?? null) || t.appointment?.providerNote || '';
  const verb = doneVerb(r);
  const entry = { date: doneOn, text: provider ? `${verb} at ${provider}` : verb };
  const next: Assignment = { ...a, history: [entry, ...a.history] };
  // Planned steps still open from the cycle that just ended are stale now.
  // Steps the user added by hand are kept.
  const planned = new Set(effectivePlan(r, a).map((p) => p.title));
  for (const other of s.tasks) {
    if (other.assignmentId === a.id && other.id !== t.id && !other.done && !other.appointment && planned.has(other.title)) {
      tx.del(other);
    }
  }
  if (nextDate) {
    next.date = nextDate;
    for (const task of planCycle(r, next, nextDate)) tx.put(task);
  } else {
    next.done = true;
  }
  tx.put(next);
  for (const task of followUpTasks(r, next, doneOn)) tx.put(task);
  // The replaced document is now outdated (identity renewals).
  if (r.area === 'identity') {
    for (const d of s.documents) {
      if (d.assignmentId === a.id && !d.archived && !d.outdated) tx.put({ ...d, outdated: true });
    }
  }
  return tx.changes();
}

/** Logs a refill: recalculates the run-out date and plans the next order. */
export function logRefill(
  s: CooState,
  a: Assignment,
  p: { received: number; refillsLeft: number },
  fromTask?: Task,
): ChangeSet {
  const tx = new Tx(s);
  const r = routineOf(s, a);
  if (!r || !a.supply) return tx.changes();
  for (const t of s.tasks) {
    if (t.assignmentId === a.id && !t.done && (t.stepKind === 'pickup' || t.id === fromTask?.id || /^(Order a refill|Get a new prescription)/.test(t.title))) {
      tx.put({ ...t, done: true, doneAt: nowStamp() });
    }
  }
  const supply: MedicationSupply = {
    ...a.supply,
    onHand: onHandNow(a.supply) + p.received,
    asOf: today(),
    refillsLeft: p.refillsLeft,
  };
  const next: Assignment = {
    ...a,
    supply,
    date: runOutDate(supply),
    history: [{ date: today(), text: `Refilled · ${p.received} ${supply.unit}` }, ...a.history],
  };
  tx.put(next);
  for (const t of medicationSteps(r, next)) tx.put(t);
  return tx.changes();
}

/** Drag/keyboard move: new date and order. */
export function moveTask(s: CooState, t: Task, date: ISODate | null, order: number): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...t, date, order });
  return tx.changes();
}

// ── Assignment ops ──────────────────────────────────────────────────────────

/**
 * Sets an assignment's date. From no date: generates the cycle's steps. From a
 * date: shifts all open non-appointment steps by the same number of days.
 */
export function setAssignmentDate(s: CooState, a: Assignment, date: ISODate | null, tx = new Tx(s)): ChangeSet {
  const r = routineOf(s, a);
  const cur = tx.get(a);
  let next: Assignment = { ...cur, date, done: date ? false : cur.done };
  if (r?.medication && next.supply && date) {
    next = { ...next, supply: { ...next.supply!, onHand: Math.max(0, diffDays(today(), date)) * next.supply!.perDay, asOf: today() } };
  }
  tx.put(next);
  if (!r) return tx.changes();
  const open = tx.tasks().filter((t) => t.assignmentId === a.id && !t.done && !t.appointment);
  if (!cur.date && date) {
    if (open.length === 0) for (const t of planCycle(r, next, date)) tx.put(t);
  } else if (cur.date && date) {
    const delta = diffDays(cur.date, date);
    if (delta !== 0) {
      for (const t of open) if (t.date) tx.put({ ...t, date: addDays(t.date, delta) });
    }
  }
  return tx.changes();
}

/**
 * Replaces the open, not-yet-booked steps that came from `oldPlan` with steps
 * from the assignment's current effective plan for its current date. Steps
 * the user added by hand, appointments and steps already done this cycle stay.
 */
function replanOpenSteps(tx: Tx, oldPlan: StepPlan[], r: Routine, a: Assignment) {
  if (!a.date) return;
  const oldTitles = new Set(oldPlan.map((p) => p.title));
  const mine = tx.tasks().filter((t) => t.assignmentId === a.id);
  for (const t of mine) {
    if (!t.done && !t.appointment && oldTitles.has(t.title)) tx.del(t);
  }
  const plan = effectivePlan(r, a);
  const earliest = Math.min(0, ...plan.map((p) => p.offsetDays), ...oldPlan.map((p) => p.offsetDays));
  const cycleStart = addDays(a.date, earliest - 30);
  const doneThisCycle = new Set(mine.filter((t) => t.done && (t.date ?? '') >= cycleStart).map((t) => t.title));
  const bookedThisCycle = mine.some((t) => t.appointment && !t.done);
  for (const t of planCycle(r, a, a.date)) {
    if (doneThisCycle.has(t.title)) continue;
    if (bookedThisCycle && t.stepKind === 'schedule') continue;
    tx.put(t);
  }
}

/**
 * Saves one assignee's schedule: date, repeat, counting rule and steps.
 * A plan equal to the routine's default is stored as null (inherit).
 */
export function updateSchedule(
  s: CooState,
  a: Assignment,
  p: { date: ISODate | null; repeatMonths: number | null; countFrom: 'done' | 'due' | null; plan: StepPlan[] | null },
): ChangeSet {
  const tx = new Tx(s);
  const r = routineOf(s, a);
  if (!r) return tx.changes();
  const oldPlan = effectivePlan(r, a);
  const plan = p.plan && samePlan(p.plan, r.plan) ? null : p.plan;
  const countFrom = p.countFrom === r.countFrom ? null : p.countFrom;
  const withRules = tx.put({ ...a, repeatMonths: p.repeatMonths, countFrom, plan });
  if (p.date !== a.date) setAssignmentDate(s, withRules, p.date, tx);
  const cur = tx.get(withRules);
  if (!r.medication && cur.date && !samePlan(oldPlan, effectivePlan(r, cur))) {
    replanOpenSteps(tx, oldPlan, r, cur);
  }
  return tx.changes();
}

export function updateAssignment(s: CooState, a: Assignment, patch: Partial<Assignment>): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...a, ...patch });
  return tx.changes();
}

export interface RoutineDraft {
  area: Area;
  template: string | null;
  icon: string;
  title: string;
  description: string;
  dateLabel: string;
  plan: StepPlan[];
  followUps: StepPlan[];
  repeatMonths: number | null;
  countFrom: 'done' | 'due';
  medication: boolean;
  /** Each assignee with its own due date and repeat. */
  subjects: { type: SubjectType; id: string; date: ISODate | null; repeatMonths: number | null }[];
  contactId: string | null;
  supply: MedicationSupply | null;
}

export function createRoutine(s: CooState, d: RoutineDraft): { changes: ChangeSet; routine: Routine; assignments: Assignment[] } {
  const tx = new Tx(s);
  const routine = tx.put(
    makeRoutine({
      area: d.area,
      template: d.template,
      icon: d.icon,
      title: d.title,
      description: d.description,
      dateLabel: d.dateLabel,
      plan: d.plan,
      followUps: d.followUps,
      repeatMonths: d.repeatMonths,
      countFrom: d.countFrom,
      medication: d.medication,
    }),
  );
  const assignments: Assignment[] = [];
  for (const sub of d.subjects) {
    let a = makeAssignment({
      routineId: routine.id,
      subjectType: sub.type,
      subjectId: sub.id,
      date: sub.date,
      repeatMonths: sub.repeatMonths,
      contactId: d.contactId,
      supply: d.supply,
    });
    if (d.medication && d.supply) a = { ...a, date: runOutDate(d.supply) };
    a = tx.put(a);
    assignments.push(a);
    if (a.date) for (const t of planCycle(routine, a, a.date)) tx.put(t);
  }
  return { changes: tx.changes(), routine, assignments };
}

/** Rename/describe and change who it is assigned to. */
export function editRoutine(
  s: CooState,
  r: Routine,
  p: {
    title: string;
    description: string;
    subjects: { type: SubjectType; id: string }[];
    /** New template defaults. Changed default steps re-plan everyone who uses them. */
    defaults?: { repeatMonths: number | null; countFrom: 'done' | 'due'; plan: StepPlan[] };
  },
): ChangeSet {
  const tx = new Tx(s);
  const next = tx.put({
    ...r,
    title: p.title,
    description: p.description,
    ...(p.defaults ?? {}),
  });
  if (p.defaults && !r.medication && !samePlan(r.plan, p.defaults.plan)) {
    for (const a of assignmentsOf(s, r)) {
      if (a.plan == null && a.date && !a.done) replanOpenSteps(tx, r.plan, next, a);
    }
  }
  const current = assignmentsOf(s, r);
  const want = new Set(p.subjects.map((x) => `${x.type}:${x.id}`));
  for (const a of current) {
    if (want.has(`${a.subjectType}:${a.subjectId}`)) continue;
    tx.del(a);
    for (const t of s.tasks) if (t.assignmentId === a.id) tx.del(t);
    for (const d of s.documents) if (d.assignmentId === a.id) tx.put({ ...d, assignmentId: null });
  }
  const have = new Set(current.map((a) => `${a.subjectType}:${a.subjectId}`));
  for (const sub of p.subjects) {
    if (have.has(`${sub.type}:${sub.id}`)) continue;
    tx.put(
      makeAssignment({
        routineId: r.id,
        subjectType: sub.type,
        subjectId: sub.id,
        repeatMonths: r.repeatMonths,
        supply: r.medication ? defaultSupply() : null,
        date: null,
      }),
    );
  }
  if (p.subjects.length === 0) tx.del(r);
  return tx.changes();
}

export function deleteRoutine(s: CooState, r: Routine): ChangeSet {
  const tx = new Tx(s);
  tx.del(r);
  for (const a of assignmentsOf(s, r)) {
    tx.del(a);
    for (const t of s.tasks) if (t.assignmentId === a.id) tx.del(t);
    for (const d of s.documents) if (d.assignmentId === a.id) tx.put({ ...d, assignmentId: null });
  }
  return tx.changes();
}

export function defaultSupply(): MedicationSupply {
  return { onHand: 30, asOf: today(), perDay: 1, unit: 'tablets', perRefill: 30, refillsLeft: 0, orderLeadDays: 7 };
}

export function assignExisting(
  s: CooState,
  r: Routine,
  type: SubjectType,
  id: string,
  opts: { date?: ISODate | null; repeatMonths?: number | null } = {},
): { changes: ChangeSet; assignment: Assignment } {
  const tx = new Tx(s);
  const a = tx.put(
    makeAssignment({
      routineId: r.id,
      subjectType: type,
      subjectId: id,
      date: r.medication ? null : opts.date ?? null,
      repeatMonths: opts.repeatMonths === undefined ? r.repeatMonths : opts.repeatMonths,
      supply: r.medication ? defaultSupply() : null,
    }),
  );
  if (!r.medication && a.date) for (const t of planCycle(r, a, a.date)) tx.put(t);
  if (r.medication && a.supply) {
    const withDate = tx.put({ ...a, date: runOutDate(a.supply) });
    for (const t of planCycle(r, withDate, withDate.date!)) tx.put(t);
    return { changes: tx.changes(), assignment: withDate };
  }
  return { changes: tx.changes(), assignment: a };
}

/** Adds a step to an assignment from the routine detail. */
export function addStep(s: CooState, a: Assignment, title: string, date: ISODate | null): ChangeSet {
  const tx = new Tx(s);
  tx.put(
    makeTask({
      title,
      date,
      subjectType: a.subjectType,
      subjectId: a.subjectId,
      assignmentId: a.id,
    }),
  );
  return tx.changes();
}

// ── Subjects ────────────────────────────────────────────────────────────────

export function putEntity(s: CooState, e: Entity): ChangeSet {
  const tx = new Tx(s);
  tx.put(e);
  return tx.changes();
}

/** Removes a person or car and everything that belongs only to them. */
export function deleteSubject(s: CooState, type: SubjectType, id: string): ChangeSet {
  const tx = new Tx(s);
  const e = type === 'person' ? s.people.find((p) => p.id === id) : s.cars.find((c) => c.id === id);
  if (!e) return tx.changes();
  tx.del(e);
  const gone = new Set<string>();
  for (const a of s.assignments) {
    if (a.subjectType === type && a.subjectId === id) {
      tx.del(a);
      gone.add(a.id);
    }
  }
  for (const r of s.routines) {
    const rest = s.assignments.filter((a) => a.routineId === r.id && !gone.has(a.id));
    if (rest.length === 0 && s.assignments.some((a) => a.routineId === r.id)) tx.del(r);
  }
  for (const t of s.tasks) if (t.subjectType === type && t.subjectId === id) tx.del(t);
  for (const d of s.documents) if (d.subjectType === type && d.subjectId === id) tx.del(d);
  if (type === 'person') {
    for (const trip of s.trips) {
      if (trip.travelers.includes(id)) tx.put({ ...trip, travelers: trip.travelers.filter((x) => x !== id) });
    }
  }
  return tx.changes();
}

// ── Documents ───────────────────────────────────────────────────────────────

/**
 * Saves a document. If it is linked to a routine, older documents of the same
 * routine and type are archived and open "file the new document" tasks close.
 */
export function saveDocument(s: CooState, d: Document, opts: { closeTaskId?: string } = {}, tx = new Tx(s)): ChangeSet {
  const prev = s.documents.find((x) => x.id === d.id);
  tx.put(d);
  const isNew = !prev;
  if (d.assignmentId && (isNew || prev?.assignmentId !== d.assignmentId) && d.docKind !== 'health') {
    for (const o of s.documents) {
      if (o.id !== d.id && o.assignmentId === d.assignmentId && o.type === d.type && !o.archived) {
        tx.put({ ...o, archived: true, pinned: false });
      }
    }
  }
  if (d.assignmentId && isNew) {
    for (const t of s.tasks) {
      if (t.assignmentId === d.assignmentId && !t.done && t.docTask?.docKind === d.docKind) {
        tx.put({ ...t, done: true, doneAt: nowStamp() });
      }
    }
  }
  if (opts.closeTaskId) {
    const t = s.tasks.find((x) => x.id === opts.closeTaskId);
    if (t && !t.done) tx.put({ ...t, done: true, doneAt: nowStamp() });
  }
  // Editing an ID's expiry moves the linked routine (unless the ID is outdated).
  if (prev && d.docKind === 'identity' && d.assignmentId && !d.outdated && prev.validUntil && d.validUntil && prev.validUntil !== d.validUntil) {
    const a = assignmentById(s, d.assignmentId);
    if (a && a.date) setAssignmentDate(s, a, addDays(a.date, diffDays(prev.validUntil, d.validUntil)), tx);
  }
  return tx.changes();
}

/** Creates a renewal routine for an ID and links the ID to it. */
export function renewalRoutineForId(
  _s: CooState,
  d: Document,
  remindDays: number,
  tx: Tx,
): { assignment: Assignment; firstDate: ISODate } {
  const isPassport = d.type === 'Passport';
  const docLabel = d.type === 'Other' ? 'document' : d.type.toLowerCase().replace(/^city or state id$/, 'ID card');
  const plan: StepPlan[] = [step(isPassport ? 'Submit passport renewal' : `Renew ${docLabel}`, -remindDays, 'renew')];
  if (isPassport) plan.unshift(step('Check renewal requirements and get a photo', -(remindDays + 30)));
  const routine = tx.put(
    makeRoutine({
      area: 'identity',
      template: null,
      icon: 'idcard',
      title: `${d.type === 'Other' ? d.name : d.type} renewal`,
      description: `Renewal reminders for ${d.name}.`,
      dateLabel: 'Expires',
      plan,
      followUps: [
        step(`Add the new ${docLabel} to documents`, 0, 'plain', {
          docTask: { docKind: 'identity', docType: d.type },
        }),
      ],
      repeatMonths: null,
      countFrom: 'due',
      medication: false,
    }),
  );
  const a = tx.put(
    makeAssignment({
      routineId: routine.id,
      subjectType: d.subjectType,
      subjectId: d.subjectId,
      date: d.validUntil,
      repeatMonths: null,
    }),
  );
  const tasks = d.validUntil ? planCycle(routine, a, d.validUntil) : [];
  for (const t of tasks) tx.put(t);
  return { assignment: a, firstDate: tasks.sort(byDate)[0]?.date ?? d.validUntil ?? today() };
}

export function setArchived(s: CooState, d: Document, archived: boolean): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...d, archived, pinned: archived ? false : d.pinned });
  return tx.changes();
}

// ── Trips ───────────────────────────────────────────────────────────────────

/** Keeps a reservation's "Book:" and "Check in online:" tasks in sync. */
export function syncTripTasks(tx: Tx, r: Reservation) {
  const existing = tx.tasks().filter((t) => t.reservationId === r.id);
  const book = existing.find((t) => t.tripTask === 'book');
  const checkin = existing.find((t) => t.tripTask === 'checkin');

  if (r.status === 'planned' && r.bookBy) {
    const fields = { title: `Book: ${r.title}`, date: r.bookBy };
    if (book) tx.put({ ...book, ...fields, done: false, doneAt: null });
    else tx.put(makeTask({ ...fields, tripId: r.tripId, reservationId: r.id, tripTask: 'book' }));
  } else if (book) {
    if (r.status === 'booked') {
      if (!book.done) tx.put({ ...book, done: true, doneAt: nowStamp() });
    } else tx.del(book);
  }

  if (r.type === 'flight' && r.checkinReminder && r.start) {
    const fields = { title: `Check in online: ${r.title}`, date: addDays(datePart(r.start), -1) };
    if (checkin) {
      if (checkin.title !== fields.title || checkin.date !== fields.date) tx.put({ ...checkin, ...fields });
    } else tx.put(makeTask({ ...fields, tripId: r.tripId, reservationId: r.id, tripTask: 'checkin' }));
  } else if (checkin) tx.del(checkin);
}

export function saveReservation(s: CooState, r: Reservation, closeTaskId?: string): ChangeSet {
  const tx = new Tx(s);
  tx.put(r);
  syncTripTasks(tx, r);
  if (closeTaskId && r.status === 'booked') {
    const t = tx.tasks().find((x) => x.id === closeTaskId);
    if (t && !t.done) tx.put({ ...t, done: true, doneAt: nowStamp() });
  }
  return tx.changes();
}

export function deleteReservation(s: CooState, r: Reservation): ChangeSet {
  const tx = new Tx(s);
  tx.del(r);
  for (const t of s.tasks) if (t.reservationId === r.id) tx.del(t);
  return tx.changes();
}

export function saveTrip(s: CooState, t: Trip): ChangeSet {
  const tx = new Tx(s);
  tx.put(t);
  return tx.changes();
}

export function deleteTrip(s: CooState, t: Trip): ChangeSet {
  const tx = new Tx(s);
  tx.del(t);
  for (const r of s.reservations) if (r.tripId === t.id) tx.del(r);
  for (const x of s.tasks) if (x.tripId === t.id) tx.del(x);
  return tx.changes();
}

export function deleteContact(s: CooState, c: Contact): ChangeSet {
  const tx = new Tx(s);
  tx.del(c);
  for (const a of s.assignments) if (a.contactId === c.id) tx.put({ ...a, contactId: null });
  return tx.changes();
}

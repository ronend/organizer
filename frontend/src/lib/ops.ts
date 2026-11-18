/**
 * Mutations. Each op reads the current state and writes into a Tx; the store
 * applies the resulting ChangeSet optimistically and derives Undo from it.
 *
 * The backend refuses a change that leaves a dangling reference
 * (backend/src/integrity.py), so deletes here cascade: a task takes its
 * subtasks, a reservation its booking tasks and attachments, a subject
 * everything that belongs to it.
 */
import type {
  AppointmentInfo,
  Assignment,
  ChangeSet,
  Contact,
  CooState,
  Document,
  Entity,
  EntityRef,
  ISODate,
  MedicationSupply,
  Reservation,
  Routine,
  RoutineArea,
  StepPlan,
  Subject,
  Task,
} from '../types/coo';
import { COLLECTION } from '../types/coo';
import { addDays, datePart, diffDays, nowStamp, today } from './dates';
import {
  assignmentById,
  assignmentIdOf,
  assignmentsOf,
  byDate,
  contactName,
  doneVerb,
  effectivePlan,
  isMedication,
  onHandNow,
  reservationIdOf,
  routineOf,
  runOutDate,
  samePlan,
  stepKindOf,
  stepOf,
} from './model';
import { categoryFields } from './registry';
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
    // Agenda rows carry their parent for display; it isn't part of the record.
    if (out.kind === 'task' && 'parent' in out) delete (out as { parent?: unknown }).parent;
    this.puts.set(k, out);
    return out;
  }

  del(e: Entity | EntityRef) {
    const k = `${e.kind}#${e.id}`;
    const wasNew = this.puts.has(k) && !findIn(this.s, e.kind, e.id);
    this.puts.delete(k);
    if (!wasNew) this.dels.set(k, { kind: e.kind, id: e.id });
  }

  /** Deletes a task with its subtasks and attachments. */
  delTask(t: Task) {
    for (const c of this.tasks()) if (c.parentId === t.id) this.del(c);
    for (const d of this.s.documents) if (d.attachedTo?.kind === 'task' && d.attachedTo.id === t.id) this.del(d);
    this.del(t);
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

export function findIn(s: CooState, kind: Entity['kind'], id: string): Entity | undefined {
  return (s[COLLECTION[kind]] as Entity[]).find((e) => e.id === id);
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
  for (const e of cs.put) coll(COLLECTION[e.kind]).set(e.id, e);
  for (const d of cs.delete) coll(COLLECTION[d.kind]).delete(d.id);
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
  return { id: newId(prefix), createdAt: now, updatedAt: now, archived: false };
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
    subjectId: null,
    parentId: null,
    notes: '',
    date: today(),
    order: nextOrder(),
    done: false,
    doneAt: null,
    source: null,
    appointment: null,
    requestsDocument: null,
    ...p,
  };
}

export function makeSubject(p: Omit<Subject, 'kind' | 'id' | 'createdAt' | 'updatedAt' | 'archived'>): Subject {
  return { kind: 'subject', ...base(p.subjectType === 'person' ? 'p' : p.subjectType === 'car' ? 'c' : p.subjectType === 'trip' ? 'tr' : 's'), ...p };
}

export function makeContact(p: Omit<Contact, 'kind' | 'id' | 'createdAt' | 'updatedAt' | 'archived'>): Contact {
  return { kind: 'contact', ...base('k'), ...p };
}

export function makeRoutine(p: Omit<Routine, 'kind' | 'id' | 'createdAt' | 'updatedAt' | 'archived'>): Routine {
  return { kind: 'routine', ...base('r'), ...p };
}

export function makeAssignment(p: Partial<Assignment> & { routineId: string; subjectId: string }): Assignment {
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

export function makeDocument(p: Partial<Document> & Pick<Document, 'category' | 'subjectId' | 'title' | 'type'>): Document {
  return {
    kind: 'document',
    ...base('d'),
    attachedTo: null,
    date: null,
    files: [],
    fields: {},
    customFields: [],
    assignmentId: null,
    pinned: false,
    expiry: null,
    ...p,
  };
}

export function makeReservation(p: Omit<Reservation, 'kind' | 'id' | 'createdAt' | 'updatedAt' | 'archived'>): Reservation {
  return { kind: 'reservation', ...base('res'), ...p };
}

const clampToday = (d: ISODate) => (d < today() ? today() : d);

function stepTask(a: Assignment, p: StepPlan, date: ISODate): Task {
  return makeTask({
    title: p.title,
    date,
    subjectId: a.subjectId,
    source: { kind: 'assignment', id: a.id, step: p.kind },
    requestsDocument: p.requestsDocument,
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
  if (isMedication(r)) return medicationSteps(r, a);
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
    subjectId: string | null;
    assignmentId?: string | null;
    notes?: string;
    /** Subtask titles (and optional dates) created with the task. */
    subtasks?: { title: string; date?: ISODate | null }[];
  },
): ChangeSet {
  const tx = new Tx(s);
  const parent = tx.put(
    makeTask({
      title: p.title,
      date: p.date,
      subjectId: p.subjectId,
      source: p.assignmentId ? { kind: 'assignment', id: p.assignmentId, step: 'plain' } : null,
      notes: p.notes ?? '',
    }),
  );
  (p.subtasks ?? []).forEach((st, i) => {
    tx.put(makeTask({ title: st.title, date: st.date ?? null, subjectId: parent.subjectId, parentId: parent.id, order: i + 1 }));
  });
  return tx.changes();
}

/** A new subtask at the end of the parent's list. */
export function addSubtask(s: CooState, parent: Task, title: string, date: ISODate | null = null): ChangeSet {
  const tx = new Tx(s);
  const siblings = tx.tasks().filter((t) => t.parentId === parent.id);
  const order = siblings.reduce((m, t) => Math.max(m, t.order), 0) + 1;
  tx.put(makeTask({ title, date, subjectId: parent.subjectId, parentId: parent.id, order }));
  return tx.changes();
}

export function setTaskDone(s: CooState, t: Task, done: boolean): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...t, done, doneAt: done ? nowStamp() : null });
  return tx.changes();
}

/** Updates a task; moving it to another subject moves its subtasks too. */
export function updateTask(s: CooState, t: Task, patch: Partial<Task>): ChangeSet {
  const tx = new Tx(s);
  const next = tx.put({ ...t, ...patch });
  if (next.subjectId !== t.subjectId) {
    for (const c of s.tasks) if (c.parentId === t.id) tx.put({ ...c, subjectId: next.subjectId });
  }
  return tx.changes();
}

export function deleteTask(s: CooState, t: Task): ChangeSet {
  const tx = new Tx(s);
  tx.delTask(t);
  return tx.changes();
}

/**
 * Saves a task's subtask list as edited in the task dialog: updates changed
 * ones, adds new ones (ids not in the store yet), deletes the ones removed.
 */
export function saveSubtasks(
  s: CooState,
  parent: Task,
  list: { id: string; title: string; done: boolean; date: ISODate | null }[],
  tx = new Tx(s),
): ChangeSet {
  const current = s.tasks.filter((t) => t.parentId === parent.id);
  const keep = new Set(list.map((x) => x.id).filter(Boolean));
  for (const c of current) if (!keep.has(c.id)) tx.delTask(c);
  list.forEach((x, i) => {
    const order = i + 1;
    const cur = current.find((c) => c.id === x.id);
    if (cur) {
      if (cur.title !== x.title || cur.done !== x.done || cur.date !== x.date || cur.order !== order || cur.subjectId !== parent.subjectId) {
        tx.put({ ...cur, title: x.title, done: x.done, doneAt: x.done ? (cur.doneAt ?? nowStamp()) : null, date: x.date, order, subjectId: parent.subjectId });
      }
    } else {
      // The editor picked the id, so saving the same list twice doesn't duplicate it.
      tx.put(makeTask({ id: x.id, title: x.title, done: x.done, doneAt: x.done ? nowStamp() : null, date: x.date, order, subjectId: parent.subjectId, parentId: parent.id }));
    }
  });
  return tx.changes();
}

/** Completes a schedule step and books the appointment (+ a prep reminder). */
export function bookAppointment(s: CooState, t: Task, p: { date: ISODate; info: AppointmentInfo }): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...t, done: true, doneAt: nowStamp() });
  const a = assignmentById(s, assignmentIdOf(t));
  const r = routineOf(s, a);
  const title = r ? r.title : t.title.replace(/^(book|schedule)\s+/i, '');
  tx.put(
    makeTask({
      title: title[0].toUpperCase() + title.slice(1),
      date: p.date,
      subjectId: t.subjectId,
      source: a ? { kind: 'assignment', id: a.id, step: 'renew' } : null,
      appointment: p.info,
    }),
  );
  const subject = s.subjects.find((x) => x.id === t.subjectId);
  if (p.info.prep.trim() && subject?.subjectType === 'person') {
    tx.put(
      makeTask({
        title: `Prepare: ${p.info.prep.trim()}`,
        date: clampToday(addDays(p.date, -1)),
        subjectId: t.subjectId,
        source: a ? { kind: 'assignment', id: a.id, step: 'plain' } : null,
      }),
    );
  }
  if (a && p.info.providerId && !a.contactId) tx.put({ ...a, contactId: p.info.providerId });
  if (p.info.providerId && t.subjectId) linkContact(s, tx, p.info.providerId, t.subjectId);
  return tx.changes();
}

/**
 * Completes a renewal (or an appointment that closes a cycle). With a next
 * date it plans the next cycle; a routine that doesn't repeat becomes Done.
 */
export function completeCycle(s: CooState, t: Task, nextDate: ISODate | null): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...t, done: true, doneAt: nowStamp() });
  const a = assignmentById(s, assignmentIdOf(t));
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
    if (stepOf(other, a.id) && other.id !== t.id && !other.done && !other.appointment && planned.has(other.title)) {
      tx.delTask(other);
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
  // The replaced document is now outdated (renewals of expiring documents).
  for (const d of s.documents) {
    if (d.assignmentId === a.id && !d.archived && d.expiry && !d.expiry.outdated) {
      tx.put({ ...d, expiry: { ...d.expiry, outdated: true } });
    }
  }
  return tx.changes();
}

/** Logs a refill: recalculates the run-out date and plans the next order. */
export function logRefill(s: CooState, a: Assignment, p: { received: number; refillsLeft: number }, fromTask?: Task): ChangeSet {
  const tx = new Tx(s);
  const r = routineOf(s, a);
  if (!r || !a.supply) return tx.changes();
  for (const t of s.tasks) {
    if (
      stepOf(t, a.id) && !t.done &&
      (stepKindOf(t) === 'pickup' || t.id === fromTask?.id || /^(Order a refill|Get a new prescription)/.test(t.title))
    ) {
      tx.put({ ...t, done: true, doneAt: nowStamp() });
    }
  }
  const supply: MedicationSupply = { ...a.supply, onHand: onHandNow(a.supply) + p.received, asOf: today(), refillsLeft: p.refillsLeft };
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
  if (isMedication(r) && next.supply && date) {
    next = { ...next, supply: { ...next.supply!, onHand: Math.max(0, diffDays(today(), date)) * next.supply!.perDay, asOf: today() } };
  }
  tx.put(next);
  if (!r) return tx.changes();
  const open = tx.tasks().filter((t) => stepOf(t, a.id) && !t.done && !t.appointment);
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
  const mine = tx.tasks().filter((t) => stepOf(t, a.id));
  for (const t of mine) {
    if (!t.done && !t.appointment && oldTitles.has(t.title)) tx.delTask(t);
  }
  const plan = effectivePlan(r, a);
  const earliest = Math.min(0, ...plan.map((p) => p.offsetDays), ...oldPlan.map((p) => p.offsetDays));
  const cycleStart = addDays(a.date, earliest - 30);
  const doneThisCycle = new Set(mine.filter((t) => t.done && (t.date ?? '') >= cycleStart).map((t) => t.title));
  const bookedThisCycle = mine.some((t) => t.appointment && !t.done);
  for (const t of planCycle(r, a, a.date)) {
    if (doneThisCycle.has(t.title)) continue;
    if (bookedThisCycle && stepKindOf(t) === 'schedule') continue;
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
  if (!isMedication(r) && cur.date && !samePlan(oldPlan, effectivePlan(r, cur))) {
    replanOpenSteps(tx, oldPlan, r, cur);
  }
  return tx.changes();
}

export function updateAssignment(s: CooState, a: Assignment, patch: Partial<Assignment>): ChangeSet {
  const tx = new Tx(s);
  const next = tx.put({ ...a, ...patch });
  if (next.contactId && next.contactId !== a.contactId) linkContact(s, tx, next.contactId, next.subjectId);
  return tx.changes();
}

export interface RoutineDraft {
  area: RoutineArea;
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
  subjects: { id: string; date: ISODate | null; repeatMonths: number | null }[];
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
      extension: d.medication ? { medication: true } : null,
    }),
  );
  const assignments: Assignment[] = [];
  for (const sub of d.subjects) {
    let a = makeAssignment({
      routineId: routine.id,
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
    if (d.contactId) linkContact(s, tx, d.contactId, sub.id);
  }
  return { changes: tx.changes(), routine, assignments };
}

/** Removes an assignment with its steps; linked documents keep existing, unlinked. */
function dropAssignment(s: CooState, tx: Tx, a: Assignment) {
  for (const t of tx.tasks()) if (stepOf(t, a.id) && !t.parentId) tx.delTask(t);
  for (const d of s.documents) if (d.assignmentId === a.id) tx.put({ ...tx.get(d), assignmentId: null });
  tx.del(a);
}

/** Rename/describe and change who it is assigned to. */
export function editRoutine(
  s: CooState,
  r: Routine,
  p: {
    title: string;
    description: string;
    subjectIds: string[];
    /** New template defaults. Changed default steps re-plan everyone who uses them. */
    defaults?: { repeatMonths: number | null; countFrom: 'done' | 'due'; plan: StepPlan[] };
  },
): ChangeSet {
  const tx = new Tx(s);
  const next = tx.put({ ...r, title: p.title, description: p.description, ...(p.defaults ?? {}) });
  if (p.defaults && !isMedication(r) && !samePlan(r.plan, p.defaults.plan)) {
    for (const a of assignmentsOf(s, r)) {
      if (a.plan == null && a.date && !a.done) replanOpenSteps(tx, r.plan, next, a);
    }
  }
  const current = assignmentsOf(s, r);
  const want = new Set(p.subjectIds);
  for (const a of current) if (!want.has(a.subjectId)) dropAssignment(s, tx, a);
  const have = new Set(current.map((a) => a.subjectId));
  for (const id of p.subjectIds) {
    if (have.has(id)) continue;
    tx.put(
      makeAssignment({
        routineId: r.id,
        subjectId: id,
        repeatMonths: r.repeatMonths,
        supply: isMedication(r) ? defaultSupply() : null,
        date: null,
      }),
    );
  }
  if (p.subjectIds.length === 0) tx.del(r);
  return tx.changes();
}

export function deleteRoutine(s: CooState, r: Routine): ChangeSet {
  const tx = new Tx(s);
  for (const a of assignmentsOf(s, r)) dropAssignment(s, tx, a);
  tx.del(r);
  return tx.changes();
}

export function defaultSupply(): MedicationSupply {
  return { onHand: 30, asOf: today(), perDay: 1, unit: 'tablets', perRefill: 30, refillsLeft: 0, orderLeadDays: 7 };
}

export function assignExisting(
  s: CooState,
  r: Routine,
  subjectId: string,
  opts: { date?: ISODate | null; repeatMonths?: number | null } = {},
): { changes: ChangeSet; assignment: Assignment } {
  const tx = new Tx(s);
  const med = isMedication(r);
  const a = tx.put(
    makeAssignment({
      routineId: r.id,
      subjectId,
      date: med ? null : opts.date ?? null,
      repeatMonths: opts.repeatMonths === undefined ? r.repeatMonths : opts.repeatMonths,
      supply: med ? defaultSupply() : null,
    }),
  );
  if (!med && a.date) for (const t of planCycle(r, a, a.date)) tx.put(t);
  if (med && a.supply) {
    const withDate = tx.put({ ...a, date: runOutDate(a.supply) });
    for (const t of planCycle(r, withDate, withDate.date!)) tx.put(t);
    return { changes: tx.changes(), assignment: withDate };
  }
  return { changes: tx.changes(), assignment: a };
}

/** Adds a step to an assignment from the routine detail. */
export function addStep(s: CooState, a: Assignment, title: string, date: ISODate | null): ChangeSet {
  const tx = new Tx(s);
  tx.put(makeTask({ title, date, subjectId: a.subjectId, source: { kind: 'assignment', id: a.id, step: 'plain' } }));
  return tx.changes();
}

// ── Subjects ────────────────────────────────────────────────────────────────

export function putEntity(s: CooState, e: Entity): ChangeSet {
  const tx = new Tx(s);
  tx.put(e);
  return tx.changes();
}

/** Removes a subject and everything that belongs to it; unlinks it elsewhere. */
export function deleteSubject(s: CooState, id: string): ChangeSet {
  const tx = new Tx(s);
  const sub = s.subjects.find((x) => x.id === id);
  if (!sub) return tx.changes();
  const gone = new Set<string>();
  for (const a of s.assignments) {
    if (a.subjectId === id) {
      dropAssignment(s, tx, a);
      gone.add(a.id);
    }
  }
  for (const r of s.routines) {
    const all = s.assignments.filter((a) => a.routineId === r.id);
    if (all.length > 0 && all.every((a) => gone.has(a.id))) tx.del(r);
  }
  for (const t of tx.tasks()) if (t.subjectId === id && !t.parentId) tx.delTask(t);
  for (const d of s.documents) if (d.subjectId === id) tx.del(d);
  for (const r of s.reservations) if (r.subjectId === id) tx.del(r);
  // Other subjects that point at it (e.g. a trip's travelers).
  for (const other of s.subjects) {
    if (other.id === id) continue;
    let changed = false;
    const attributes = { ...other.attributes };
    for (const [k, v] of Object.entries(attributes)) {
      if (v === id) {
        attributes[k] = null;
        changed = true;
      } else if (Array.isArray(v) && v.includes(id)) {
        attributes[k] = v.filter((x) => x !== id);
        changed = true;
      }
    }
    if (changed) tx.put({ ...other, attributes });
  }
  for (const c of s.contacts) {
    if (c.links.some((l) => l.subjectId === id)) tx.put({ ...c, links: c.links.filter((l) => l.subjectId !== id) });
  }
  tx.del(sub);
  return tx.changes();
}

/** Links a contact to a subject (once). */
export function linkContact(s: CooState, tx: Tx, contactId: string, subjectId: string, role?: string) {
  const c = s.contacts.find((x) => x.id === contactId);
  if (!c) return;
  const cur = tx.get(c);
  if (cur.links.some((l) => l.subjectId === subjectId)) return;
  tx.put({ ...cur, links: [...cur.links, { subjectId, role: role ?? cur.role }] });
}

// ── Documents ───────────────────────────────────────────────────────────────

/**
 * Saves a document locally (the mock backend only; the real app saves through
 * POST /api/documents, which applies these rules server-side). If it is
 * linked to a routine, older documents of the same routine and type are
 * archived and open "add the document" tasks close.
 */
export function saveDocument(s: CooState, d: Document, opts: { closeTaskId?: string } = {}, tx = new Tx(s)): ChangeSet {
  const prev = s.documents.find((x) => x.id === d.id);
  tx.put(d);
  const isNew = !prev;
  if (d.assignmentId && (isNew || prev?.assignmentId !== d.assignmentId) && d.category !== 'health') {
    for (const o of s.documents) {
      if (o.id !== d.id && o.assignmentId === d.assignmentId && o.type === d.type && !o.archived) {
        tx.put({ ...o, archived: true, pinned: false });
      }
    }
  }
  if (d.assignmentId && isNew) {
    for (const t of s.tasks) {
      if (stepOf(t, d.assignmentId) && !t.done && t.requestsDocument?.category === d.category) {
        tx.put({ ...t, done: true, doneAt: nowStamp() });
      }
    }
  }
  if (opts.closeTaskId) {
    const t = s.tasks.find((x) => x.id === opts.closeTaskId);
    if (t && !t.done) tx.put({ ...t, done: true, doneAt: nowStamp() });
  }
  // Editing an ID's expiry moves the linked routine (unless the ID is outdated).
  const was = prev?.expiry?.validUntil;
  const now = d.expiry?.validUntil;
  if (prev && d.category === 'identity' && d.assignmentId && d.expiry && !d.expiry.outdated && was && now && was !== now) {
    const a = assignmentById(s, d.assignmentId);
    if (a && a.date) setAssignmentDate(s, a, addDays(a.date, diffDays(was, now)), tx);
  }
  return tx.changes();
}

/** Creates a renewal routine for an expiring document and links the document to it. */
export function renewalRoutineForId(_s: CooState, d: Document, remindDays: number, tx: Tx): { assignment: Assignment; firstDate: ISODate } {
  const isPassport = d.type === 'Passport';
  const docLabel = d.type === 'Other' ? 'document' : d.type.toLowerCase().replace(/^city or state id$/, 'ID card');
  const plan: StepPlan[] = [step(isPassport ? 'Submit passport renewal' : `Renew ${docLabel}`, -remindDays, 'renew')];
  if (isPassport) plan.unshift(step('Check renewal requirements and get a photo', -(remindDays + 30)));
  const until = d.expiry?.validUntil ?? null;
  const routine = tx.put(
    makeRoutine({
      area: 'identity',
      template: null,
      icon: 'idcard',
      title: `${d.type === 'Other' ? d.title : d.type} renewal`,
      description: `Renewal reminders for ${d.title}.`,
      dateLabel: 'Expires',
      plan,
      followUps: [step(`Add the new ${docLabel} to documents`, 0, 'plain', { requestsDocument: { category: d.category, type: d.type } })],
      repeatMonths: null,
      countFrom: 'due',
      extension: null,
    }),
  );
  const a = tx.put(makeAssignment({ routineId: routine.id, subjectId: d.subjectId, date: until, repeatMonths: null }));
  const tasks = until ? planCycle(routine, a, until) : [];
  for (const t of tasks) tx.put(t);
  return { assignment: a, firstDate: tasks.sort(byDate)[0]?.date ?? until ?? today() };
}

export function setArchived(s: CooState, d: Document, archived: boolean): ChangeSet {
  const tx = new Tx(s);
  tx.put({ ...d, archived, pinned: archived ? false : d.pinned });
  return tx.changes();
}

/** Keeps only the document fields its category and type define. */
export function cleanDocFields(d: Document): Document {
  const keys = new Set(categoryFields(d.category, d.type).map((f) => f.key));
  return { ...d, fields: Object.fromEntries(Object.entries(d.fields).filter(([k, v]) => keys.has(k) && v !== '' && v !== null)) };
}

// ── Trips and reservations ──────────────────────────────────────────────────

/** Keeps a reservation's "Book:" and "Check in online:" tasks in sync. */
export function syncTripTasks(tx: Tx, r: Reservation) {
  const existing = tx.tasks().filter((t) => reservationIdOf(t) === r.id);
  const stepOfTask = (t: Task) => (t.source?.kind === 'reservation' ? t.source.step : null);
  const book = existing.find((t) => stepOfTask(t) === 'book');
  const checkin = existing.find((t) => stepOfTask(t) === 'checkin');

  if (r.status === 'planned' && r.bookBy) {
    const fields = { title: `Book: ${r.title}`, date: r.bookBy };
    if (book) tx.put({ ...book, ...fields, done: false, doneAt: null });
    else tx.put(makeTask({ ...fields, subjectId: r.subjectId, source: { kind: 'reservation', id: r.id, step: 'book' } }));
  } else if (book) {
    if (r.status === 'booked') {
      if (!book.done) tx.put({ ...book, done: true, doneAt: nowStamp() });
    } else tx.delTask(book);
  }

  if (r.type === 'flight' && r.checkinReminder && r.start) {
    const fields = { title: `Check in online: ${r.title}`, date: addDays(datePart(r.start), -1) };
    if (checkin) {
      if (checkin.title !== fields.title || checkin.date !== fields.date) tx.put({ ...checkin, ...fields });
    } else tx.put(makeTask({ ...fields, subjectId: r.subjectId, source: { kind: 'reservation', id: r.id, step: 'checkin' } }));
  } else if (checkin) tx.delTask(checkin);
}

/** Saves a reservation and its attachments (attachment documents of the trip). */
export function saveReservation(
  s: CooState,
  r: Reservation,
  opts: { closeTaskId?: string; attachments?: Document[]; removeAttachments?: Document[] } = {},
): ChangeSet {
  const tx = new Tx(s);
  tx.put(r);
  syncTripTasks(tx, r);
  for (const d of opts.attachments ?? []) tx.put(d);
  for (const d of opts.removeAttachments ?? []) tx.del(d);
  if (opts.closeTaskId && r.status === 'booked') {
    const t = tx.tasks().find((x) => x.id === opts.closeTaskId);
    if (t && !t.done) tx.put({ ...t, done: true, doneAt: nowStamp() });
  }
  return tx.changes();
}

export function deleteReservation(s: CooState, r: Reservation): ChangeSet {
  const tx = new Tx(s);
  for (const t of tx.tasks()) if (reservationIdOf(t) === r.id && !t.parentId) tx.delTask(t);
  for (const d of s.documents) if (d.attachedTo?.kind === 'reservation' && d.attachedTo.id === r.id) tx.del(d);
  tx.del(r);
  return tx.changes();
}

export function saveTrip(s: CooState, t: Subject): ChangeSet {
  const tx = new Tx(s);
  tx.put(t);
  return tx.changes();
}

export function deleteTrip(s: CooState, t: Subject): ChangeSet {
  return deleteSubject(s, t.id);
}

// ── Contacts ────────────────────────────────────────────────────────────────

/** Removes a contact and every reference to it. */
export function deleteContact(s: CooState, c: Contact): ChangeSet {
  const tx = new Tx(s);
  for (const a of s.assignments) if (a.contactId === c.id) tx.put({ ...a, contactId: null });
  for (const t of s.tasks) {
    if (t.appointment?.providerId === c.id) tx.put({ ...tx.get(t), appointment: { ...t.appointment, providerId: null, providerNote: t.appointment.providerNote || c.name } });
  }
  for (const d of s.documents) {
    const refs = categoryFields(d.category, d.type).filter((f) => f.type === 'contact' && d.fields[f.key] === c.id);
    if (refs.length) {
      const fields = { ...d.fields };
      for (const f of refs) delete fields[f.key];
      tx.put({ ...tx.get(d), fields });
    }
  }
  tx.del(c);
  return tx.changes();
}

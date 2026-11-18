import { useCallback, useState } from 'react';
import type { Assignment, Task } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Dialog, Field, FormActions } from '../components/ui';
import { addDays, fmtDate, today } from '../lib/dates';
import {
  assignmentById,
  contactsFor,
  effectivePlan,
  isSubItem,
  onHandNow,
  renewQuestion,
  routineOf,
  subjectName,
  suggestedNextDate,
  taskWho,
  assignmentIdOf,
  findSubject,
  reservationIdOf,
  stepKindOf,
} from '../lib/model';
import { bookAppointment, completeCycle, logRefill, setTaskDone } from '../lib/ops';
import { ReservationFormDialog } from './TripDialogs';

export function AppointmentDialog({ task }: { task: Task }) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const a = assignmentById(s, assignmentIdOf(task));
  const r = routineOf(s, a);
  const prepDefault = (r && a ? effectivePlan(r, a) : []).find((p) => p.kind === 'schedule')?.prep ?? '';
  const [date, setDate] = useState(addDays(today(), 7));
  const [time, setTime] = useState('09:00');
  const [providerId, setProviderId] = useState(a?.contactId ?? '');
  const [providerNote, setProviderNote] = useState('');
  const [prep, setPrep] = useState(prepDefault);
  const contacts = contactsFor(s, r?.area === 'car' ? 'car' : r?.area === 'health' ? 'health' : 'any');

  const submit = () => {
    if (!date) return;
    apply(
      bookAppointment(s, task, { date, info: { time, providerId: providerId || null, providerNote: providerNote.trim(), prep: prep.trim() } }),
      { toast: `Booked for ${fmtDate(date, true)}`, undo: true },
    );
    closeDialog();
  };

  return (
    <Dialog
      eyebrow={`${taskWho(s, task)} · ${r?.title ?? 'Appointment'}`}
      title="Schedule the appointment"
      onSubmit={submit}
      actions={<FormActions submit="Save appointment" />}
    >
      <div className="fields">
        <Field label="Date">{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
        <Field label="Time" optional>{(id) => <input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} />}</Field>
      </div>
      <div className="fields">
        <Field label="Provider" optional>
          {(id) => (
            <select id={id} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">Not in contacts</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Where or with whom" optional>
          {(id) => <input id={id} value={providerNote} onChange={(e) => setProviderNote(e.target.value)} placeholder="Room 4, Dr. Levi" />}
        </Field>
      </div>
      <Field
        label="Prep notes"
        optional
        hint={findSubject(s, task.subjectId)?.subjectType === 'person' ? 'A “Prepare” reminder is added the day before.' : undefined}
      >
        {(id) => <textarea id={id} rows={2} value={prep} onChange={(e) => setPrep(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

export function RenewDialog({ task }: { task: Task }) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const a = assignmentById(s, assignmentIdOf(task))!;
  const r = routineOf(s, a)!;
  const doneOn = task.appointment && task.date && task.date < today() ? task.date : today();
  const [date, setDate] = useState(suggestedNextDate(r, a, doneOn) ?? '');

  const submit = () => {
    if (!date) return;
    apply(completeCycle(s, task, date), {
      toast: `Done. Next one planned for ${fmtDate(date)}`,
      undo: true,
    });
    closeDialog();
  };

  return (
    <Dialog
      eyebrow={`${subjectName(s, a.subjectId)} · ${r.title}`}
      title={renewQuestion(r)}
      onSubmit={submit}
      actions={<FormActions submit="Save and plan next" />}
    >
      <Field
        label={renewQuestion(r).includes('expiry') ? 'New expiry date' : 'Next due'}
        hint="coo plans the next round of steps from this date."
      >
        {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required min={today()} />}
      </Field>
    </Dialog>
  );
}

export function RefillDialog({ assignment, task }: { assignment: Assignment; task?: Task }) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const r = routineOf(s, assignment)!;
  const sup = assignment.supply!;
  const [received, setReceived] = useState(String(sup.perRefill || ''));
  const [left, setLeft] = useState(String(Math.max(0, sup.refillsLeft - 1)));

  const submit = () => {
    apply(logRefill(s, assignment, { received: Number(received) || 0, refillsLeft: Number(left) || 0 }, task), {
      toast: 'Refill logged. Run-out date updated',
      undo: true,
    });
    closeDialog();
  };

  return (
    <Dialog
      eyebrow={`${subjectName(s, assignment.subjectId)} · ${r.title}`}
      title="Log refill picked up"
      onSubmit={submit}
      actions={<FormActions submit="Log refill" />}
    >
      <p className="muted">
        About {Math.round(onHandNow(sup))} {sup.unit} left before this refill.
      </p>
      <div className="fields">
        <Field label={`Quantity received (${sup.unit})`}>
          {(id) => <input id={id} type="number" min={0} step="any" value={received} onChange={(e) => setReceived(e.target.value)} required />}
        </Field>
        <Field label="Refills left">
          {(id) => <input id={id} type="number" min={0} value={left} onChange={(e) => setLeft(e.target.value)} required />}
        </Field>
      </div>
    </Dialog>
  );
}

/** The task checkbox: dispatches by task kind (book, renew, refill, done). */
export function useCompleteTask() {
  const { s, apply } = useStore();
  const { openDialog } = useUI();
  return useCallback(
    (t: Task) => {
      // A sub-task (on the Agenda or in a list): ticks just that sub-task.
      if (isSubItem(t) || t.parentId) {
        apply(setTaskDone(s, t, !t.done), { toast: `${t.done ? 'Reopened' : 'Done'} · ${t.title}`, undo: true });
        return;
      }
      if (t.done) {
        apply(setTaskDone(s, t, false), { toast: `Reopened · ${t.title}`, undo: true });
        return;
      }
      if (t.source?.kind === 'reservation' && t.source.step === 'book') {
        const res = s.reservations.find((x) => x.id === reservationIdOf(t));
        if (res) {
          openDialog(<ReservationFormDialog tripId={res.subjectId} reservation={res} forceBooked closeTaskId={t.id} />);
          return;
        }
      }
      const a = assignmentById(s, assignmentIdOf(t));
      const step = stepKindOf(t);
      if (a && step === 'schedule') {
        openDialog(<AppointmentDialog task={t} />);
        return;
      }
      if (a && step === 'pickup' && a.supply) {
        openDialog(<RefillDialog assignment={a} task={t} />);
        return;
      }
      if (a && step === 'renew') {
        if (!a.repeatMonths) {
          apply(completeCycle(s, t, null), { toast: `Done · ${t.title}`, undo: true });
        } else {
          openDialog(<RenewDialog task={t} />);
        }
        return;
      }
      apply(setTaskDone(s, t, true), { toast: `Done · ${t.title}`, undo: true });
    },
    [s, apply, openDialog],
  );
}

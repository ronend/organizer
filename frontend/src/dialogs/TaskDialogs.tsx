import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SubjectType, Task } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Dialog, Field, FormActions } from '../components/ui';
import { addDays, fmtDate, today } from '../lib/dates';
import {
  allSubjects,
  appointmentNote,
  assignmentById,
  assignmentsFor,
  isAdHoc,
  routineOf,
  subjectSub,
  taskWhat,
  taskWho,
} from '../lib/model';
import { addTask, deleteTask, updateTask } from '../lib/ops';
import { primaryLabel, useCompleteTask } from './TaskFlows';
import { DocFormFor } from './DocDialogs';

/** For select value: '' = General, 'person:<id>' / 'car:<id>'. */
function parseFor(v: string): { type: SubjectType | null; id: string | null } {
  if (!v) return { type: null, id: null };
  const [type, id] = v.split(':') as [SubjectType, string];
  return { type, id };
}

function ForSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { s } = useStore();
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">General, no one in particular</option>
      {allSubjects(s).map((x) => (
        <option key={x.entity.id} value={`${x.type}:${x.entity.id}`}>
          {x.type === 'person' ? x.entity.name : x.entity.makeModel} · {subjectSub(x)}
        </option>
      ))}
    </select>
  );
}

export function AddTaskDialog({ initialFor = '' }: { initialFor?: string }) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today());
  const [forV, setForV] = useState(initialFor);
  const [routine, setRoutine] = useState('');
  const [notes, setNotes] = useState('');
  const sub = parseFor(forV);
  const assignments = sub.type && sub.id ? assignmentsFor(s, sub.type, sub.id) : [];

  const quick = [
    { label: 'Today', date: today() },
    { label: 'Tomorrow', date: addDays(today(), 1) },
    { label: 'Next week', date: addDays(today(), 7) },
  ];

  const submit = () => {
    if (!title.trim()) return;
    apply(
      addTask(s, {
        title: title.trim(),
        date: date || null,
        subjectType: sub.type,
        subjectId: sub.id,
        assignmentId: routine || null,
        notes: notes.trim(),
      }),
      { toast: 'Added to your agenda' },
    );
    closeDialog();
  };

  return (
    <Dialog eyebrow="New task" title="Add a task" onSubmit={submit} actions={<FormActions submit="Add task" />}>
      <Field label="What needs doing">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} required />}</Field>
      <Field label="Due date">
        {(id) => (
          <div className="date-row">
            <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <div className="chips" role="group" aria-label="Quick dates">
              {quick.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  className={`chip ${date === q.date ? 'selected' : ''}`}
                  aria-pressed={date === q.date}
                  onClick={() => setDate(q.date)}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </Field>
      <Field label="For">
        {(id) => (
          <ForSelect
            id={id}
            value={forV}
            onChange={(v) => {
              setForV(v);
              setRoutine('');
            }}
          />
        )}
      </Field>
      <Field label="Routine" optional>
        {(id) => (
          <select id={id} value={routine} onChange={(e) => setRoutine(e.target.value)} disabled={!sub.type}>
            {!sub.type ? (
              <option value="">Choose a person or car first</option>
            ) : assignments.length === 0 ? (
              <option value="">No routines for this one yet</option>
            ) : (
              <>
                <option value="">None, a one-off task</option>
                {assignments.map((a) => (
                  <option key={a.id} value={a.id}>
                    {routineOf(s, a)?.title}
                  </option>
                ))}
              </>
            )}
          </select>
        )}
      </Field>
      <Field label="Notes" optional>{(id) => <textarea id={id} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
    </Dialog>
  );
}

export function TaskDetailDialog({ taskId }: { taskId: string }) {
  const { s, apply } = useStore();
  const { closeDialog, openDialog } = useUI();
  const navigate = useNavigate();
  const complete = useCompleteTask();
  const task = s.tasks.find((t) => t.id === taskId);
  const [title, setTitle] = useState(task?.title ?? '');
  const [date, setDate] = useState(task?.date ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [forV, setForV] = useState(task?.subjectType ? `${task.subjectType}:${task.subjectId}` : '');
  if (!task) return null;
  const adhoc = isAdHoc(task);
  const a = assignmentById(s, task.assignmentId);
  const r = routineOf(s, a);

  const patch = (): Partial<Task> => {
    const p: Partial<Task> = { date: date || null, notes: notes.trim() };
    if (adhoc) {
      const sub = parseFor(forV);
      p.title = title.trim() || task.title;
      p.subjectType = sub.type;
      p.subjectId = sub.id;
    }
    return p;
  };

  const save = () => {
    apply(updateTask(s, task, patch()), { toast: 'Saved' });
    closeDialog();
  };

  const snooze = (days: number) => {
    const base = task.date && task.date > today() ? task.date : today();
    const d = addDays(base, days);
    setDate(d);
    apply(updateTask(s, task, { date: d }), { toast: `Snoozed to ${fmtDate(d, true)}`, undo: true });
  };

  const primary = () => {
    const cur = { ...task, ...patch() };
    const changed = cur.date !== task.date || cur.notes !== task.notes || cur.title !== task.title || cur.subjectId !== task.subjectId;
    if (changed) apply(updateTask(s, task, patch()));
    closeDialog();
    complete(cur);
  };

  return (
    <Dialog
      eyebrow={`${taskWho(s, task)} · ${taskWhat(s, task)}`}
      title={task.title}
      onSubmit={save}
      destructive={
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            apply(deleteTask(s, task), { toast: `Deleted · ${task.title}`, undo: true });
            closeDialog();
          }}
        >
          Delete
        </button>
      }
      actions={
        <>
          {task.tripId && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                closeDialog();
                navigate(`/trips/${task.tripId}`);
              }}
            >
              Open trip
            </button>
          )}
          {task.docTask && !task.done && a && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => openDialog(<DocFormFor kind={task.docTask!.docKind} subjectType={a.subjectType} subjectId={a.subjectId} assignmentId={a.id} docType={task.docTask!.docType} closeTaskId={task.id} />)}
            >
              Add document
            </button>
          )}
          <button type="submit" className="btn secondary">
            Save
          </button>
          <button type="button" className="btn primary" onClick={primary}>
            {primaryLabel(s, task)}
          </button>
        </>
      }
    >
      {task.appointment && (
        <div className="callout">
          <div>
            <strong>Appointment</strong> · {appointmentNote(s, task) || 'No time set'}
          </div>
          {task.appointment.prep && <div className="muted">Prep: {task.appointment.prep}</div>}
        </div>
      )}
      {adhoc && (
        <>
          <Field label="Title">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} required />}</Field>
          <Field label="For">{(id) => <ForSelect id={id} value={forV} onChange={setForV} />}</Field>
        </>
      )}
      {r && <p className="muted small">Step of the routine “{r.title}”.</p>}
      <Field label="Due date" optional={!task.date}>
        {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      {!task.done && !task.appointment && (
        <div className="snooze">
          <span className="muted">Snooze</span>
          <button type="button" className="btn secondary small" onClick={() => snooze(1)}>
            1 day
          </button>
          <button type="button" className="btn secondary small" onClick={() => snooze(7)}>
            1 week
          </button>
        </div>
      )}
      <Field label="Notes" optional>{(id) => <textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
    </Dialog>
  );
}

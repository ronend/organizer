import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ISODate, Task } from '../types/coo';

/** One row of the subtask editor; `id` is the subtask task's id (new rows get one up front). */
export interface SubtaskDraft {
  id: string;
  title: string;
  done: boolean;
  date: ISODate | null;
}
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Dialog, Field, FormActions, IconButton } from '../components/ui';
import { addDays, dueLabel, fmtDate, today } from '../lib/dates';
import {
  allSubjects,
  appointmentNote,
  assignmentById,
  assignmentIdOf,
  assignmentsFor,
  findSubject,
  isAdHoc,
  routineOf,
  subjectLabel,
  subtasksOf,
  taskWhat,
  taskWho,
} from '../lib/model';
import { addTask, deleteTask, newId, saveSubtasks, updateTask } from '../lib/ops';
import { DocFormFor } from './DocDialogs';
import { RichNotesLazy as RichNotes } from '../components/RichNotesLazy';


function ForSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const { s } = useStore();
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">General, no one in particular</option>
      {allSubjects(s).map((x) => (
        <option key={x.id} value={x.id}>
          {subjectLabel(x)}
        </option>
      ))}
    </select>
  );
}

/**
 * Checklist editor. `commit` is false while a title is being typed (the
 * caller may defer saving) and true for toggles, adds, removals and blur.
 */
export function SubtaskList({
  items,
  onChange,
}: {
  items: SubtaskDraft[];
  onChange: (next: SubtaskDraft[], commit: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const add = () => {
    const title = draft.trim();
    if (!title) return;
    onChange([...items, { id: newId('t'), title, done: false, date: draftDate || null }], true);
    setDraft('');
    setDraftDate('');
  };
  const done = items.filter((x) => x.done).length;
  return (
    <div className="field subtasks">
      <div className="subtasks-head">
        <span className="label">Sub-tasks</span>
        {items.length > 0 && (
          <span className="muted small">
            {done} of {items.length} done
          </span>
        )}
      </div>
      {items.length > 0 && (
        <ul className="subtask-list">
          {items.map((x, i) => (
            <li key={x.id} className={`subtask ${x.done ? 'done' : ''}`}>
              <input
                type="checkbox"
                checked={x.done}
                aria-label={`${x.done ? 'Reopen' : 'Complete'} sub-task ${x.title}`}
                onChange={() => onChange(items.map((y, j) => (j === i ? { ...y, done: !y.done } : y)), true)}
              />
              <input
                className="subtask-title"
                aria-label="Sub-task title"
                value={x.title}
                onChange={(e) => onChange(items.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)), false)}
                onBlur={() => onChange(items.filter((y) => y.title.trim()), true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <input
                type="date"
                className={`subtask-date ${!x.done && x.date && x.date < today() ? 'overdue' : ''}`}
                aria-label={`Due date for sub-task ${x.title} (optional)`}
                title={x.date ? dueLabel(x.date).text : 'No due date'}
                value={x.date ?? ''}
                onChange={(e) => onChange(items.map((y, j) => (j === i ? { ...y, date: e.target.value || null } : y)), true)}
              />
              <IconButton icon="close" size={16} label={`Remove sub-task ${x.title}`} onClick={() => onChange(items.filter((_, j) => j !== i), true)} />
            </li>
          ))}
        </ul>
      )}
      <div className="inline-add subtask-add">
        <input
          aria-label="New sub-task"
          placeholder="Add a sub-task"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <input
          type="date"
          className="subtask-date"
          aria-label="Due date for the new sub-task (optional)"
          value={draftDate}
          onChange={(e) => setDraftDate(e.target.value)}
        />
        <button type="button" className="btn secondary small" onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </div>
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
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>([]);
  const sub = findSubject(s, forV || null);
  const assignments = sub ? assignmentsFor(s, sub.id) : [];

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
        subjectId: sub?.id ?? null,
        assignmentId: routine || null,
        notes: notes.trim(),
        subtasks: subtasks.filter((x) => x.title.trim()).map((x) => ({ title: x.title.trim(), date: x.date })),
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
          <select id={id} value={routine} onChange={(e) => setRoutine(e.target.value)} disabled={!sub}>
            {!sub ? (
              <option value="">Choose who it’s for first</option>
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
      <SubtaskList items={subtasks} onChange={(next) => setSubtasks(next)} />
      <Field label="Notes" optional>{(id) => <RichNotes id={id} label="Notes" value={notes} onChange={setNotes} />}</Field>
    </Dialog>
  );
}

export function TaskDetailDialog({ taskId }: { taskId: string }) {
  const { s, apply } = useStore();
  const { closeDialog, openDialog } = useUI();
  const navigate = useNavigate();
  const task = s.tasks.find((t) => t.id === taskId);
  const [title, setTitle] = useState(task?.title ?? '');
  const [date, setDate] = useState(task?.date ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [forV, setForV] = useState(task?.subjectId ?? '');
  const toDrafts = (list: Task[]): SubtaskDraft[] => list.map((t) => ({ id: t.id, title: t.title, done: t.done, date: t.date }));
  const [subtasks, setSubtasks] = useState<SubtaskDraft[]>(task ? toDrafts(subtasksOf(s, task.id)) : []);
  if (!task) return null;
  const adhoc = isAdHoc(task);
  const a = assignmentById(s, assignmentIdOf(task));
  const r = routineOf(s, a);
  const owner = findSubject(s, task.subjectId);
  const trip = owner?.subjectType === 'trip' ? owner : null;

  const patch = (): Partial<Task> => {
    const p: Partial<Task> = { date: date || null, notes: notes.trim() };
    if (adhoc && !task.parentId) {
      p.title = title.trim() || task.title;
      p.subjectId = forV || null;
    }
    return p;
  };

  const save = () => {
    // One change set: the task (moving its subtasks with it) and the edited subtask list.
    const p = patch();
    const cs = updateTask(s, task, p);
    const sub = saveSubtasks(s, { ...task, ...p } as Task, subtasks.filter((x) => x.title.trim()));
    // A subtask both moved and edited: the list's version (which has the new subject) wins.
    const put = [...cs.put.filter((c) => !sub.put.some((x) => x.id === c.id)), ...sub.put];
    apply({ put, delete: sub.delete }, { toast: 'Saved' });
    closeDialog();
  };

  const snooze = (days: number) => {
    const base = task.date && task.date > today() ? task.date : today();
    const d = addDays(base, days);
    setDate(d);
    apply(updateTask(s, task, { date: d }), { toast: `Snoozed to ${fmtDate(d, true)}`, undo: true });
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
          {trip && (
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                closeDialog();
                navigate(`/trips/${trip.id}`);
              }}
            >
              Open trip
            </button>
          )}
          {task.requestsDocument && !task.done && a && (
            <button
              type="button"
              className="btn secondary"
              onClick={() =>
                openDialog(
                  <DocFormFor
                    category={task.requestsDocument!.category}
                    subjectId={a.subjectId}
                    assignmentId={a.id}
                    docType={task.requestsDocument!.type}
                    closeTaskId={task.id}
                  />,
                )
              }
            >
              Add document
            </button>
          )}
          <button type="submit" className="btn primary">
            Save
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
      {adhoc && !task.parentId && (
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
      {task.parentId ? (
        <p className="muted small">Sub-task of “{s.tasks.find((t) => t.id === task.parentId)?.title ?? 'a task'}”.</p>
      ) : (
        <SubtaskList
          items={subtasks}
          onChange={(next, commit) => {
            setSubtasks(next);
            // Toggles, adds and removals save right away; typing waits for blur.
            const clean = next.filter((x) => x.title.trim());
            if (commit && JSON.stringify(clean) !== JSON.stringify(toDrafts(subtasksOf(s, task.id)))) {
              apply(saveSubtasks(s, task, clean));
            }
          }}
        />
      )}
      <Field label="Notes" optional>{(id) => <RichNotes id={id} label="Notes" value={notes} onChange={setNotes} />}</Field>
    </Dialog>
  );
}

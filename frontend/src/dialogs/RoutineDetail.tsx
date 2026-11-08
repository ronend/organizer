import { useState } from 'react';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Dialog, Field, SectionHead, StatusText } from '../components/ui';
import { TaskCheck } from '../components/TaskRow';
import { dueLabel, fmtDate } from '../lib/dates';
import {
  assignmentById,
  assignmentStatus,
  assignmentsOf,
  byDate,
  contactsFor,
  docsOfAssignment,
  routineOf,
  scheduleLine,
  stepsOf,
  subjectName,
} from '../lib/model';
import { REPEAT_OPTIONS } from '../lib/templates';
import { addStep, setAssignmentDate, updateAssignment } from '../lib/ops';
import { EditRoutineDialog } from './RoutineForm';
import { RefillDialog } from './TaskFlows';
import { TaskDetailDialog } from './TaskDialogs';
import { DocFormFor, openDocViewer } from './DocDialogs';

export function RoutineDetailDialog({ assignmentId }: { assignmentId: string }) {
  const { s, apply } = useStore();
  const ui = useUI();
  const a = assignmentById(s, assignmentId);
  const r = routineOf(s, a);
  const [stepTitle, setStepTitle] = useState('');
  const [stepDate, setStepDate] = useState('');
  if (!a || !r) return null;

  const status = assignmentStatus(s, a);
  const others = assignmentsOf(s, r).filter((x) => x.id !== a.id);
  const steps = stepsOf(s, a).sort((x, y) => (x.done === y.done ? byDate(x, y) : x.done ? 1 : -1));
  const docs = docsOfAssignment(s, a);
  const contacts = contactsFor(s, r.area === 'car' ? 'car' : r.area === 'health' ? 'health' : 'any');
  const docKind = r.area === 'car' ? 'car' : r.area;

  const onDate = (v: string) => {
    const next = v || null;
    if (next === a.date) return;
    apply(setAssignmentDate(s, a, next), {
      toast: !a.date && next ? 'Date set. Steps planned' : next ? 'Date changed. Open steps moved' : 'Date cleared',
      undo: true,
    });
  };

  return (
    <Dialog
      eyebrow={`${subjectName(s, a.subjectType, a.subjectId)} · Routine`}
      title={r.title}
      wide
    >
      {r.description && <p className="muted">{r.description}</p>}
      <div className="detail-status">
        <StatusText tone={status.tone} text={status.text} />
        <span className="muted small">{scheduleLine(s, a)}</span>
      </div>

      {r.medication && a.supply ? (
        <div className="callout">
          <div>
            Uses {a.supply.perDay} {a.supply.unit} per day · {a.supply.refillsLeft} {a.supply.refillsLeft === 1 ? 'refill' : 'refills'} left · order{' '}
            {a.supply.orderLeadDays} days ahead
          </div>
          <div className="muted small">coo tracks supply only and never suggests doses.</div>
          <button type="button" className="btn secondary small" onClick={() => ui.openDialog(<RefillDialog assignment={a} />)}>
            Log a refill
          </button>
        </div>
      ) : (
        <div className="fields">
          <Field label={r.dateLabel} optional>
            {(id) => <input id={id} type="date" defaultValue={a.date ?? ''} key={a.date ?? 'none'} onChange={(e) => onDate(e.target.value)} />}
          </Field>
          <Field label="Repeats" hint="Applies at the next renewal.">
            {(id) => (
              <select
                id={id}
                value={a.repeatMonths ?? ''}
                onChange={(e) => apply(updateAssignment(s, a, { repeatMonths: e.target.value ? Number(e.target.value) : null }), { toast: 'Saved' })}
              >
                {REPEAT_OPTIONS.map((o) => (
                  <option key={String(o.value)} value={o.value ?? ''}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      )}
      <Field label="Preferred contact" optional>
        {(id) => (
          <select id={id} value={a.contactId ?? ''} onChange={(e) => apply(updateAssignment(s, a, { contactId: e.target.value || null }), { toast: 'Saved' })}>
            <option value="">None</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.role ? ` · ${c.role}` : ''}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="detail-links">
        <button type="button" className="btn ghost small" onClick={() => ui.openDialog(<EditRoutineDialog routine={r} />)}>
          Edit title, description, assignment
        </button>
        {others.length > 0 && (
          <span className="muted small also">
            Also assigned to{' '}
            {others.map((o, i) => (
              <span key={o.id}>
                {i > 0 && ', '}
                <button type="button" className="link" onClick={() => ui.openDialog(<RoutineDetailDialog assignmentId={o.id} />)}>
                  {subjectName(s, o.subjectType, o.subjectId)}
                </button>
              </span>
            ))}
          </span>
        )}
      </div>

      <section className="section tight">
        <SectionHead title="Steps" count={steps.filter((t) => !t.done).length} />
        {steps.length === 0 ? (
          <div className="empty">No steps yet{a.date ? '' : '. Set a date and coo plans them, or add one below'}.</div>
        ) : (
          <ul className="list">
            {steps.map((t) => {
              const due = dueLabel(t.date);
              return (
                <li key={t.id} className={`row ${t.done ? 'done' : ''}`}>
                  <TaskCheck task={t} />
                  <button type="button" className="row-main row-body" onClick={() => ui.openDialog(<TaskDetailDialog taskId={t.id} />)}>
                    <span className="row-title">{t.title}</span>
                    {t.appointment && <span className="row-meta">Appointment</span>}
                  </button>
                  <span className={`row-right ${due.overdue && !t.done ? 'overdue' : ''}`}>
                    {t.done ? `Done ${t.doneAt ? fmtDate(t.doneAt.slice(0, 10), true) : ''}` : due.text}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <form
          className="inline-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!stepTitle.trim()) return;
            apply(addStep(s, a, stepTitle.trim(), stepDate || null), { toast: 'Step added' });
            setStepTitle('');
            setStepDate('');
          }}
        >
          <input aria-label="New step" placeholder="Add a step" value={stepTitle} onChange={(e) => setStepTitle(e.target.value)} />
          <input aria-label="Step date" type="date" value={stepDate} onChange={(e) => setStepDate(e.target.value)} />
          <button type="submit" className="btn secondary small">
            Add
          </button>
        </form>
      </section>

      <section className="section tight">
        <SectionHead
          title="Documents"
          count={docs.length}
          action={
            <button
              type="button"
              className="link"
              onClick={() => ui.openDialog(<DocFormFor kind={docKind} subjectType={a.subjectType} subjectId={a.subjectId} assignmentId={a.id} />)}
            >
              Add
            </button>
          }
        />
        {docs.length === 0 ? (
          <div className="empty">No documents linked yet.</div>
        ) : (
          <ul className="list">
            {docs.map((d) => (
              <li key={d.id}>
                <button type="button" className="row row-button" onClick={() => openDocViewer(ui, s, d)}>
                  <span className="row-main">
                    <span className="row-title">{d.name}</span>
                    <span className="row-meta">{d.type}</span>
                  </span>
                  <span className="row-right">Show</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {a.history.length > 0 && (
        <section className="section tight">
          <SectionHead title="History" count={a.history.length} />
          <ul className="list">
            {a.history.map((h, i) => (
              <li key={i} className="row">
                <span className="row-main">
                  <span className="row-title">{h.text}</span>
                </span>
                <span className="row-right">{fmtDate(h.date)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Dialog>
  );
}

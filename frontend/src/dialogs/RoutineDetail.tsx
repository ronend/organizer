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
  effectivePlan,
  isMedication,
  routineOf,
  samePlan,
  scheduleLine,
  stepsOf,
  subjectName,
} from '../lib/model';
import { addStep, updateAssignment, updateSchedule } from '../lib/ops';
import { EditRoutineDialog, RepeatSelect } from './RoutineForm';
import { StepPlanEditor, cleanPlan } from './StepPlanEditor';
import { RefillDialog } from './TaskFlows';
import { TaskDetailDialog } from './TaskDialogs';
import { DocFormFor } from './DocDialogs';
import { CATEGORIES, CATEGORY_KEYS } from '../lib/registry';
import { DocRow } from '../components/SubjectParts';

const KIND_WORD: Record<string, string> = { plain: 'reminder', schedule: 'book', renew: 'renew', pickup: 'pick up' };

/**
 * This assignee's schedule: its own date, repeat, counting rule and steps.
 * Starts from the routine's defaults; anything changed here applies only to
 * this person or car.
 */
function ScheduleSection({ assignmentId }: { assignmentId: string }) {
  const { s, apply } = useStore();
  const a = assignmentById(s, assignmentId)!;
  const r = routineOf(s, a)!;
  const name = subjectName(s, a.subjectId);
  const [date, setDate] = useState(a.date ?? '');
  const [repeat, setRepeat] = useState<number | null>(a.repeatMonths);
  const [countFrom, setCountFrom] = useState<'' | 'done' | 'due'>(a.countFrom ?? '');
  const [plan, setPlan] = useState(effectivePlan(r, a));
  const [editSteps, setEditSteps] = useState(false);

  const cleaned = cleanPlan(plan);
  const custom = !samePlan(cleaned, r.plan);
  const dirty =
    (date || null) !== a.date ||
    repeat !== a.repeatMonths ||
    (countFrom || null) !== (a.countFrom ?? null) ||
    !samePlan(cleaned, effectivePlan(r, a));

  const save = () => {
    const dateChanged = (date || null) !== a.date;
    apply(
      updateSchedule(s, a, {
        date: date || null,
        repeatMonths: repeat,
        countFrom: countFrom || null,
        plan: custom ? cleaned : null,
      }),
      {
        toast:
          !a.date && date ? 'Schedule saved. Steps planned' : dateChanged && date ? 'Schedule saved. Open steps moved' : 'Schedule saved',
        undo: true,
      },
    );
    setEditSteps(false);
  };

  const defaultCount = r.countFrom === 'done' ? 'the day it’s done' : 'the due date';

  return (
    <div className="schedule-box">
      <div className="schedule-head">
        <span className="label-like">Schedule for {name}</span>
        {(custom || a.countFrom) && <span className="muted small">Differs from the routine’s defaults</span>}
      </div>
      <div className="fields">
        <Field label={r.dateLabel} optional>
          {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Repeats">{(id) => <RepeatSelect id={id} value={repeat} onChange={setRepeat} />}</Field>
      </div>
      <Field label="Next one counted from">
        {(id) => (
          <select id={id} value={countFrom} onChange={(e) => setCountFrom(e.target.value as '' | 'done' | 'due')}>
            <option value="">Routine default ({defaultCount})</option>
            <option value="done">The day it’s done</option>
            <option value="due">The due date</option>
          </select>
        )}
      </Field>
      <div className="field">
        <div className="schedule-steps-head">
          <span className="label-like">Steps before each date</span>
          <span className="schedule-links">
            {custom && (
              <button type="button" className="link small" onClick={() => setPlan(r.plan)}>
                Use the routine’s defaults
              </button>
            )}
            {!editSteps && (
              <button type="button" className="link small" onClick={() => setEditSteps(true)}>
                Change steps
              </button>
            )}
          </span>
        </div>
        {editSteps ? (
          <StepPlanEditor plan={plan} onChange={setPlan} dateLabel={r.dateLabel} />
        ) : cleaned.length === 0 ? (
          <span className="muted small">No steps.</span>
        ) : (
          <ul className="plan-summary">
            {[...cleaned]
              .sort((x, y) => x.offsetDays - y.offsetDays)
              .map((p, i) => (
                <li key={i} className="small">
                  {p.title} <span className="muted">· {p.offsetDays === 0 ? 'on the day' : `${-p.offsetDays} days before`} · {KIND_WORD[p.kind]}</span>
                </li>
              ))}
          </ul>
        )}
        {!custom && <span className="muted small">Using the routine’s default steps.</span>}
        {custom && <span className="muted small">Custom steps for {name} only.</span>}
      </div>
      <div className="schedule-actions">
        <span />
        <button type="button" className="btn primary small" disabled={!dirty} onClick={save}>
          Save schedule
        </button>
      </div>
    </div>
  );
}

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
  // The document category that files into this routine's area (identity → identity, ...).
  const docKind = CATEGORY_KEYS.find((k) => CATEGORIES[k].area === r.area) ?? 'attachment';

  return (
    <Dialog
      eyebrow={`${subjectName(s, a.subjectId)} · Routine`}
      title={r.title}
      wide
    >
      {r.description && <p className="muted">{r.description}</p>}
      <div className="detail-status">
        <StatusText tone={status.tone} text={status.text} />
        <span className="muted small">{scheduleLine(s, a)}</span>
      </div>

      {isMedication(r) && a.supply ? (
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
        <ScheduleSection key={a.id} assignmentId={a.id} />
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
                  {subjectName(s, o.subjectId)}
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
              onClick={() => ui.openDialog(<DocFormFor category={docKind} subjectId={a.subjectId} assignmentId={a.id} />)}
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
              <DocRow key={d.id} d={d} actions={false} />
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

import { useState } from 'react';
import type { Area, Routine, StepPlan, SubjectType } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { useToast } from '../store/Toast';
import { Chips, Dialog, Field, Fieldset, FormActions } from '../components/ui';
import { Icon } from '../components/Icon';
import {
  AREA_ICON,
  AREA_LABEL,
  REPEAT_OPTIONS,
  blankPlan,
  defaultRemindDays,
  templateByKey,
  templatesFor,
} from '../lib/templates';
import { assignExisting, createRoutine, deleteRoutine, editRoutine } from '../lib/ops';
import {
  assignmentsOf,
  contactsFor,
  personSub,
  sortedCars,
  sortedPeople,
  subjectName,
} from '../lib/model';
import { today } from '../lib/dates';
import { RoutineDetailDialog } from './RoutineDetail';
import { StepPlanEditor, cleanPlan } from './StepPlanEditor';

type Sub = { type: SubjectType; id: string };
const key = (x: Sub) => `${x.type}:${x.id}`;

function eligible(area: Area): SubjectType {
  return area === 'car' ? 'car' : 'person';
}

function SubjectChecklist({
  type,
  selected,
  onToggle,
}: {
  type: SubjectType;
  selected: Set<string>;
  onToggle: (s: Sub) => void;
}) {
  const { s } = useStore();
  const list =
    type === 'person'
      ? sortedPeople(s).map((p) => ({ id: p.id, name: p.name, sub: personSub(p) }))
      : sortedCars(s).map((c) => ({ id: c.id, name: c.makeModel, sub: c.plate }));
  if (list.length === 0) return <div className="muted">No {type === 'person' ? 'people' : 'cars'} yet.</div>;
  return (
    <div className="checklist">
      {list.map((x) => (
        <label key={x.id} className="check-row">
          <input type="checkbox" checked={selected.has(`${type}:${x.id}`)} onChange={() => onToggle({ type, id: x.id })} />
          <span>{x.name}</span>
          <span className="muted">{x.sub}</span>
        </label>
      ))}
    </div>
  );
}

export function RepeatSelect({
  id,
  value,
  onChange,
  label,
}: {
  id?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  label?: string;
}) {
  return (
    <select id={id} aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {REPEAT_OPTIONS.map((o) => (
        <option key={String(o.value)} value={o.value ?? ''}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** One row per chosen person or car: its own due date and repeat. */
function AssigneeSchedules({
  keys,
  dateLabel,
  dates,
  repeats,
  defaultRepeat,
  onDate,
  onRepeat,
}: {
  keys: string[];
  dateLabel: string;
  dates: Record<string, string>;
  repeats: Record<string, number | null>;
  defaultRepeat: number | null;
  onDate: (k: string, v: string) => void;
  onRepeat: (k: string, v: number | null) => void;
}) {
  const { s } = useStore();
  if (keys.length === 0) return <p className="muted small">Choose who it’s for above, then set each one’s {dateLabel.toLowerCase()}.</p>;
  return (
    <div className="assignee-schedules">
      {keys.map((k) => {
        const [type, id] = k.split(':') as [SubjectType, string];
        const name = subjectName(s, type, id);
        return (
          <div key={k} className="assignee-row">
            <span className="assignee-name">{name}</span>
            <input type="date" aria-label={`${dateLabel} for ${name}`} value={dates[k] ?? ''} onChange={(e) => onDate(k, e.target.value)} />
            <RepeatSelect label={`Repeats for ${name}`} value={k in repeats ? repeats[k] : defaultRepeat} onChange={(v) => onRepeat(k, v)} />
          </div>
        );
      })}
      <p className="muted small">Leave a date empty to start that one without a schedule.</p>
    </div>
  );
}

export function RoutineFormDialog({ preselect, area: initialArea }: { preselect?: Sub; area?: Area }) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const toast = useToast();
  const [area, setArea] = useState<Area>(initialArea ?? (preselect?.type === 'car' ? 'car' : 'health'));
  const [tpl, setTpl] = useState<string>('blank');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set(preselect ? [key(preselect)] : []));
  const [hasDate, setHasDate] = useState(false);
  /** Per-assignee due date and repeat (repeat missing = follow the default). */
  const [dates, setDates] = useState<Record<string, string>>({});
  const [repeats, setRepeats] = useState<Record<string, number | null>>({});
  const [repeat, setRepeat] = useState<number | null>(null);
  const [remind, setRemind] = useState(String(defaultRemindDays(initialArea ?? 'health')));
  const [countFrom, setCountFrom] = useState<'done' | 'due'>('done');
  const [needsBooking, setNeedsBooking] = useState(false);
  const [contactId, setContactId] = useState('');
  // Medication
  const [onHand, setOnHand] = useState('30');
  const [perDay, setPerDay] = useState('1');
  const [unit, setUnit] = useState('tablets');
  const [perRefill, setPerRefill] = useState('30');
  const [refills, setRefills] = useState('0');
  const [lead, setLead] = useState('7');

  const template = tpl === 'blank' ? undefined : templateByKey(tpl);
  const medication = !!template?.medication;

  const chooseArea = (a: Area) => {
    setArea(a);
    setTpl('blank');
    setHasDate(false);
    setRemind(String(defaultRemindDays(a)));
    setCountFrom(a === 'health' ? 'done' : 'due');
    // Keep subjects of the matching kind.
    setSelected((cur) => new Set([...cur].filter((k) => k.startsWith(`${eligible(a)}:`))));
  };

  const chooseTemplate = (k: string) => {
    setTpl(k);
    const t = templateByKey(k);
    if (!t) {
      setHasDate(false);
      setRepeat(null);
      return;
    }
    setTitle(t.title);
    setDescription(t.description);
    setRepeat(t.repeatMonths);
    setCountFrom(t.countFrom);
    setHasDate(!t.medication);
  };

  const toggle = (x: Sub) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(key(x))) n.delete(key(x));
      else n.add(key(x));
      return n;
    });

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    const subjects = [...selected]
      .map((k) => {
        const [type, id] = k.split(':') as [SubjectType, string];
        const scheduled = !medication && hasDate;
        return {
          type,
          id,
          date: scheduled ? dates[k] || null : null,
          repeatMonths: scheduled ? (k in repeats ? repeats[k] : repeat) : null,
        };
      })
      .filter((x) => x.type === eligible(area));
    if (subjects.length === 0) {
      toast.show({ text: 'Choose at least one person or car' });
      return;
    }
    const remindDays = Math.max(0, Number(remind) || defaultRemindDays(area));
    const plan = template ? template.plan : blankPlan(area, t, remindDays, needsBooking);
    const { changes } = createRoutine(s, {
      area,
      template: template?.key ?? null,
      icon: template?.icon ?? AREA_ICON[area],
      title: t,
      description: description.trim(),
      dateLabel: template?.dateLabel ?? (area === 'identity' ? 'Expires' : 'Due'),
      plan,
      followUps: template?.followUps ?? [],
      repeatMonths: medication ? null : repeat,
      countFrom,
      medication,
      subjects,
      contactId: contactId || null,
      supply: medication
        ? {
            onHand: Number(onHand) || 0,
            asOf: today(),
            perDay: Number(perDay) || 1,
            unit: unit.trim() || 'units',
            perRefill: Number(perRefill) || 0,
            refillsLeft: Number(refills) || 0,
            orderLeadDays: Number(lead) || 7,
          }
        : null,
    });
    apply(changes, { toast: subjects.length > 1 ? `Routine added for ${subjects.length}` : 'Routine added' });
    closeDialog();
  };

  const contacts = contactsFor(s, area === 'car' ? 'car' : area === 'health' ? 'health' : 'any');

  return (
    <Dialog eyebrow="New routine" title="Create a routine" wide onSubmit={submit} actions={<FormActions submit="Create routine" />}>
      <p className="muted intro">
        Create it once and assign it to as many people or cars as you like. Each keeps its own date and status. A date is optional.
      </p>
      <Field label="Area">
        {() => (
          <Chips
            label="Area"
            value={area}
            onChange={chooseArea}
            options={(['health', 'identity', 'car'] as Area[]).map((a) => ({ value: a, label: AREA_LABEL[a], icon: AREA_ICON[a] }))}
          />
        )}
      </Field>
      <Field label="Start from">
        {() => (
          <Chips
            label="Start from"
            value={tpl}
            onChange={chooseTemplate}
            options={[{ value: 'blank', label: 'Blank' }, ...templatesFor(area).map((t) => ({ value: t.key, label: t.title, icon: t.icon }))]}
          />
        )}
      </Field>
      <Field label="Title">{(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} required />}</Field>
      <Field label="Description" optional>
        {(id) => <textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      <Fieldset legend="Assign to">
        <SubjectChecklist type={eligible(area)} selected={selected} onToggle={toggle} />
      </Fieldset>

      {medication ? (
        <Fieldset legend="Supply">
          <div className="fields">
            <Field label="On hand now">{(id) => <input id={id} type="number" min={0} step="any" value={onHand} onChange={(e) => setOnHand(e.target.value)} />}</Field>
            <Field label="Used per day">{(id) => <input id={id} type="number" min={0} step="any" value={perDay} onChange={(e) => setPerDay(e.target.value)} />}</Field>
          </div>
          <div className="fields">
            <Field label="Unit">{(id) => <input id={id} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="tablets" />}</Field>
            <Field label="Quantity per refill">{(id) => <input id={id} type="number" min={0} value={perRefill} onChange={(e) => setPerRefill(e.target.value)} />}</Field>
          </div>
          <div className="fields">
            <Field label="Refills left">{(id) => <input id={id} type="number" min={0} value={refills} onChange={(e) => setRefills(e.target.value)} />}</Field>
            <Field label="Order this many days ahead">{(id) => <input id={id} type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} />}</Field>
          </div>
          <p className="muted small">coo tracks supply only and never suggests doses. The run-out date is on hand divided by daily use.</p>
        </Fieldset>
      ) : (
        <Fieldset legend="Schedule">
          <label className="check-row">
            <input type="radio" name="sched" checked={!hasDate} onChange={() => setHasDate(false)} />
            <span>No schedule, just a title and a note</span>
          </label>
          <label className="check-row">
            <input type="radio" name="sched" checked={hasDate} onChange={() => setHasDate(true)} />
            <span>Has a due date</span>
          </label>
          {hasDate && (
            <div className="sched-details">
              <Field label="Repeats by default" hint="Each person or car can have its own date and repeat below.">
                {(id) => <RepeatSelect id={id} value={repeat} onChange={setRepeat} />}
              </Field>
              <AssigneeSchedules
                keys={[...selected].filter((k) => k.startsWith(`${eligible(area)}:`))}
                dateLabel={area === 'identity' ? 'Expiry date' : 'Due date'}
                dates={dates}
                repeats={repeats}
                defaultRepeat={repeat}
                onDate={(k, v) => setDates((cur) => ({ ...cur, [k]: v }))}
                onRepeat={(k, v) => setRepeats((cur) => ({ ...cur, [k]: v }))}
              />
              {template ? (
                <p className="muted small">{template.summary}</p>
              ) : (
                <>
                  <div className="fields">
                    <Field label="Remind me (days before)">
                      {(id) => <input id={id} type="number" min={0} value={remind} onChange={(e) => setRemind(e.target.value)} />}
                    </Field>
                    <Field label="Next one counted from">
                      {(id) => (
                        <select id={id} value={countFrom} onChange={(e) => setCountFrom(e.target.value as 'done' | 'due')}>
                          <option value="done">The day I do it</option>
                          <option value="due">The due date</option>
                        </select>
                      )}
                    </Field>
                  </div>
                  <label className="check-row">
                    <input type="checkbox" checked={needsBooking} onChange={(e) => setNeedsBooking(e.target.checked)} />
                    <span>I need to book an appointment first</span>
                  </label>
                </>
              )}
            </div>
          )}
        </Fieldset>
      )}

      <Field label="Preferred contact" optional>
        {(id) => (
          <select id={id} value={contactId} onChange={(e) => setContactId(e.target.value)}>
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
    </Dialog>
  );
}

export function EditRoutineDialog({ routine }: { routine: Routine }) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const [title, setTitle] = useState(routine.title);
  const [description, setDescription] = useState(routine.description);
  const [repeat, setRepeat] = useState<number | null>(routine.repeatMonths);
  const [countFrom, setCountFrom] = useState<'done' | 'due'>(routine.countFrom);
  const [plan, setPlan] = useState<StepPlan[]>(routine.plan);
  const current = assignmentsOf(s, routine);
  const [selected, setSelected] = useState<Set<string>>(new Set(current.map((a) => `${a.subjectType}:${a.subjectId}`)));
  const removed = current.filter((a) => !selected.has(`${a.subjectType}:${a.subjectId}`));
  const inheriting = current.filter((a) => a.plan == null).length;
  const own = current.length - inheriting;

  const toggle = (x: Sub) =>
    setSelected((cur) => {
      const n = new Set(cur);
      if (n.has(key(x))) n.delete(key(x));
      else n.add(key(x));
      return n;
    });

  const submit = () => {
    if (!title.trim()) return;
    const subjects = [...selected].map((k) => {
      const [type, id] = k.split(':') as [SubjectType, string];
      return { type, id };
    });
    apply(
      editRoutine(s, routine, {
        title: title.trim(),
        description: description.trim(),
        subjects,
        defaults: routine.medication ? undefined : { repeatMonths: repeat, countFrom, plan: cleanPlan(plan) },
      }),
      {
        toast: subjects.length === 0 ? 'Routine removed' : 'Routine saved',
        undo: true,
      },
    );
    closeDialog();
  };

  return (
    <Dialog
      eyebrow={`${AREA_LABEL[routine.area]} · Routine template`}
      title="Edit routine"
      wide
      onSubmit={submit}
      destructive={
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            apply(deleteRoutine(s, routine), { toast: 'Routine deleted', undo: true });
            closeDialog();
          }}
        >
          Delete routine
        </button>
      }
      actions={<FormActions submit="Save" />}
    >
      <Field label="Title" hint="Renaming renames it for everyone.">
        {(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} required />}
      </Field>
      <Field label="Description" optional>
        {(id) => <textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />}
      </Field>
      {!routine.medication && (
        <Fieldset legend="Defaults">
          <p className="muted small">
            The starting point for everyone this routine is assigned to. Each person or car can override these in its own
            schedule.
          </p>
          <div className="fields">
            <Field label="Repeats" hint="Used for new assignments.">
              {(id) => <RepeatSelect id={id} value={repeat} onChange={setRepeat} />}
            </Field>
            <Field label="Next one counted from">
              {(id) => (
                <select id={id} value={countFrom} onChange={(e) => setCountFrom(e.target.value as 'done' | 'due')}>
                  <option value="done">The day it’s done</option>
                  <option value="due">The due date</option>
                </select>
              )}
            </Field>
          </div>
          <div className="field">
            <span className="label-like">Default steps before each {routine.dateLabel.toLowerCase()} date</span>
            <StepPlanEditor plan={plan} onChange={setPlan} dateLabel={routine.dateLabel} />
          </div>
          {current.length > 0 && (
            <p className="muted small">
              {inheriting > 0 && `Changing the steps re-plans the open steps of ${inheriting === 1 ? 'the one assignee' : `the ${inheriting} assignees`} using the defaults.`}
              {own > 0 && ` ${own === 1 ? 'One assignee has' : `${own} assignees have`} their own steps and won’t change.`}
            </p>
          )}
        </Fieldset>
      )}
      <Fieldset legend="Assigned to">
        <SubjectChecklist type={eligible(routine.area)} selected={selected} onToggle={toggle} />
        <p className="muted small">
          Newly assigned people or cars start with no date; set it in their schedule. Unchecking someone removes this routine and its steps from them and unlinks their documents.
        </p>
        {removed.length > 0 && (
          <p className="small tone-warn">
            Will remove it from {removed.length === 1 ? 'one assignee' : `${removed.length} assignees`}.
          </p>
        )}
      </Fieldset>
    </Dialog>
  );
}

/**
 * "Assign an existing routine": pick a routine of the area not yet assigned to
 * the subject, then give this subject its own date and repeat.
 */
export function AssignExistingDialog({ subject, area }: { subject: Sub; area: Area }) {
  const { s, apply } = useStore();
  const { openDialog } = useUI();
  const [picked, setPicked] = useState<Routine | null>(null);
  const [date, setDate] = useState('');
  const [repeat, setRepeat] = useState<number | null>(null);
  const list = s.routines.filter(
    (r) =>
      r.area === area &&
      !s.assignments.some((a) => a.routineId === r.id && a.subjectType === subject.type && a.subjectId === subject.id),
  );
  const name = subjectName(s, subject.type, subject.id);

  const assign = (r: Routine, opts: { date?: string | null; repeatMonths?: number | null } = {}) => {
    const { changes, assignment } = assignExisting(s, r, subject.type, subject.id, opts);
    apply(changes, { toast: `Assigned ${r.title} to ${name}` });
    openDialog(<RoutineDetailDialog assignmentId={assignment.id} />);
  };

  if (picked) {
    return (
      <Dialog
        eyebrow={`${name} · ${picked.title}`}
        title={`Schedule for ${name}`}
        onSubmit={() => assign(picked, { date: date || null, repeatMonths: repeat })}
        actions={
          <>
            <button type="button" className="btn ghost" onClick={() => setPicked(null)}>
              Back
            </button>
            <button type="submit" className="btn primary">
              Assign
            </button>
          </>
        }
      >
        <p className="muted">
          {name} gets the routine’s default steps. You can change them, and how the next date is counted, in {name}’s schedule
          afterwards.
        </p>
        <div className="fields">
          <Field label={picked.dateLabel} optional hint="Leave empty to start without a schedule.">
            {(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
          <Field label="Repeats">{(id) => <RepeatSelect id={id} value={repeat} onChange={setRepeat} />}</Field>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog eyebrow={`${AREA_LABEL[area]} · Routines`} title="Assign an existing routine">
      {list.length === 0 ? (
        <div className="empty">Every {AREA_LABEL[area].toLowerCase()} routine is already assigned here.</div>
      ) : (
        <ul className="list">
          {list.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="row row-button"
                onClick={() => {
                  if (r.medication) {
                    assign(r);
                    return;
                  }
                  setRepeat(r.repeatMonths);
                  setDate('');
                  setPicked(r);
                }}
              >
                <Icon name={r.icon} />
                <span className="row-main">
                  <span className="row-title">{r.title}</span>
                  {r.description && <span className="row-meta">{r.description}</span>}
                </span>
                <Icon name="chevron" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

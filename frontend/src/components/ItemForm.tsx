import { useState, type ReactNode } from 'react';
import type {
  Entity,
  EntityType,
  NewEntity,
  ContactDetails,
  RecurrenceRule,
  ReminderTime,
  ReservationSubtype,
  Reservation,
  EventEntity,
  Story,
  Todo,
  Appointment,
  Habit,
  Routine,
} from '../types/organizer';
import { ENTITY_META, RESERVATION_SUBTYPES, WEEKDAYS, entityDate } from '../types/organizer';
import { defaultRecurrence, describeOffset, type RecurrenceFreq } from '../lib/recurrence';
import { formatDate } from '../lib/dates';
import DateTimeField from './DateTimeField';
import Icon, { TYPE_ICON } from './Icon';

// ── Shared shell ─────────────────────────────────────────────────────────────

interface ShellProps {
  type: EntityType;
  editing: boolean;
  title: string;
  onTitle: (v: string) => void;
  onSubmit: () => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
  children: ReactNode;
}

function FormShell({ type, editing, title, onTitle, onSubmit, onDelete, onClose, children }: ShellProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = ENTITY_META[type];

  async function handle(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="detail" onSubmit={handle}>
      <div className="detail-header">
        <h2 className="display">
          <span className="type-emoji">
            <Icon name={TYPE_ICON[type]} size={18} />
          </span>{' '}
          {editing ? `Edit ${meta.label}` : `New ${meta.label}`}
        </h2>
        <button type="button" className="btn btn-ghost ripple with-icon" onClick={onClose}>
          <Icon name="x" size={14} /> Close
        </button>
      </div>

      <div className="field">
        <input
          className="title-input"
          type="text"
          value={title}
          autoFocus
          placeholder="Title"
          onChange={(e) => onTitle(e.target.value)}
        />
      </div>

      {children}

      {error && <p className="error">{error}</p>}

      <div className="detail-actions sticky">
        <button type="submit" className="btn btn-primary ripple" disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save changes' : `Add ${meta.label}`}
        </button>
        {editing && onDelete && (
          <button type="button" className="btn btn-danger ripple" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function requireDate(iso: string, label: string): string {
  if (!iso) throw new Error(`${label} is required`);
  return iso;
}

// ── Small reusable editors ───────────────────────────────────────────────────

function StringListEditor({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v) onChange([...value, v]);
    setDraft('');
  };
  return (
    <div className="tag-editor">
      <div className="tag-chips">
        {value.map((v, i) => (
          <span key={`${v}-${i}`} className="badge tag">
            {v}
            <button type="button" className="chip-x" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <Icon name="x" size={10} />
            </button>
          </span>
        ))}
      </div>
      <input
        value={draft}
        placeholder={placeholder ?? 'Add…'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

function ContactFields({ value, onChange }: { value: ContactDetails; onChange: (v: ContactDetails) => void }) {
  const set = (k: keyof ContactDetails) => (e: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [k]: e.target.value || undefined });
  return (
    <div className="field-row compact">
      <Field label="Contact name">
        <input value={value.name ?? ''} onChange={set('name')} />
      </Field>
      <Field label="Phone">
        <input value={value.phone ?? ''} onChange={set('phone')} />
      </Field>
      <Field label="Email">
        <input value={value.email ?? ''} onChange={set('email')} />
      </Field>
    </div>
  );
}

function RecurrenceEditor({ value, onChange }: { value: RecurrenceRule; onChange: (v: RecurrenceRule) => void }) {
  return (
    <div className="field-row compact">
      <Field label="Repeats">
        <select value={value.freq} onChange={(e) => onChange(defaultRecurrence(e.target.value as RecurrenceFreq))}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="every_n_days">Every N days</option>
          <option value="monthly">Monthly</option>
        </select>
      </Field>

      {(value.freq === 'daily' || value.freq === 'weekly' || value.freq === 'monthly') && (
        <Field label="Interval">
          <input
            type="number"
            min={1}
            value={value.interval ?? 1}
            onChange={(e) => onChange({ ...value, interval: Math.max(1, Number(e.target.value) || 1) })}
          />
        </Field>
      )}

      {value.freq === 'every_n_days' && (
        <Field label="Every N days">
          <input
            type="number"
            min={1}
            value={value.n}
            onChange={(e) => onChange({ freq: 'every_n_days', n: Math.max(1, Number(e.target.value) || 1) })}
          />
        </Field>
      )}

      {value.freq === 'monthly' && (
        <Field label="Day of month">
          <input
            type="number"
            min={1}
            max={31}
            value={value.day_of_month}
            onChange={(e) =>
              onChange({ ...value, day_of_month: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })
            }
          />
        </Field>
      )}

      {value.freq === 'weekly' && (
        <div className="field">
          <span>On days</span>
          <div className="tag-chips">
            {WEEKDAYS.map((d) => {
              const on = value.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={on ? 'badge tag active' : 'badge tag'}
                  onClick={() =>
                    onChange({ ...value, days: on ? value.days.filter((x) => x !== d) : [...value.days, d] })
                  }
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function RoutineRemindersEditor({ value, onChange }: { value: ReminderTime[]; onChange: (v: ReminderTime[]) => void }) {
  const update = (i: number, next: ReminderTime) => onChange(value.map((r, j) => (j === i ? next : r)));
  return (
    <div className="section-body">
      {value.map((r, i) => (
        <div key={i} className="field-row compact">
          <Field label="When">
            <select
              value={r.kind}
              onChange={(e) =>
                update(i, e.target.value === 'absolute' ? { kind: 'absolute', at: '' } : { kind: 'offset', offset: '-1h' })
              }
            >
              <option value="offset">Before due (offset)</option>
              <option value="absolute">Specific time</option>
            </select>
          </Field>
          {r.kind === 'offset' ? (
            <Field label={`Offset — ${describeOffset(r.offset) || '…'}`}>
              <input
                value={r.offset}
                placeholder="-2h, -1d, -30m"
                onChange={(e) => update(i, { kind: 'offset', offset: e.target.value })}
              />
            </Field>
          ) : (
            <Field label="At">
              <DateTimeField value={r.at || null} onChange={(v) => update(i, { kind: 'absolute', at: v ?? '' })} />
            </Field>
          )}
          <button type="button" className="btn btn-ghost with-icon" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Icon name="x" size={12} /> Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost with-icon" onClick={() => onChange([...value, { kind: 'offset', offset: '-1h' }])}>
        <Icon name="plus" size={12} /> Add reminder
      </button>
    </div>
  );
}

function StoryRefEditor({ value, onChange, allItems }: { value: string[]; onChange: (v: string[]) => void; allItems: Entity[] }) {
  const candidates = allItems.filter((e) => e.type === 'reservation' || e.type === 'event');
  const byId = new Map(candidates.map((e) => [e.id, e]));
  const available = candidates.filter((e) => !value.includes(e.id)).sort((a, b) => a.title.localeCompare(b.title));

  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="section-body">
      <ol className="item-list">
        {value.map((id, i) => {
          const e = byId.get(id);
          return (
            <li key={id} className="item-row">
              <span className="entry-icon">
                <Icon name={e ? TYPE_ICON[e.type] : 'x'} size={14} />
              </span>
              <div className="item-main">
                <span className="item-title">{e ? e.title : `(missing ${id})`}</span>
                <span className="item-meta">
                  {e && <span className="badge tag">{e.type}</span>}
                  {e && <span className="item-due">{formatDate(entityDate(e))}</span>}
                </span>
              </div>
              <button type="button" className="btn btn-ghost with-icon" onClick={() => move(i, -1)} aria-label="Move up">
                <Icon name="arrow-up" size={12} />
              </button>
              <button type="button" className="btn btn-ghost with-icon" onClick={() => move(i, 1)} aria-label="Move down">
                <Icon name="arrow-down" size={12} />
              </button>
              <button type="button" className="btn btn-ghost with-icon" onClick={() => onChange(value.filter((x) => x !== id))} aria-label="Remove">
                <Icon name="x" size={12} />
              </button>
            </li>
          );
        })}
        {value.length === 0 && <p className="empty">No items yet — add reservations or events below.</p>}
      </ol>
      {available.length > 0 && (
        <Field label="Add reservation or event">
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onChange([...value, e.target.value]);
            }}
          >
            <option value="">Choose…</option>
            {available.map((e) => (
              <option key={e.id} value={e.id}>
                {e.type} — {e.title}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}

// ── Per-type forms ───────────────────────────────────────────────────────────

interface FormProps<T extends Entity> {
  item: T | null;
  allItems: Entity[];
  onSave: (data: NewEntity) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}

function TodoForm({ item, onSave, onDelete, onClose }: FormProps<Todo>) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [dueAt, setDueAt] = useState<string | null>(item?.due_at ?? null);
  const [completed, setCompleted] = useState(item?.completed ?? false);
  return (
    <FormShell
      type="todo"
      editing={!!item}
      title={title}
      onTitle={setTitle}
      onDelete={onDelete}
      onClose={onClose}
      onSubmit={() => onSave({ type: 'todo', title: title.trim(), due_at: requireDate(dueAt ?? '', 'Due date'), completed })}
    >
      <Field label="Due">
        <DateTimeField value={dueAt} onChange={setDueAt} ariaLabel="Due date and time" />
      </Field>
      <label className="switch-inline">
        <input type="checkbox" checked={completed} onChange={(e) => setCompleted(e.target.checked)} /> Completed
      </label>
    </FormShell>
  );
}

function AppointmentForm({ item, onSave, onDelete, onClose }: FormProps<Appointment>) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [dateTime, setDateTime] = useState<string | null>(item?.date_time ?? null);
  const [location, setLocation] = useState(item?.location ?? '');
  const [contact, setContact] = useState<ContactDetails>(item?.contact ?? {});
  const [bring, setBring] = useState<string[]>(item?.things_to_bring ?? []);
  const [completed, setCompleted] = useState(item?.completed ?? false);
  return (
    <FormShell
      type="appointment"
      editing={!!item}
      title={title}
      onTitle={setTitle}
      onDelete={onDelete}
      onClose={onClose}
      onSubmit={() =>
        onSave({
          type: 'appointment',
          title: title.trim(),
          date_time: requireDate(dateTime ?? '', 'Date & time'),
          location: location.trim() || null,
          contact,
          things_to_bring: bring,
          completed,
        })
      }
    >
      <Field label="When">
        <DateTimeField value={dateTime} onChange={setDateTime} ariaLabel="Appointment date and time" />
      </Field>
      <Field label="Location">
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <ContactFields value={contact} onChange={setContact} />
      <div className="field">
        <span>Things to bring</span>
        <StringListEditor value={bring} onChange={setBring} placeholder="Add an item…" />
      </div>
      <label className="switch-inline">
        <input type="checkbox" checked={completed} onChange={(e) => setCompleted(e.target.checked)} /> Completed
      </label>
    </FormShell>
  );
}

function HabitForm({ item, onSave, onDelete, onClose }: FormProps<Habit>) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [recurrence, setRecurrence] = useState<RecurrenceRule>(item?.recurrence ?? defaultRecurrence('daily'));
  return (
    <FormShell
      type="habit"
      editing={!!item}
      title={title}
      onTitle={setTitle}
      onDelete={onDelete}
      onClose={onClose}
      onSubmit={() =>
        onSave({ type: 'habit', title: title.trim(), recurrence, completion_log: item?.completion_log ?? {} })
      }
    >
      <RecurrenceEditor value={recurrence} onChange={setRecurrence} />
      <p className="muted">Habits recur indefinitely — mark occurrences done from the item once saved.</p>
    </FormShell>
  );
}

function RoutineForm({ item, onSave, onDelete, onClose }: FormProps<Routine>) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [dueAt, setDueAt] = useState<string | null>(item?.due_at ?? null);
  const [reminders, setReminders] = useState<ReminderTime[]>(item?.reminders ?? []);
  const [completed, setCompleted] = useState(item?.completed ?? false);
  return (
    <FormShell
      type="routine"
      editing={!!item}
      title={title}
      onTitle={setTitle}
      onDelete={onDelete}
      onClose={onClose}
      onSubmit={() =>
        onSave({
          type: 'routine',
          title: title.trim(),
          due_at: requireDate(dueAt ?? '', 'Due date'),
          reminders,
          completed,
        })
      }
    >
      <Field label="Due">
        <DateTimeField value={dueAt} onChange={setDueAt} ariaLabel="Routine due date and time" />
      </Field>
      <div className="field">
        <span>Scheduled reminders</span>
        <RoutineRemindersEditor value={reminders} onChange={setReminders} />
      </div>
      <label className="switch-inline">
        <input type="checkbox" checked={completed} onChange={(e) => setCompleted(e.target.checked)} /> Completed
      </label>
    </FormShell>
  );
}

function detailsToText(details: Reservation['details']): string {
  if (details == null) return '';
  return typeof details === 'string' ? details : JSON.stringify(details, null, 2);
}
function textToDetails(text: string): Reservation['details'] {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('{')) {
    try {
      return JSON.parse(t) as Record<string, unknown>;
    } catch {
      /* fall through to string */
    }
  }
  return t;
}

function ReservationForm({ item, onSave, onDelete, onClose }: FormProps<Reservation>) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [subtype, setSubtype] = useState<ReservationSubtype>(item?.subtype ?? 'hotel');
  const [dateTime, setDateTime] = useState<string | null>(item?.date_time ?? null);
  const [location, setLocation] = useState(item?.location ?? '');
  const [resNo, setResNo] = useState(item?.reservation_number ?? '');
  const [details, setDetails] = useState(detailsToText(item?.details ?? null));
  return (
    <FormShell
      type="reservation"
      editing={!!item}
      title={title}
      onTitle={setTitle}
      onDelete={onDelete}
      onClose={onClose}
      onSubmit={() =>
        onSave({
          type: 'reservation',
          title: title.trim(),
          subtype,
          date_time: requireDate(dateTime ?? '', 'Date & time'),
          location: location.trim() || null,
          details: textToDetails(details),
          reservation_number: resNo.trim() || null,
        })
      }
    >
      <div className="field-row compact">
        <Field label="Kind">
          <select value={subtype} onChange={(e) => setSubtype(e.target.value as ReservationSubtype)}>
            {RESERVATION_SUBTYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Confirmation #">
          <input value={resNo} onChange={(e) => setResNo(e.target.value)} />
        </Field>
      </div>
      <Field label="When">
        <DateTimeField value={dateTime} onChange={setDateTime} ariaLabel="Reservation date and time" />
      </Field>
      <Field label="Location">
        <input value={location} onChange={(e) => setLocation(e.target.value)} />
      </Field>
      <Field label="Details">
        <textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Free text, or JSON for structured details" />
      </Field>
    </FormShell>
  );
}

function EventEntityForm({ item, onSave, onDelete, onClose }: FormProps<EventEntity>) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [startAt, setStartAt] = useState<string | null>(item?.start_at ?? null);
  const [endAt, setEndAt] = useState<string | null>(item?.end_at ?? null);
  const [details, setDetails] = useState(item?.details ?? '');
  return (
    <FormShell
      type="event"
      editing={!!item}
      title={title}
      onTitle={setTitle}
      onDelete={onDelete}
      onClose={onClose}
      onSubmit={() => {
        const s = requireDate(startAt ?? '', 'Start');
        const e = requireDate(endAt ?? '', 'End');
        if (e < s) throw new Error('End must be at or after start');
        return onSave({ type: 'event', title: title.trim(), start_at: s, end_at: e, details: details.trim() || null });
      }}
    >
      <div className="field-row compact">
        <Field label="Start">
          <DateTimeField value={startAt} onChange={setStartAt} ariaLabel="Start date and time" />
        </Field>
        <Field label="End">
          <DateTimeField value={endAt} onChange={setEndAt} ariaLabel="End date and time" />
        </Field>
      </div>
      <Field label="Details">
        <textarea rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
      </Field>
    </FormShell>
  );
}

function StoryForm({ item, allItems, onSave, onDelete, onClose }: FormProps<Story>) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [refs, setRefs] = useState<string[]>(item?.item_refs ?? []);
  return (
    <FormShell
      type="story"
      editing={!!item}
      title={title}
      onTitle={setTitle}
      onDelete={onDelete}
      onClose={onClose}
      onSubmit={() => onSave({ type: 'story', title: title.trim(), item_refs: refs })}
    >
      <div className="field">
        <span>Timeline (reservations &amp; events, in order)</span>
        <StoryRefEditor value={refs} onChange={setRefs} allItems={allItems} />
      </div>
    </FormShell>
  );
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

interface ItemFormProps {
  item: Entity | null; // null → add mode
  addType: EntityType;
  allItems: Entity[];
  onSave: (data: NewEntity) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}

export default function ItemForm({ item, addType, allItems, onSave, onDelete, onClose }: ItemFormProps) {
  const type = item ? item.type : addType;
  const common = { allItems, onSave, onDelete, onClose };
  switch (type) {
    case 'todo':
      return <TodoForm item={item as Todo | null} {...common} />;
    case 'appointment':
      return <AppointmentForm item={item as Appointment | null} {...common} />;
    case 'habit':
      return <HabitForm item={item as Habit | null} {...common} />;
    case 'routine':
      return <RoutineForm item={item as Routine | null} {...common} />;
    case 'reservation':
      return <ReservationForm item={item as Reservation | null} {...common} />;
    case 'event':
      return <EventEntityForm item={item as EventEntity | null} {...common} />;
    case 'story':
      return <StoryForm item={item as Story | null} {...common} />;
  }
}

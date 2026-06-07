import { useState, type FormEvent } from 'react';
import type {
  NewOrganizer,
  Recurrence,
  RecurrenceFreq,
  Reminder,
  Tag,
} from '../types/organizer';
import { tomorrowStr } from '../lib/dates';
import {
  describeRecurrence,
  nextOccurrence,
  parseDue,
  reminderDue,
} from '../lib/recurrence';
import { suggestCadence, suggestReminder } from '../lib/smartDefaults';
import RichTextEditor from './RichTextEditor';
import TagEditor from './TagEditor';
import type { EntryFormProps } from './EntryDetail';

function fmt(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function RecurringForm({
  item,
  knownTags,
  defaultTags,
  onSave,
  onDelete,
  onClose,
}: EntryFormProps) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [tags, setTags] = useState<Tag[]>(item?.tags ?? defaultTags);
  const [dueDate, setDueDate] = useState(item?.dueDate || tomorrowStr());
  const [dueTime, setDueTime] = useState(item?.dueTime || '09:00');
  const [done, setDone] = useState(item?.done ?? false);

  const [freq, setFreq] = useState<RecurrenceFreq>(item?.recurrence?.freq ?? 'month');
  const [every, setEvery] = useState<number>(item?.recurrence?.interval ?? 1);
  const [monthDay, setMonthDay] = useState<number>(item?.recurrence?.monthDay ?? 0); // 0 = same day
  // Seed a sensible first reminder for brand-new entries.
  const [reminders, setReminders] = useState<Reminder[]>(
    item?.reminders ?? [suggestReminder('')],
  );

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // Track manual edits so smart defaults don't clobber user intent.
  const [recTouched, setRecTouched] = useState(!!item);
  const [remTouched, setRemTouched] = useState(!!item);
  const touch = () => setDirty(true);

  function buildRecurrence(): Recurrence {
    const r: Recurrence = { freq, interval: Math.max(1, Math.floor(every || 1)) };
    if (freq === 'month' && monthDay >= 1) r.monthDay = Math.min(31, monthDay);
    return r;
  }

  // On title blur, pre-fill cadence + reminder from heuristics (only fields the
  // user hasn't manually touched).
  function applySmartDefaults() {
    if (!title.trim()) return;
    if (!recTouched) {
      const cadence = suggestCadence(title);
      if (cadence) {
        setFreq(cadence.freq);
        setEvery(cadence.interval);
        setMonthDay(cadence.monthDay ?? 0);
      }
    }
    if (!remTouched) {
      setReminders([suggestReminder(title)]);
    }
  }

  function setReminder(i: number, patch: Partial<Reminder>) {
    touch();
    setRemTouched(true);
    setReminders((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function close() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setErr('Title is required');
      return;
    }
    setErr(null);
    setSaving(true);
    const data: NewOrganizer = {
      type: 'recurring',
      title: title.trim(),
      description,
      tags,
      dueDate,
      dueTime,
      done,
      recurrence: buildRecurrence(),
      reminders: reminders
        .filter((r) => r.label.trim())
        .map((r) => ({
          label: r.label.trim(),
          daysBefore: Math.max(0, Math.floor(r.daysBefore || 0)),
          note: r.note?.trim() || '',
        })),
    };
    try {
      await onSave(data);
      setDirty(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Upcoming: next 3 occurrences + each reminder's date.
  const upcoming = (() => {
    if (!dueDate) return [];
    const rec = buildRecurrence();
    const out: { date: Date; reminders: { label: string; date: Date }[] }[] = [];
    let occ = parseDue(dueDate, dueTime);
    for (let i = 0; i < 3; i++) {
      out.push({
        date: occ,
        reminders: reminders
          .filter((r) => r.label.trim())
          .map((r) => ({ label: r.label.trim(), date: reminderDue(occ, r) })),
      });
      occ = nextOccurrence(occ, rec, parseDue(dueDate, dueTime));
    }
    return out;
  })();

  const missingTitle = err && !title.trim();

  return (
    <form className="detail" onSubmit={handleSubmit}>
      <div className="detail-header">
        <h2 className="display">
          <span className="type-emoji">🔄</span> {item ? 'Edit Recurring' : 'New Recurring'}
        </h2>
        <button type="button" className="btn btn-ghost ripple" onClick={close}>
          ✕ Close
        </button>
      </div>

      <h3 className="section-title">What &amp; When</h3>

      <div className="field">
        <input
          className={'title-input' + (missingTitle ? ' invalid' : '')}
          type="text"
          value={title}
          autoFocus
          placeholder="What repeats?"
          onChange={(e) => {
            touch();
            setTitle(e.target.value);
          }}
          onBlur={applySmartDefaults}
        />
      </div>

      <div className="field-row compact">
        <label className="field">
          <span>Next due</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => {
              touch();
              setDueDate(e.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>Time</span>
          <input
            type="time"
            value={dueTime}
            onChange={(e) => {
              touch();
              setDueTime(e.target.value);
            }}
          />
        </label>
      </div>

      <div className="field">
        <span>Repeats</span>
        <div className="rec-row">
          <span className="muted">Every</span>
          <input
            className="rec-interval"
            type="number"
            min={1}
            value={every}
            onChange={(e) => {
              touch();
              setRecTouched(true);
              setEvery(Number(e.target.value));
            }}
          />
          <div className="seg">
            {(['day', 'week', 'month'] as RecurrenceFreq[]).map((f) => (
              <button
                key={f}
                type="button"
                className={'seg-btn ripple' + (freq === f ? ' active' : '')}
                onClick={() => {
                  touch();
                  setRecTouched(true);
                  setFreq(f);
                }}
              >
                {f}
                {every > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>

        {freq === 'month' && (
          <div className="rec-row">
            <span className="muted">On day</span>
            <input
              className="rec-interval"
              type="number"
              min={0}
              max={31}
              value={monthDay}
              placeholder="same"
              onChange={(e) => {
                touch();
                setRecTouched(true);
                setMonthDay(Number(e.target.value));
              }}
            />
            <span className="muted">(0 = same day each time)</span>
          </div>
        )}

        <p className="rec-hint muted">
          {describeRecurrence(buildRecurrence())} · next on {dueDate || '—'}
        </p>
      </div>

      <h3 className="section-title">Reminders</h3>
      <p className="rec-hint muted">
        Auto-reminders — tasks created automatically before each due date.
      </p>
      {reminders.map((r, i) => {
        const due = dueDate ? reminderDue(parseDue(dueDate, dueTime), r) : null;
        return (
          <div className="reminder-block" key={i}>
            <div className="prereq-row">
              <input
                className="prereq-title"
                placeholder="e.g. Schedule appointment"
                value={r.label}
                onChange={(e) => setReminder(i, { label: e.target.value })}
              />
              <input
                className="prereq-lead"
                type="number"
                min={0}
                value={r.daysBefore}
                onChange={(e) => setReminder(i, { daysBefore: Number(e.target.value) })}
              />
              <span className="muted">days before</span>
              <button
                type="button"
                className="prereq-del"
                aria-label="Remove reminder"
                onClick={() => {
                  touch();
                  setRemTouched(true);
                  setReminders((prev) => prev.filter((_, idx) => idx !== i));
                }}
              >
                ✕
              </button>
            </div>
            <input
              className="reminder-note"
              placeholder="Note (optional)"
              value={r.note ?? ''}
              onChange={(e) => setReminder(i, { note: e.target.value })}
            />
            {r.label.trim() && due && (
              <p className="rec-hint muted">
                A task “{r.label.trim()}” will be created on {fmt(due)} ({r.daysBefore || 0} days
                before {dueDate})
              </p>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="seg-btn add"
        onClick={() => {
          touch();
          setRemTouched(true);
          setReminders((prev) => [...prev, { label: '', daysBefore: 7, note: '' }]);
        }}
      >
        + Add reminder
      </button>

      {upcoming.length > 0 && (
        <div className="upcoming">
          <h3 className="section-title">Upcoming</h3>
          <ul className="upcoming-list">
            {upcoming.map((u, i) => (
              <li key={i}>
                <span className="upcoming-date">{fmt(u.date)}</span>
                {u.reminders.length > 0 && (
                  <ul className="upcoming-reminders">
                    {u.reminders.map((rm, j) => (
                      <li key={j} className="muted">
                        ↳ {rm.label} · {fmt(rm.date)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="field">
        <span>Description</span>
        <RichTextEditor
          value={description}
          onChange={(v) => {
            touch();
            setDescription(v);
          }}
        />
      </label>

      <div className="field">
        <span>Tags</span>
        <TagEditor
          value={tags}
          known={knownTags}
          onChange={(t) => {
            touch();
            setTags(t);
          }}
        />
      </div>

      <label className="field-inline">
        <input
          type="checkbox"
          checked={done}
          onChange={(e) => {
            touch();
            setDone(e.target.checked);
          }}
        />
        <span>Completed</span>
      </label>

      {err && <p className="error">{err}</p>}

      <div className="detail-actions sticky">
        <button type="submit" className="btn btn-primary ripple" disabled={saving}>
          {dirty && <span className="unsaved-dot" />}
          {saving ? 'Saving…' : item ? 'Save changes' : 'Add Recurring'}
        </button>
        {item && onDelete && (
          <button type="button" className="btn btn-danger ripple" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </form>
  );
}

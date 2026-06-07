import { useState, type FormEvent } from 'react';
import {
  ITEM_TYPES,
  labelize,
  normalizeCategory,
  type Category,
  type ItemType,
  type NewOrganizer,
  type Organizer,
  type Prerequisite,
  type Recurrence,
  type RecurrenceFreq,
} from '../types/organizer';
import { tomorrowStr } from '../lib/dates';
import { describeRecurrence, WEEKDAY_NAMES } from '../lib/recurrence';
import RichTextEditor from './RichTextEditor';

interface Props {
  item: Organizer | null; // null = add mode
  categories: string[]; // known category labels (defaults + in use)
  defaultCategory?: Category;
  onSave: (data: NewOrganizer) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}

// NOTE: the parent passes a `key` so this remounts (and re-seeds state) whenever
// the selected item or add/edit mode changes.
export default function ItemDetail({
  item,
  categories,
  defaultCategory,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [category, setCategory] = useState<Category>(item?.category ?? defaultCategory ?? 'errand');
  const [type, setType] = useState<ItemType>(item?.type ?? 'simple');
  const [description, setDescription] = useState(item?.description ?? '');
  const [dueDate, setDueDate] = useState(item?.dueDate || tomorrowStr());
  const [dueTime, setDueTime] = useState(item?.dueTime || '09:00');
  const [done, setDone] = useState(item?.done ?? false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addingCat, setAddingCat] = useState(false);
  const [newCat, setNewCat] = useState('');

  // Routine config
  const [freq, setFreq] = useState<RecurrenceFreq>(item?.recurrence?.freq ?? 'week');
  const [every, setEvery] = useState<number>(item?.recurrence?.interval ?? 1);
  const [weekdays, setWeekdays] = useState<number[]>(item?.recurrence?.weekdays ?? []);
  const [monthDay, setMonthDay] = useState<number>(item?.recurrence?.monthDay ?? 1);
  const [prereqs, setPrereqs] = useState<Prerequisite[]>(item?.prerequisites ?? []);

  // Always include the currently-selected category as an option, even if it's
  // a freshly-typed label not yet in the known list.
  const catOptions = categories.includes(category) ? categories : [...categories, category];

  function commitNewCat() {
    const v = normalizeCategory(newCat);
    if (v) setCategory(v);
    setNewCat('');
    setAddingCat(false);
  }

  function buildRecurrence(): Recurrence {
    const r: Recurrence = { freq, interval: Math.max(1, Math.floor(every || 1)) };
    if (freq === 'week' && weekdays.length) r.weekdays = [...weekdays].sort((a, b) => a - b);
    if (freq === 'month') r.monthDay = Math.min(31, Math.max(1, monthDay || 1));
    return r;
  }

  function toggleWeekday(i: number) {
    setWeekdays((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setErr('Title is required');
      return;
    }
    setErr(null);
    setSaving(true);
    const isRoutine = type === 'routine';
    try {
      await onSave({
        title: title.trim(),
        category,
        type,
        description,
        dueDate,
        dueTime,
        done,
        recurrence: isRoutine ? buildRecurrence() : null,
        prerequisites: isRoutine
          ? prereqs
              .filter((p) => p.title.trim())
              .map((p) => ({ title: p.title.trim(), leadDays: Math.max(0, Math.floor(p.leadDays || 0)) }))
          : [],
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="detail" onSubmit={handleSubmit}>
      <div className="detail-header">
        <h2 className="display">{item ? 'Edit item' : 'New item'}</h2>
        <button type="button" className="btn btn-ghost ripple" onClick={onClose}>
          ✕ Close
        </button>
      </div>

      {/* Type — no label, top of the form */}
      <div className="field">
        <div className="seg">
          {ITEM_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              className={'seg-btn ripple' + (type === t ? ' active' : '')}
              onClick={() => setType(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Title — no label, hint via placeholder */}
      <div className="field">
        <input
          className="title-input"
          type="text"
          value={title}
          autoFocus
          placeholder="What needs doing?"
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      {/* Category — distinct chip design (different from the type pills) */}
      <div className="field">
        <span>Category</span>
        <div className="cat-seg">
          {catOptions.map((c) => (
            <button
              key={c}
              type="button"
              className={'cat-seg-btn ripple' + (category === c ? ' active' : '')}
              onClick={() => setCategory(c)}
            >
              {labelize(c)}
            </button>
          ))}
          {addingCat ? (
            <input
              className="seg-input"
              autoFocus
              value={newCat}
              placeholder="new label"
              onChange={(e) => setNewCat(e.target.value)}
              onBlur={commitNewCat}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitNewCat();
                } else if (e.key === 'Escape') {
                  setNewCat('');
                  setAddingCat(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="cat-seg-btn add"
              onClick={() => setAddingCat(true)}
            >
              + New label
            </button>
          )}
        </div>
      </div>

      <div className="field-row compact">
        <label className="field">
          <span>Due date</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Due time</span>
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
        </label>
      </div>

      {type === 'routine' && (
        <>
          <div className="field">
            <span>Repeats</span>
            <div className="rec-row">
              <span className="muted">Every</span>
              <input
                className="rec-interval"
                type="number"
                min={1}
                value={every}
                onChange={(e) => setEvery(Number(e.target.value))}
              />
              <div className="seg">
                {(['day', 'week', 'month'] as RecurrenceFreq[]).map((f) => (
                  <button
                    key={f}
                    type="button"
                    className={'seg-btn ripple' + (freq === f ? ' active' : '')}
                    onClick={() => setFreq(f)}
                  >
                    {f}
                    {every > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
            </div>

            {freq === 'week' && (
              <div className="weekday-row">
                {WEEKDAY_NAMES.map((wd, i) => (
                  <button
                    key={wd}
                    type="button"
                    className={'wd-btn ripple' + (weekdays.includes(i) ? ' active' : '')}
                    onClick={() => toggleWeekday(i)}
                  >
                    {wd}
                  </button>
                ))}
              </div>
            )}

            {freq === 'month' && (
              <div className="rec-row">
                <span className="muted">On day</span>
                <input
                  className="rec-interval"
                  type="number"
                  min={1}
                  max={31}
                  value={monthDay}
                  onChange={(e) => setMonthDay(Number(e.target.value))}
                />
              </div>
            )}

            <p className="rec-hint muted">{describeRecurrence(buildRecurrence())} · first on {dueDate}</p>
          </div>

          <div className="field">
            <span>Prerequisites</span>
            {prereqs.map((p, idx) => (
              <div className="prereq-row" key={idx}>
                <input
                  className="prereq-title"
                  placeholder="e.g. Order medication"
                  value={p.title}
                  onChange={(e) =>
                    setPrereqs((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, title: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="prereq-lead"
                  type="number"
                  min={0}
                  value={p.leadDays}
                  onChange={(e) =>
                    setPrereqs((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, leadDays: Number(e.target.value) } : x,
                      ),
                    )
                  }
                />
                <span className="muted">days before</span>
                <button
                  type="button"
                  className="prereq-del"
                  aria-label="Remove prerequisite"
                  onClick={() => setPrereqs((prev) => prev.filter((_, i) => i !== idx))}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="seg-btn add"
              onClick={() => setPrereqs((prev) => [...prev, { title: '', leadDays: 1 }])}
            >
              + Add prerequisite
            </button>
            <p className="rec-hint muted">
              Each prerequisite becomes its own item, due the set number of days before each
              occurrence.
            </p>
          </div>
        </>
      )}

      <label className="field">
        <span>Description</span>
        <RichTextEditor value={description} onChange={setDescription} />
      </label>

      <label className="field-inline">
        <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
        <span>Done</span>
      </label>

      {err && <p className="error">{err}</p>}

      <div className="detail-actions">
        <button type="submit" className="btn btn-primary ripple" disabled={saving}>
          {saving ? 'Saving…' : item ? 'Save changes' : 'Add item'}
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

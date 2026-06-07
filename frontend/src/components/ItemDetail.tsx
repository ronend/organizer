import { useState, type FormEvent } from 'react';
import {
  ITEM_TYPES,
  labelize,
  normalizeCategory,
  type Category,
  type ItemType,
  type NewOrganizer,
  type Organizer,
} from '../types/organizer';
import { tomorrowStr } from '../lib/dates';
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

  // Always include the currently-selected category as an option, even if it's
  // a freshly-typed label not yet in the known list.
  const catOptions = categories.includes(category) ? categories : [...categories, category];

  function commitNewCat() {
    const v = normalizeCategory(newCat);
    if (v) setCategory(v);
    setNewCat('');
    setAddingCat(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setErr('Title is required');
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      await onSave({ title: title.trim(), category, type, description, dueDate, dueTime, done });
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

      <label className="field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          autoFocus
          placeholder="What needs doing?"
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <div className="field">
        <span>Category</span>
        <div className="seg">
          {catOptions.map((c) => (
            <button
              key={c}
              type="button"
              className={'seg-btn ripple' + (category === c ? ' active' : '')}
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
              className="seg-btn add"
              onClick={() => setAddingCat(true)}
            >
              + New label
            </button>
          )}
        </div>
      </div>

      <div className="field">
        <span>Type</span>
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

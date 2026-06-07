import { useState, type FormEvent } from 'react';
import type { Contact, DependsOnRef, NewOrganizer, Tag } from '../types/organizer';
import { tomorrowStr } from '../lib/dates';
import RichTextEditor from './RichTextEditor';
import TagEditor from './TagEditor';
import type { EntryFormProps } from './EntryDetail';

const EMPTY_CONTACT: Contact = { name: '', role: '', phone: '', email: '' };

export default function TaskForm({
  item,
  knownTags,
  allEntries,
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
  const [link, setLink] = useState(item?.link ?? '');
  const [contacts, setContacts] = useState<Contact[]>(item?.contacts ?? []);
  const [dependsOn, setDependsOn] = useState<DependsOnRef[]>(item?.dependsOn ?? []);
  const [done, setDone] = useState(item?.done ?? false);

  const [showContacts, setShowContacts] = useState((item?.contacts?.length ?? 0) > 0);
  const [showDepends, setShowDepends] = useState((item?.dependsOn?.length ?? 0) > 0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  // Entries that can be depended on (anything but this one).
  const dependOptions = allEntries.filter((e) => e.id !== item?.id);

  function close() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  function setContact(i: number, patch: Partial<Contact>) {
    touch();
    setContacts((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
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
      type: 'task',
      title: title.trim(),
      description,
      tags,
      dueDate,
      dueTime,
      done,
      link: link.trim(),
      contacts: contacts.filter((c) => c.name.trim() || c.email.trim() || c.phone.trim()),
      dependsOn: dependsOn.filter((d) => d.entryId),
      recurrence: null,
      reminders: [],
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

  const missingTitle = err && !title.trim();

  return (
    <form className="detail" onSubmit={handleSubmit}>
      <div className="detail-header">
        <h2 className="display">
          <span className="type-emoji">✅</span> {item ? 'Edit Task' : 'New Task'}
        </h2>
        <button type="button" className="btn btn-ghost ripple" onClick={close}>
          ✕ Close
        </button>
      </div>

      <div className="field">
        <input
          className={'title-input' + (missingTitle ? ' invalid' : '')}
          type="text"
          value={title}
          autoFocus
          placeholder="What needs doing?"
          onChange={(e) => {
            touch();
            setTitle(e.target.value);
          }}
        />
      </div>

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

      <div className="field-row compact">
        <label className="field">
          <span>Due date</span>
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
          <span>Due time</span>
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
        <span>Link</span>
        <div className="link-row">
          <input
            type="url"
            placeholder="https://…"
            value={link}
            onChange={(e) => {
              touch();
              setLink(e.target.value);
            }}
          />
          {link.trim() && (
            <a
              className="btn btn-ghost ripple"
              href={link.trim()}
              target="_blank"
              rel="noreferrer"
            >
              🔗 Open
            </a>
          )}
        </div>
      </div>

      <div className="field">
        <button
          type="button"
          className="section-toggle"
          onClick={() => setShowContacts((v) => !v)}
        >
          {showContacts ? '▾' : '▸'} Contacts{contacts.length ? ` (${contacts.length})` : ''}
        </button>
        {showContacts && (
          <div className="contacts">
            {contacts.map((c, i) => (
              <div className="contact-row" key={i}>
                <input
                  placeholder="Name"
                  value={c.name}
                  onChange={(e) => setContact(i, { name: e.target.value })}
                />
                <input
                  placeholder="Role (e.g. Doctor)"
                  value={c.role}
                  onChange={(e) => setContact(i, { role: e.target.value })}
                />
                <input
                  placeholder="Phone"
                  value={c.phone}
                  onChange={(e) => setContact(i, { phone: e.target.value })}
                />
                <input
                  placeholder="Email"
                  value={c.email}
                  onChange={(e) => setContact(i, { email: e.target.value })}
                />
                <button
                  type="button"
                  className="prereq-del"
                  aria-label="Remove contact"
                  onClick={() => {
                    touch();
                    setContacts((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="seg-btn add"
              onClick={() => {
                touch();
                setContacts((prev) => [...prev, { ...EMPTY_CONTACT }]);
              }}
            >
              + Add contact
            </button>
          </div>
        )}
      </div>

      <div className="field">
        <button
          type="button"
          className="section-toggle"
          onClick={() => setShowDepends((v) => !v)}
        >
          {showDepends ? '▾' : '▸'} Depends on{dependsOn.length ? ` (${dependsOn.length})` : ''}
        </button>
        {showDepends && (
          <div className="depends">
            {dependsOn.map((d, i) => (
              <div className="prereq-row" key={i}>
                <select
                  className="prereq-title"
                  value={d.entryId}
                  onChange={(e) => {
                    touch();
                    setDependsOn((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, entryId: e.target.value } : x)),
                    );
                  }}
                >
                  <option value="">Select an entry…</option>
                  {dependOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.title || '(untitled)'}
                    </option>
                  ))}
                </select>
                <input
                  className="prereq-lead"
                  type="number"
                  min={0}
                  value={d.daysBefore}
                  onChange={(e) => {
                    touch();
                    setDependsOn((prev) =>
                      prev.map((x, idx) =>
                        idx === i ? { ...x, daysBefore: Number(e.target.value) } : x,
                      ),
                    );
                  }}
                />
                <span className="muted">days before</span>
                <button
                  type="button"
                  className="prereq-del"
                  aria-label="Remove dependency"
                  onClick={() => {
                    touch();
                    setDependsOn((prev) => prev.filter((_, idx) => idx !== i));
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="seg-btn add"
              onClick={() => {
                touch();
                setDependsOn((prev) => [...prev, { entryId: '', daysBefore: 1 }]);
              }}
            >
              + Add dependency
            </button>
          </div>
        )}
      </div>

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
          {saving ? 'Saving…' : item ? 'Save changes' : 'Add Task'}
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

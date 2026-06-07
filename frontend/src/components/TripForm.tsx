import { useState, type FormEvent } from 'react';
import type { NewOrganizer, Segment, SegmentType, Tag } from '../types/organizer';
import {
  SEGMENT_ORDER,
  SEGMENT_SPECS,
  newSegment,
  segmentSummary,
} from '../lib/segments';
import RichTextEditor from './RichTextEditor';
import TagEditor from './TagEditor';
import type { EntryFormProps } from './EntryDetail';

export default function TripForm({
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
  const [startDate, setStartDate] = useState(item?.startDate ?? item?.dueDate ?? '');
  const [endDate, setEndDate] = useState(item?.endDate ?? '');
  const [segments, setSegments] = useState<Segment[]>(item?.segments ?? []);
  const [done, setDone] = useState(item?.done ?? false);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  function close() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  function toggleOpen(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function addSegment(type: SegmentType) {
    touch();
    const seg = newSegment(type);
    setSegments((prev) => [...prev, seg]);
    setOpen((prev) => new Set(prev).add(seg.id));
    setPicking(false);
  }

  function setField(id: string, key: string, value: string) {
    touch();
    setSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, fields: { ...s.fields, [key]: value } } : s)),
    );
  }

  function removeSegment(id: string) {
    touch();
    setSegments((prev) => prev.filter((s) => s.id !== id));
  }

  function handleDrop(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) return;
    touch();
    setSegments((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDragIndex(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setErr('Title is required');
      return;
    }
    if (!startDate) {
      setErr('Start date is required');
      return;
    }
    setErr(null);
    setSaving(true);
    const data: NewOrganizer = {
      type: 'trip',
      title: title.trim(),
      description,
      tags,
      // Trips sort/appear by their start date (the shared due field).
      dueDate: startDate,
      dueTime: '09:00',
      done,
      startDate,
      endDate,
      segments,
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
  const missingStart = err && !startDate;

  return (
    <form className="detail" onSubmit={handleSubmit}>
      <div className="detail-header">
        <h2 className="display">
          <span className="type-emoji">✈️</span> {item ? 'Edit Trip' : 'New Trip'}
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
          placeholder="e.g. Summer Europe Trip"
          onChange={(e) => {
            touch();
            setTitle(e.target.value);
          }}
        />
      </div>

      <div className="field-row compact">
        <label className="field">
          <span>Start date</span>
          <input
            className={missingStart ? 'invalid' : ''}
            type="date"
            value={startDate}
            onChange={(e) => {
              touch();
              setStartDate(e.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>End date</span>
          <input
            type="date"
            value={endDate}
            min={startDate || undefined}
            onChange={(e) => {
              touch();
              setEndDate(e.target.value);
            }}
          />
        </label>
      </div>

      <h3 className="section-title">Itinerary</h3>
      <ul className="segment-list">
        {segments.map((seg, i) => {
          const spec = SEGMENT_SPECS[seg.type];
          const isOpen = open.has(seg.id);
          return (
            <li
              key={seg.id}
              className={'segment-card' + (dragIndex === i ? ' dragging' : '')}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => setDragIndex(null)}
            >
              <div className="segment-head">
                <span className="drag-handle" title="Drag to reorder" aria-hidden>
                  ⠿
                </span>
                <button
                  type="button"
                  className="segment-summary"
                  onClick={() => toggleOpen(seg.id)}
                >
                  <span className="segment-caret">{isOpen ? '▾' : '▸'}</span>
                  {segmentSummary(seg)}
                </button>
                <button
                  type="button"
                  className="prereq-del"
                  aria-label="Remove segment"
                  onClick={() => removeSegment(seg.id)}
                >
                  ✕
                </button>
              </div>
              {isOpen && (
                <div className="segment-fields">
                  {spec.fields.map((f) => (
                    <label key={f.key} className="segment-field">
                      <span>{f.label}</span>
                      {f.input === 'textarea' ? (
                        <textarea
                          rows={2}
                          value={seg.fields[f.key] ?? ''}
                          onChange={(e) => setField(seg.id, f.key, e.target.value)}
                        />
                      ) : (
                        <input
                          type={f.input}
                          value={seg.fields[f.key] ?? ''}
                          onChange={(e) => setField(seg.id, f.key, e.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
        {segments.length === 0 && <li className="muted segment-empty">No segments yet.</li>}
      </ul>

      {picking ? (
        <div className="segment-picker">
          {SEGMENT_ORDER.map((type) => {
            const spec = SEGMENT_SPECS[type];
            return (
              <button
                key={type}
                type="button"
                className="segment-type-btn ripple"
                onClick={() => addSegment(type)}
              >
                <span className="segment-type-icon">{spec.icon}</span>
                {spec.label}
              </button>
            );
          })}
          <button type="button" className="seg-btn" onClick={() => setPicking(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" className="seg-btn add" onClick={() => setPicking(true)}>
          + Add segment
        </button>
      )}

      <label className="field" style={{ marginTop: '1.4rem' }}>
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
          {saving ? 'Saving…' : item ? 'Save changes' : 'Add Trip'}
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

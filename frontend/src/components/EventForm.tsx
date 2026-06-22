import { useState, type FormEvent } from 'react';
import type { EventKind, NewEvent, Tag, Attrs } from '../types/organizer';
import { EVENT_KIND_META } from '../types/organizer';
import { stripLocalIds } from '../lib/localId';
import { buildRRule, parseRRule, type RRuleFreq } from '../lib/recurrence';
import TagEditor from './TagEditor';
import ItemEditor, { newItem } from './ItemEditor';
import ReminderEditor from './ReminderEditor';
import ChecklistEditor from './ChecklistEditor';
import AttachmentEditor from './AttachmentEditor';
import AttrsEditor from './AttrsEditor';
import type { EventFormProps } from './EventDetail';

const EVENT_STATUS = ['planned', 'active', 'done', 'cancelled'];

const RRULE_FREQS: { label: string; value: RRuleFreq | '' }[] = [
  { label: 'Does not repeat', value: '' },
  { label: 'Daily', value: 'DAILY' },
  { label: 'Weekly', value: 'WEEKLY' },
  { label: 'Monthly', value: 'MONTHLY' },
  { label: 'Yearly', value: 'YEARLY' },
];

function Section({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="field">
      <button type="button" className="section-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} {title}
        {count ? ` (${count})` : ''}
      </button>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export default function EventForm({
  item,
  addKind,
  knownTags,
  defaultTags,
  onSave,
  onDelete,
  onClose,
}: EventFormProps) {
  const kind: EventKind = item ? item.kind : addKind;
  const meta = EVENT_KIND_META[kind];
  const hasDates = kind !== 'list';

  const [title, setTitle] = useState(item?.title ?? '');
  const [subtype, setSubtype] = useState(item?.subtype ?? '');
  const [status, setStatus] = useState(item?.status ?? 'planned');
  const [tags, setTags] = useState<Tag[]>(item?.tags ?? defaultTags);
  const [startDate, setStartDate] = useState(item?.start_date ?? '');
  const [endDate, setEndDate] = useState(item?.end_date ?? '');
  const [rrule, setRrule] = useState<string | null>(item?.recurrence_rule ?? null);
  const [items, setItems] = useState(item?.items ?? []);
  const [reminders, setReminders] = useState(item?.reminders ?? []);
  const [checklists, setChecklists] = useState(item?.checklists ?? []);
  const [attachments, setAttachments] = useState(item?.attachments ?? []);
  const [attrs, setAttrs] = useState<Attrs>(item?.attrs ?? {});

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const touch = () => setDirty(true);

  const parsedRule = parseRRule(rrule);

  function close() {
    if (dirty && !window.confirm('Discard unsaved changes?')) return;
    onClose();
  }

  function wrap<T>(setter: (v: T) => void) {
    return (v: T) => {
      touch();
      setter(v);
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setErr('Title is required');
      return;
    }
    setErr(null);
    setSaving(true);
    const data: NewEvent = stripLocalIds({
      kind,
      title: title.trim(),
      subtype: subtype.trim(),
      status,
      tags,
      start_date: hasDates ? startDate || null : null,
      end_date: hasDates ? endDate || null : null,
      recurrence_rule: hasDates ? rrule : null,
      attrs,
      items,
      reminders,
      checklists,
      attachments,
    });
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
          <span className="type-emoji">{meta.icon}</span> {item ? `Edit ${meta.label}` : `New ${meta.label}`}
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
          placeholder="Title"
          onChange={(e) => {
            touch();
            setTitle(e.target.value);
          }}
        />
      </div>

      <div className="field-row compact">
        <label className="field">
          <span>Subtype</span>
          <input
            placeholder="backpacking, dental checkup, medication…"
            value={subtype}
            onChange={(e) => {
              touch();
              setSubtype(e.target.value);
            }}
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              touch();
              setStatus(e.target.value);
            }}
          >
            {EVENT_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {hasDates && (
        <>
          <div className="field-row compact">
            <label className="field">
              <span>Start date</span>
              <input type="date" value={startDate ?? ''} onChange={(e) => wrap(setStartDate)(e.target.value)} />
            </label>
            <label className="field">
              <span>End date</span>
              <input type="date" value={endDate ?? ''} onChange={(e) => wrap(setEndDate)(e.target.value)} />
            </label>
          </div>
          <div className="field-row compact">
            <label className="field">
              <span>Repeats</span>
              <select
                value={parsedRule?.freq ?? ''}
                onChange={(e) =>
                  wrap(setRrule)(e.target.value ? buildRRule(e.target.value as RRuleFreq, parsedRule?.interval ?? 1) : null)
                }
              >
                {RRULE_FREQS.map((f) => (
                  <option key={f.label} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            {parsedRule && (
              <label className="field">
                <span>Every</span>
                <input
                  type="number"
                  min={1}
                  value={parsedRule.interval}
                  onChange={(e) => wrap(setRrule)(buildRRule(parsedRule.freq, Number(e.target.value) || 1))}
                />
              </label>
            )}
          </div>
        </>
      )}

      <div className="field">
        <span>Tags</span>
        <TagEditor value={tags} known={knownTags} onChange={wrap(setTags)} />
      </div>

      <Section title="Items" count={items.length} defaultOpen={items.length > 0}>
        <ItemEditor value={items} onChange={wrap(setItems)} />
      </Section>

      <Section title="Checklists" count={checklists.length} defaultOpen={kind === 'list' && checklists.length === 0}>
        <ChecklistEditor value={checklists} onChange={wrap(setChecklists)} />
      </Section>

      <Section title="Reminders" count={reminders.length} defaultOpen={reminders.length > 0}>
        <ReminderEditor
          value={reminders}
          relativeToLabel={hasDates ? 'relative to start date' : undefined}
          onChange={wrap(setReminders)}
        />
      </Section>

      <Section title="Attachments" count={attachments.length}>
        <AttachmentEditor value={attachments} onChange={wrap(setAttachments)} />
      </Section>

      <Section title="Custom fields (attrs)" count={Object.keys(attrs).length}>
        <AttrsEditor value={attrs} onChange={wrap(setAttrs)} />
      </Section>

      {err && <p className="error">{err}</p>}

      <div className="detail-actions sticky">
        <button type="submit" className="btn btn-primary ripple" disabled={saving}>
          {dirty && <span className="unsaved-dot" />}
          {saving ? 'Saving…' : item ? 'Save changes' : `Add ${meta.label}`}
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

// Re-export a quick-add helper so callers can seed an items array if desired.
export { newItem };

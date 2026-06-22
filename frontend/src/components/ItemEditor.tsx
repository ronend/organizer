import { useState } from 'react';
import type { Item, ItemKind } from '../types/organizer';
import { ITEM_KINDS, ITEM_KIND_META } from '../types/organizer';
import { newLocalId } from '../lib/localId';
import { splitDateTime, combineDateTime } from '../lib/dates';
import AttrsEditor from './AttrsEditor';
import ReminderEditor from './ReminderEditor';

interface Props {
  value: Item[];
  onChange: (next: Item[]) => void;
}

export function newItem(kind: ItemKind = 'task'): Item {
  return {
    id: newLocalId(),
    kind,
    subtype: '',
    tags: [],
    title: '',
    status: 'todo',
    scheduled_at: null,
    due_at: null,
    sort_order: 0,
    confirmation_ref: null,
    cost: null,
    currency: null,
    address: null,
    phone: null,
    url: null,
    login_hint: null,
    prereq_ids: [],
    attrs: {},
    reminders: [],
  };
}

const STATUS_OPTIONS = ['todo', 'confirmed', 'done', 'cancelled'];

function ItemCard({
  item,
  siblings,
  onPatch,
  onRemove,
}: {
  item: Item;
  siblings: Item[];
  onPatch: (p: Partial<Item>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const sched = splitDateTime(item.scheduled_at);
  const due = splitDateTime(item.due_at);
  const isReservation = item.kind === 'reservation';

  return (
    <div className="item-card">
      <div className="item-card-head">
        <span className="type-emoji">{ITEM_KIND_META[item.kind].icon}</span>
        <input
          className="item-card-title"
          placeholder="Item title"
          value={item.title}
          onChange={(e) => onPatch({ title: e.target.value })}
        />
        <button type="button" className="section-toggle" onClick={() => setOpen((v) => !v)}>
          {open ? '▾' : '▸'}
        </button>
        <button type="button" className="prereq-del" aria-label="Remove item" onClick={onRemove}>
          ✕
        </button>
      </div>

      <div className="field-row compact">
        <label className="field">
          <span>Kind</span>
          <select value={item.kind} onChange={(e) => onPatch({ kind: e.target.value as ItemKind })}>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {ITEM_KIND_META[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Subtype</span>
          <input
            placeholder="flight, medication, hike…"
            value={item.subtype}
            onChange={(e) => onPatch({ subtype: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={item.status} onChange={(e) => onPatch({ status: e.target.value })}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {open && (
        <>
          <div className="field-row compact">
            <label className="field">
              <span>Scheduled</span>
              <input
                type="date"
                value={sched.date}
                onChange={(e) => onPatch({ scheduled_at: combineDateTime(e.target.value, sched.time) || null })}
              />
            </label>
            <label className="field">
              <span>Time</span>
              <input
                type="time"
                value={sched.time}
                onChange={(e) => onPatch({ scheduled_at: combineDateTime(sched.date, e.target.value) || null })}
              />
            </label>
            <label className="field">
              <span>Due</span>
              <input
                type="date"
                value={due.date}
                onChange={(e) => onPatch({ due_at: combineDateTime(e.target.value, due.time) || null })}
              />
            </label>
          </div>

          {isReservation && (
            <div className="subsection">
              <div className="field-row compact">
                <label className="field">
                  <span>Confirmation #</span>
                  <input
                    value={item.confirmation_ref ?? ''}
                    onChange={(e) => onPatch({ confirmation_ref: e.target.value || null })}
                  />
                </label>
                <label className="field">
                  <span>Cost</span>
                  <input
                    type="number"
                    value={item.cost ?? ''}
                    onChange={(e) =>
                      onPatch({ cost: e.target.value === '' ? null : Number(e.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  <span>Currency</span>
                  <input
                    placeholder="USD"
                    value={item.currency ?? ''}
                    onChange={(e) => onPatch({ currency: e.target.value || null })}
                  />
                </label>
              </div>
              <label className="field">
                <span>Address</span>
                <input
                  value={item.address ?? ''}
                  onChange={(e) => onPatch({ address: e.target.value || null })}
                />
              </label>
              <div className="field-row compact">
                <label className="field">
                  <span>Phone</span>
                  <input
                    value={item.phone ?? ''}
                    onChange={(e) => onPatch({ phone: e.target.value || null })}
                  />
                </label>
                <label className="field">
                  <span>URL</span>
                  <input
                    type="url"
                    value={item.url ?? ''}
                    onChange={(e) => onPatch({ url: e.target.value || null })}
                  />
                </label>
                <label className="field">
                  <span>Login hint</span>
                  <input
                    placeholder="username / email"
                    value={item.login_hint ?? ''}
                    onChange={(e) => onPatch({ login_hint: e.target.value || null })}
                  />
                </label>
              </div>
            </div>
          )}

          {siblings.length > 0 && (
            <label className="field">
              <span>Depends on (prerequisites)</span>
              <select
                multiple
                className="prereq-multi"
                value={item.prereq_ids}
                onChange={(e) =>
                  onPatch({
                    prereq_ids: Array.from(e.target.selectedOptions).map((o) => o.value),
                  })
                }
              >
                {siblings.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || '(untitled)'}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="field">
            <span className="subhead">Custom fields (attrs)</span>
            <AttrsEditor value={item.attrs} onChange={(attrs) => onPatch({ attrs })} />
          </div>

          <div className="field">
            <span className="subhead">Item reminders</span>
            <ReminderEditor
              value={item.reminders}
              relativeToLabel="relative to scheduled/due"
              onChange={(reminders) => onPatch({ reminders })}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function ItemEditor({ value, onChange }: Props) {
  function patch(id: string, p: Partial<Item>) {
    onChange(value.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }

  return (
    <div className="items-edit">
      {value.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          siblings={value.filter((s) => s.id !== item.id)}
          onPatch={(p) => patch(item.id, p)}
          onRemove={() => onChange(value.filter((it) => it.id !== item.id))}
        />
      ))}
      <div className="add-item-row">
        <button type="button" className="seg-btn add" onClick={() => onChange([...value, newItem('task')])}>
          + Task
        </button>
        <button
          type="button"
          className="seg-btn add"
          onClick={() => onChange([...value, newItem('reservation')])}
        >
          + Reservation
        </button>
        <button type="button" className="seg-btn add" onClick={() => onChange([...value, newItem('entry')])}>
          + Entry
        </button>
      </div>
    </div>
  );
}

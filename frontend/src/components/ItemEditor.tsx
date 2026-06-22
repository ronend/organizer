import { useState } from 'react';
import type { Item, ItemKind } from '../types/organizer';
import { ITEM_KINDS, ITEM_KIND_META } from '../types/organizer';
import { newLocalId } from '../lib/localId';
import AttrsEditor from './AttrsEditor';
import ReminderEditor from './ReminderEditor';
import DateTimeField from './DateTimeField';

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

/** Keep sort_order aligned with array position after any reorder/add/remove. */
function renumber(items: Item[]): Item[] {
  return items.map((it, i) => ({ ...it, sort_order: i + 1 }));
}

function ItemCard({
  item,
  siblings,
  isFirst,
  isLast,
  isDragging,
  onPatch,
  onRemove,
  onMove,
  onDragStart,
  onDragEnd,
  onDropOn,
}: {
  item: Item;
  siblings: Item[];
  isFirst: boolean;
  isLast: boolean;
  isDragging: boolean;
  onPatch: (p: Partial<Item>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
}) {
  const [open, setOpen] = useState(false);
  const isReservation = item.kind === 'reservation';

  return (
    <div
      className={'item-card' + (isDragging ? ' dragging' : '')}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
    >
      <div className="item-card-head">
        <span
          className="drag-handle"
          draggable
          title="Drag to reorder"
          aria-label="Drag to reorder"
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        >
          ⠿
        </span>
        <span className="type-emoji">{ITEM_KIND_META[item.kind].icon}</span>
        <input
          className="item-card-title"
          placeholder="Item title"
          value={item.title}
          onChange={(e) => onPatch({ title: e.target.value })}
        />
        <span className="move-btns">
          <button
            type="button"
            className="move-btn"
            disabled={isFirst}
            aria-label="Move up"
            title="Move up"
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="move-btn"
            disabled={isLast}
            aria-label="Move down"
            title="Move down"
            onClick={() => onMove(1)}
          >
            ↓
          </button>
        </span>
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
              <DateTimeField
                value={item.scheduled_at}
                ariaLabel="Scheduled date and time"
                onChange={(v) => onPatch({ scheduled_at: v })}
              />
            </label>
            <label className="field">
              <span>Due</span>
              <DateTimeField
                value={item.due_at}
                ariaLabel="Due date and time"
                onChange={(v) => onPatch({ due_at: v })}
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
  const [dragId, setDragId] = useState<string | null>(null);

  function patch(id: string, p: Partial<Item>) {
    onChange(value.map((it) => (it.id === id ? { ...it, ...p } : it)));
  }

  function move(fromId: string, toId: string) {
    if (fromId === toId) return;
    const from = value.findIndex((i) => i.id === fromId);
    const to = value.findIndex((i) => i.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(renumber(next));
  }

  function moveBy(id: string, delta: number) {
    const from = value.findIndex((i) => i.id === id);
    const to = from + delta;
    if (to < 0 || to >= value.length) return;
    move(id, value[to].id);
  }

  return (
    <div className="items-edit">
      {value.map((item, i) => (
        <ItemCard
          key={item.id}
          item={item}
          siblings={value.filter((s) => s.id !== item.id)}
          isFirst={i === 0}
          isLast={i === value.length - 1}
          isDragging={dragId === item.id}
          onPatch={(p) => patch(item.id, p)}
          onRemove={() => onChange(renumber(value.filter((it) => it.id !== item.id)))}
          onMove={(delta) => moveBy(item.id, delta)}
          onDragStart={() => setDragId(item.id)}
          onDragEnd={() => setDragId(null)}
          onDropOn={() => {
            if (dragId) move(dragId, item.id);
            setDragId(null);
          }}
        />
      ))}
      <div className="add-item-row">
        <button
          type="button"
          className="seg-btn add"
          onClick={() => onChange(renumber([...value, newItem('task')]))}
        >
          + Task
        </button>
        <button
          type="button"
          className="seg-btn add"
          onClick={() => onChange(renumber([...value, newItem('reservation')]))}
        >
          + Reservation
        </button>
        <button
          type="button"
          className="seg-btn add"
          onClick={() => onChange(renumber([...value, newItem('entry')]))}
        >
          + Entry
        </button>
      </div>
    </div>
  );
}

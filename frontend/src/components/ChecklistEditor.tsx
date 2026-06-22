import type { ChecklistInstance, ChecklistItem } from '../types/organizer';
import { newLocalId } from '../lib/localId';

interface Props {
  value: ChecklistInstance[];
  onChange: (next: ChecklistInstance[]) => void;
}

function newChecklist(): ChecklistInstance {
  return { id: newLocalId(), template_id: null, name: 'Checklist', items: [] };
}

function newChecklistItem(sort_order: number): ChecklistItem {
  return {
    id: newLocalId(),
    label: '',
    checked: false,
    needs_purchase: false,
    purchased: false,
    notes: null,
    sort_order,
  };
}

export default function ChecklistEditor({ value, onChange }: Props) {
  function patchList(id: string, p: Partial<ChecklistInstance>) {
    onChange(value.map((cl) => (cl.id === id ? { ...cl, ...p } : cl)));
  }

  function patchItem(listId: string, itemId: string, p: Partial<ChecklistItem>) {
    onChange(
      value.map((cl) =>
        cl.id === listId
          ? { ...cl, items: cl.items.map((i) => (i.id === itemId ? { ...i, ...p } : i)) }
          : cl,
      ),
    );
  }

  return (
    <div className="checklists-edit">
      {value.map((cl) => (
        <div className="checklist-card" key={cl.id}>
          <div className="checklist-head">
            <input
              className="checklist-name"
              value={cl.name}
              placeholder="Checklist name"
              onChange={(e) => patchList(cl.id, { name: e.target.value })}
            />
            {cl.template_id && <span className="badge tag" title="From template">tmpl</span>}
            <button
              type="button"
              className="prereq-del"
              aria-label="Remove checklist"
              onClick={() => onChange(value.filter((c) => c.id !== cl.id))}
            >
              ✕
            </button>
          </div>

          {cl.items.map((ci) => (
            <div className="checklist-item-row" key={ci.id}>
              <input
                type="checkbox"
                checked={ci.checked}
                title="Checked"
                onChange={(e) => patchItem(cl.id, ci.id, { checked: e.target.checked })}
              />
              <input
                className="checklist-item-label"
                placeholder="Item"
                value={ci.label}
                onChange={(e) => patchItem(cl.id, ci.id, { label: e.target.value })}
              />
              <label className="mini-toggle" title="Needs purchase (shows in shopping list)">
                <input
                  type="checkbox"
                  checked={ci.needs_purchase}
                  onChange={(e) => patchItem(cl.id, ci.id, { needs_purchase: e.target.checked })}
                />
                🛒
              </label>
              <label className="mini-toggle" title="Purchased">
                <input
                  type="checkbox"
                  checked={ci.purchased}
                  onChange={(e) => patchItem(cl.id, ci.id, { purchased: e.target.checked })}
                />
                ✅
              </label>
              <button
                type="button"
                className="prereq-del"
                aria-label="Remove item"
                onClick={() =>
                  patchList(cl.id, { items: cl.items.filter((i) => i.id !== ci.id) })
                }
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="seg-btn add"
            onClick={() => patchList(cl.id, { items: [...cl.items, newChecklistItem(cl.items.length + 1)] })}
          >
            + Add item
          </button>
        </div>
      ))}
      <button type="button" className="seg-btn add" onClick={() => onChange([...value, newChecklist()])}>
        + Add checklist
      </button>
    </div>
  );
}

import type { Organizer } from '../types/organizer';
import { formatDue, isOverdue } from '../lib/dates';

interface Props {
  items: Organizer[]; // already filtered + sorted by due date
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
}

export default function ItemList({ items, selectedId, onSelect, onToggleDone }: Props) {
  if (items.length === 0) {
    return <p className="empty">No items here.</p>;
  }

  return (
    <ul className="item-list">
      {items.map((item) => (
        <li
          key={item.id}
          className={
            'item-row' +
            (item.id === selectedId ? ' selected' : '') +
            (item.done ? ' done' : '')
          }
          onClick={() => onSelect(item.id)}
        >
          <input
            type="checkbox"
            checked={item.done}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onToggleDone(item.id, e.target.checked)}
          />
          <div className="item-main">
            <span className="item-title">{item.title || '(untitled)'}</span>
            <span className="item-meta">
              <span className={`badge cat-${item.category}`}>{item.category}</span>
              <span className={isOverdue(item) ? 'item-due overdue' : 'item-due'}>
                {formatDue(item)}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

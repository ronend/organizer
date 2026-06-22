import type { EventDocument } from '../types/organizer';
import { deriveShopping } from '../lib/derive';

interface Props {
  events: EventDocument[];
  onOpenEvent: (id: string) => void;
  onTogglePurchased: (eventId: string, checklistId: string, itemId: string, purchased: boolean) => void;
}

/** Derived shopping list: checklist items that need purchasing, grouped by event. */
export default function ShoppingView({ events, onOpenEvent, onTogglePurchased }: Props) {
  const rows = deriveShopping(events);
  if (rows.length === 0) return <p className="empty">Nothing to buy.</p>;
  return (
    <ul className="shopping-list">
      {rows.map((row) => (
        <li key={`${row.event_id}-${row.checklist_id}-${row.id}`} className="shopping-row">
          <input
            type="checkbox"
            checked={row.purchased}
            title="Mark purchased"
            onChange={(e) => onTogglePurchased(row.event_id, row.checklist_id, row.id, e.target.checked)}
          />
          <span className="shopping-body">
            <span className="shopping-label">🛒 {row.label || '(unnamed)'}</span>
            <button className="shopping-context" onClick={() => onOpenEvent(row.event_id)}>
              {row.event_title} · {row.checklist_name}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

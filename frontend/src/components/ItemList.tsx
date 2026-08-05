import type { Entity } from '../types/organizer';
import { entityDate, isCompletable, isCompleted, labelize } from '../types/organizer';
import { formatDate, urgency } from '../lib/dates';
import { describeRecurrence } from '../lib/recurrence';
import Icon, { TYPE_ICON } from './Icon';

interface Props {
  items: Entity[]; // already filtered + sorted
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleComplete: (id: string, completed: boolean) => void;
}

function metaBadges(e: Entity) {
  switch (e.type) {
    case 'reservation':
      return <span className="badge routine">{e.subtype}</span>;
    case 'habit':
      return <span className="badge routine">{describeRecurrence(e.recurrence)}</span>;
    case 'routine':
      return e.reminders.length ? (
        <span className="badge reminder" title="Scheduled reminders">
          <Icon name="bell" size={12} /> {e.reminders.length}
        </span>
      ) : null;
    case 'story':
      return (
        <span className="badge contact" title="Items on the timeline">
          <Icon name="list" size={12} /> {e.item_refs.length}
        </span>
      );
    case 'appointment':
      return e.location ? <span className="badge contact">{e.location}</span> : null;
    default:
      return null;
  }
}

export default function ItemList({ items, selectedId, onSelect, onToggleComplete }: Props) {
  if (items.length === 0) {
    return <p className="empty">Nothing here yet.</p>;
  }

  return (
    <ul className="item-list">
      {items.map((e) => {
        const date = entityDate(e);
        const done = isCompleted(e);
        const dateLabel = date ? formatDate(date) : e.type === 'habit' || e.type === 'story' ? '' : 'No date';
        return (
          <li
            key={e.id}
            data-id={e.id}
            className={
              'item-row ripple' + (e.id === selectedId ? ' selected' : '') + (done ? ' done' : '')
            }
            onClick={() => onSelect(e.id)}
          >
            {isCompletable(e) ? (
              <input
                type="checkbox"
                checked={done}
                onClick={(ev) => ev.stopPropagation()}
                onChange={(ev) => onToggleComplete(e.id, ev.target.checked)}
              />
            ) : (
              <span className="entry-icon" aria-hidden>
                <Icon name={TYPE_ICON[e.type]} size={16} />
              </span>
            )}
            <div className="item-main">
              <span className="item-title">
                {isCompletable(e) && (
                  <span className="entry-icon">
                    <Icon name={TYPE_ICON[e.type]} size={16} />
                  </span>
                )}
                {e.title || '(untitled)'}
              </span>
              <span className="item-meta">
                <span className="badge tag">{labelize(e.type)}</span>
                {metaBadges(e)}
                {dateLabel && (
                  <span className={`item-due ${urgency(date, done)}`}>{dateLabel}</span>
                )}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

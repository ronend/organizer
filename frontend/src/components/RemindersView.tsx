import type { Entity } from '../types/organizer';
import { labelize } from '../types/organizer';
import { deriveReminders } from '../lib/derive';
import { formatDate } from '../lib/dates';
import Icon from './Icon';

interface Props {
  items: Entity[];
  onOpen: (id: string) => void;
}

/** Read-only "what fires next" view. Routines contribute one row per scheduled
 * reminder; other dated items contribute a single trigger at their own time. */
export default function RemindersView({ items, onOpen }: Props) {
  const reminders = deriveReminders(items, { upcomingOnly: true });
  if (reminders.length === 0) return <p className="empty">No upcoming reminders.</p>;
  return (
    <ul className="reminder-list">
      {reminders.map((r) => (
        <li key={r.key} className="reminder-list-row" onClick={() => onOpen(r.sourceId)}>
          <span className="reminder-fire">{formatDate(r.fireAt)}</span>
          <span className="reminder-body">
            <span className="reminder-list-title">
              <Icon name="bell" size={15} /> {r.title || '(untitled)'}
            </span>
            <span className="reminder-list-sub">{labelize(r.sourceType)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

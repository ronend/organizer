import type { EventDocument } from '../types/organizer';
import { deriveReminders } from '../lib/derive';
import { formatDate } from '../lib/dates';
import { describeRRule } from '../lib/recurrence';

interface Props {
  events: EventDocument[];
  onOpenEvent: (id: string) => void;
}

/** Read-only "what fires next" view over the reminders_index projection. */
export default function RemindersView({ events, onOpenEvent }: Props) {
  const reminders = deriveReminders(events, { status: 'pending' });
  if (reminders.length === 0) return <p className="empty">No pending reminders.</p>;
  return (
    <ul className="reminder-list">
      {reminders.map((r) => (
        <li key={`${r.event_id}-${r.id}`} className="reminder-list-row" onClick={() => onOpenEvent(r.event_id)}>
          <span className="reminder-fire">{formatDate(r.fire_at)}</span>
          <span className="reminder-body">
            <span className="reminder-list-title">🔔 {r.title || '(untitled)'}</span>
            <span className="reminder-list-sub">
              {r.event_title}
              {r.recurrence_rule ? ` · ${describeRRule(r.recurrence_rule)}` : ''}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

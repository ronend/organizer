import type { EntryType } from '../types/organizer';

interface Props {
  onPick: (type: EntryType) => void;
  onClose: () => void;
}

interface Card {
  type: EntryType;
  icon: string;
  title: string;
  blurb: string;
  enabled: boolean;
}

// Phase 1 ships Task + Recurring. Trip is shown but disabled (coming soon).
const CARDS: Card[] = [
  {
    type: 'task',
    icon: '✅',
    title: 'Task',
    blurb: 'A one-time to-do with optional details, link & contacts',
    enabled: true,
  },
  {
    type: 'trip',
    icon: '✈️',
    title: 'Trip',
    blurb: 'Full trip itinerary with flights, hotels & activities',
    enabled: false,
  },
  {
    type: 'recurring',
    icon: '🔄',
    title: 'Recurring',
    blurb: 'Repeating task with automatic reminders before each due date',
    enabled: true,
  },
];

export default function EntryTypePicker({ onPick, onClose }: Props) {
  return (
    <div className="detail">
      <div className="detail-header">
        <h2 className="display">New Entry</h2>
        <button type="button" className="btn btn-ghost ripple" onClick={onClose}>
          ✕ Close
        </button>
      </div>
      <p className="muted">Pick the kind of entry you want to create.</p>
      <div className="type-picker">
        {CARDS.map((c) => (
          <button
            key={c.type}
            type="button"
            className={'type-card ripple' + (c.enabled ? '' : ' disabled')}
            disabled={!c.enabled}
            title={c.enabled ? `New ${c.title}` : 'Coming soon'}
            onClick={() => c.enabled && onPick(c.type)}
          >
            <span className="type-card-icon">{c.icon}</span>
            <span className="type-card-title">{c.title}</span>
            <span className="type-card-blurb">{c.blurb}</span>
            {!c.enabled && <span className="type-card-soon">Coming soon</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

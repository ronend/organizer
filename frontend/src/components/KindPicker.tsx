import type { EventKind } from '../types/organizer';
import { EVENT_KINDS, EVENT_KIND_META } from '../types/organizer';

interface Props {
  onPick: (kind: EventKind) => void;
  onClose: () => void;
}

export default function KindPicker({ onPick, onClose }: Props) {
  return (
    <div className="detail">
      <div className="detail-header">
        <h2 className="display">New Event</h2>
        <button type="button" className="btn btn-ghost ripple" onClick={onClose}>
          ✕ Close
        </button>
      </div>
      <p className="muted">Pick the kind of event. (Kind drives behavior; you set a free-form subtype next.)</p>
      <div className="type-picker">
        {EVENT_KINDS.map((kind) => {
          const meta = EVENT_KIND_META[kind];
          return (
            <button
              key={kind}
              type="button"
              className="type-card ripple"
              title={`New ${meta.label}`}
              onClick={() => onPick(kind)}
            >
              <span className="type-card-icon">{meta.icon}</span>
              <span className="type-card-title">{meta.label}</span>
              <span className="type-card-blurb">{meta.blurb}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

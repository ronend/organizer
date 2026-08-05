import type { EntityType } from '../types/organizer';
import { ENTITY_TYPES, ENTITY_META } from '../types/organizer';
import Icon, { TYPE_ICON } from './Icon';

interface Props {
  onPick: (type: EntityType) => void;
  onClose: () => void;
}

export default function TypePicker({ onPick, onClose }: Props) {
  return (
    <div className="detail">
      <div className="detail-header">
        <h2 className="display">New item</h2>
        <button type="button" className="btn btn-ghost ripple with-icon" onClick={onClose}>
          <Icon name="x" size={14} /> Close
        </button>
      </div>
      <p className="muted">Pick a type. Each type has its own fields.</p>
      <div className="type-picker">
        {ENTITY_TYPES.map((type) => {
          const meta = ENTITY_META[type];
          return (
            <button
              key={type}
              type="button"
              className="type-card ripple"
              title={`New ${meta.label}`}
              onClick={() => onPick(type)}
            >
              <span className="type-card-icon">
                <Icon name={TYPE_ICON[type]} size={28} />
              </span>
              <span className="type-card-title">{meta.label}</span>
              <span className="type-card-blurb">{meta.blurb}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

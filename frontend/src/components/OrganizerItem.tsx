import type { Organizer } from '../types/organizer';

interface Props {
  organizer: Organizer;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
}

export default function OrganizerItem({ organizer, onToggle, onDelete }: Props) {
  return (
    <li className="organizer-item">
      <label className="organizer-label">
        <input
          type="checkbox"
          checked={organizer.done}
          onChange={(e) => onToggle(organizer.id, e.target.checked)}
        />
        <span className={organizer.done ? 'organizer-text done' : 'organizer-text'}>{organizer.text}</span>
      </label>
      <button
        className="organizer-delete"
        aria-label={`Delete ${organizer.text}`}
        onClick={() => onDelete(organizer.id)}
      >
        ✕
      </button>
    </li>
  );
}

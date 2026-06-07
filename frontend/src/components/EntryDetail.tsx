import type { EntryType, NewOrganizer, Organizer } from '../types/organizer';
import TaskForm from './TaskForm';
import RecurringForm from './RecurringForm';
import TripForm from './TripForm';

export interface EntryFormProps {
  item: Organizer | null; // null = add mode
  knownTags: string[];
  allEntries: Organizer[]; // for the "Depends on" picker (Task)
  defaultTags: string[]; // pre-seed when adding from a tag tab
  onSave: (data: NewOrganizer) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}

interface Props extends EntryFormProps {
  addType: EntryType; // type chosen in the picker (add mode)
}

/** Routes to the per-type form. */
export default function EntryDetail({ addType, ...props }: Props) {
  const type: EntryType = props.item ? props.item.type : addType;
  if (type === 'recurring') return <RecurringForm {...props} />;
  if (type === 'trip') return <TripForm {...props} />;
  return <TaskForm {...props} />;
}

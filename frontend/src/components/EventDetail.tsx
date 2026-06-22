import type { EventDocument, EventKind, NewEvent } from '../types/organizer';
import EventForm from './EventForm';

export interface EventFormProps {
  item: EventDocument | null; // null = add mode
  addKind: EventKind; // kind chosen in the picker (add mode)
  knownTags: string[];
  defaultTags: string[]; // pre-seed when adding from a tag tab
  onSave: (data: NewEvent) => Promise<void>;
  onDelete?: () => void;
  onClose: () => void;
}

/** Single comprehensive editor for every event kind. */
export default function EventDetail(props: EventFormProps) {
  return <EventForm {...props} />;
}

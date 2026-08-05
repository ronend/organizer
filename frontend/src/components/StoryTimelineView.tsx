import type { Entity, Story } from '../types/organizer';
import { entityDate } from '../types/organizer';
import { storyTimeline } from '../lib/derive';
import { formatDate } from '../lib/dates';
import Icon, { TYPE_ICON } from './Icon';

interface Props {
  story: Story;
  allItems: Entity[];
  onOpen: (id: string) => void;
}

/** Chronological timeline of a story's reservations and events. */
export default function StoryTimelineView({ story, allItems, onOpen }: Props) {
  const timeline = storyTimeline(allItems, story);
  return (
    <div className="story-timeline">
      <h3 className="display">Timeline</h3>
      {timeline.length === 0 ? (
        <p className="empty">No reservations or events on this story yet.</p>
      ) : (
        <ol className="timeline-rail">
          {timeline.map((e) => (
            <li key={e.id} className="timeline-node ripple" onClick={() => onOpen(e.id)}>
              <span className="timeline-dot" aria-hidden>
                <Icon name={TYPE_ICON[e.type]} size={14} />
              </span>
              <div className="timeline-body">
                <span className="item-title">{e.title || '(untitled)'}</span>
                <span className="item-meta">
                  <span className="badge tag">{e.type === 'reservation' ? e.subtype : e.type}</span>
                  <span className="item-due">{formatDate(entityDate(e)) || 'No date'}</span>
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Organizer } from '../types/organizer';
import { labelize } from '../types/organizer';
import { formatDue, dueUrgency } from '../lib/dates';
import { describeRecurrence } from '../lib/recurrence';

interface Props {
  items: Organizer[]; // already filtered + sorted by due date
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
}

function TypeIcon({ item }: { item: Organizer }) {
  if (item.type === 'recurring') return <span className="entry-icon">🔄</span>;
  return <span className="entry-icon">✅</span>;
}

export default function EntryList({ items, selectedId, onSelect, onToggleDone }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  // Which item ids have been revealed. Kept in React state (NOT via classList)
  // so re-renders — e.g. selecting a row — don't wipe the class.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;

    if (!('IntersectionObserver' in window)) {
      setRevealed((prev) => {
        const next = new Set(prev);
        items.forEach((i) => next.add(i.id));
        return next;
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        const adds: string[] = [];
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.id;
            if (id) adds.push(id);
            obs.unobserve(entry.target);
          }
        });
        if (adds.length) {
          setRevealed((prev) => {
            const next = new Set(prev);
            adds.forEach((a) => next.add(a));
            return next;
          });
        }
      },
      { root: ul.parentElement, rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    ul.querySelectorAll<HTMLElement>('.item-row').forEach((r) => observer.observe(r));
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) {
    return <p className="empty">No entries here.</p>;
  }

  return (
    <ul className="item-list" ref={listRef}>
      {items.map((item, i) => {
        const urgency = dueUrgency(item);
        const contactCount = item.contacts?.length ?? 0;
        const reminderCount = item.reminders?.length ?? 0;
        return (
          <li
            key={item.id}
            data-id={item.id}
            className={
              'item-row reveal ripple' +
              (revealed.has(item.id) ? ' in' : '') +
              (item.id === selectedId ? ' selected' : '') +
              (item.done ? ' done' : '')
            }
            style={{ transitionDelay: `${Math.min(i, 14) * 35}ms` }}
            onClick={() => onSelect(item.id)}
          >
            <input
              type="checkbox"
              checked={item.done}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onToggleDone(item.id, e.target.checked)}
            />
            <div className="item-main">
              <span className="item-title">
                <TypeIcon item={item} />
                {item.title || '(untitled)'}
              </span>
              <span className="item-meta">
                {item.tags?.map((t) => (
                  <span key={t} className="badge tag">
                    {labelize(t)}
                  </span>
                ))}
                {item.type === 'recurring' && item.recurrence && (
                  <span className="badge routine">{describeRecurrence(item.recurrence)}</span>
                )}
                {item.type === 'recurring' && reminderCount > 0 && (
                  <span className="badge reminder" title="Reminders">
                    🔔 {reminderCount}
                  </span>
                )}
                {item.link && (
                  <span className="badge link" title="Has a link">
                    🔗
                  </span>
                )}
                {contactCount > 0 && (
                  <span className="badge contact" title="Contacts">
                    👤 {contactCount}
                  </span>
                )}
                {item.isPrereq && <span className="badge prereq">reminder</span>}
                <span className={`item-due ${urgency}`}>{formatDue(item)}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

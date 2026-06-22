import { useEffect, useRef, useState } from 'react';
import type { EventDocument } from '../types/organizer';
import { EVENT_KIND_META, labelize } from '../types/organizer';
import { formatDate, formatRange, dateUrgency } from '../lib/dates';
import { describeRRule } from '../lib/recurrence';

interface Props {
  items: EventDocument[]; // already filtered + sorted
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
}

function isDone(e: EventDocument): boolean {
  return e.status === 'done' || e.status === 'cancelled';
}

export default function EventList({ items, selectedId, onSelect, onToggleDone }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
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
    return <p className="empty">No events here.</p>;
  }

  return (
    <ul className="item-list" ref={listRef}>
      {items.map((event, i) => {
        const meta = EVENT_KIND_META[event.kind];
        const urgency = dateUrgency(event);
        const itemCount = event.items.length;
        const reminderCount =
          event.reminders.length + event.items.reduce((n, it) => n + it.reminders.length, 0);
        const checklistItems = event.checklists.reduce((n, c) => n + c.items.length, 0);
        const dateLabel =
          event.kind === 'container'
            ? formatRange(event.start_date, event.end_date)
            : event.start_date
              ? formatDate(event.start_date)
              : 'No date';
        return (
          <li
            key={event.id}
            data-id={event.id}
            className={
              'item-row reveal ripple' +
              (revealed.has(event.id) ? ' in' : '') +
              (event.id === selectedId ? ' selected' : '') +
              (isDone(event) ? ' done' : '')
            }
            style={{ transitionDelay: `${Math.min(i, 14) * 35}ms` }}
            onClick={() => onSelect(event.id)}
          >
            <input
              type="checkbox"
              checked={isDone(event)}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onToggleDone(event.id, e.target.checked)}
            />
            <div className="item-main">
              <span className="item-title">
                <span className="entry-icon">{meta.icon}</span>
                {event.title || '(untitled)'}
              </span>
              <span className="item-meta">
                {event.subtype && <span className="badge routine">{event.subtype}</span>}
                {event.tags.map((t) => (
                  <span key={t} className="badge tag">
                    {labelize(t)}
                  </span>
                ))}
                {event.recurrence_rule && (
                  <span className="badge routine">{describeRRule(event.recurrence_rule)}</span>
                )}
                {itemCount > 0 && (
                  <span className="badge contact" title="Items">
                    📋 {itemCount}
                  </span>
                )}
                {reminderCount > 0 && (
                  <span className="badge reminder" title="Reminders">
                    🔔 {reminderCount}
                  </span>
                )}
                {checklistItems > 0 && (
                  <span className="badge contact" title="Checklist items">
                    ✔️ {checklistItems}
                  </span>
                )}
                <span className={`item-due ${urgency}`}>{dateLabel}</span>
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

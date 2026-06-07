import { useEffect, useRef, useState } from 'react';
import type { Organizer } from '../types/organizer';
import { formatDue, isOverdue } from '../lib/dates';

interface Props {
  items: Organizer[]; // already filtered + sorted by due date
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleDone: (id: string, done: boolean) => void;
}

export default function ItemList({ items, selectedId, onSelect, onToggleDone }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  // Which item ids have been revealed. Kept in React state (NOT via
  // classList) so re-renders — e.g. selecting a row — don't wipe the class.
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
    return <p className="empty">No items here.</p>;
  }

  return (
    <ul className="item-list" ref={listRef}>
      {items.map((item, i) => (
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
            <span className="item-title">{item.title || '(untitled)'}</span>
            <span className="item-meta">
              <span className={`badge cat-${item.category}`}>{item.category}</span>
              <span className={isOverdue(item) ? 'item-due overdue' : 'item-due'}>
                {formatDue(item)}
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

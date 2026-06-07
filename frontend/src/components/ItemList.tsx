import { useEffect, useRef } from 'react';
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

  // Scroll-triggered reveal: rows fade/slide in as they enter the scroll area.
  useEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const rows = Array.from(ul.querySelectorAll<HTMLElement>('.item-row'));

    if (!('IntersectionObserver' in window)) {
      rows.forEach((r) => r.classList.add('in'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            obs.unobserve(entry.target);
          }
        });
      },
      { root: ul.parentElement, rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    );
    rows.forEach((r) => observer.observe(r));
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
          className={
            'item-row reveal ripple' +
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

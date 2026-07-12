import { useMemo, useState } from 'react';
import type { EventDocument } from '../types/organizer';
import { EVENT_KIND_META, labelize } from '../types/organizer';
import {
  deriveTimeline,
  timelineDay,
  timelineDays,
  type TimelineEntry,
} from '../lib/derive';
import { formatDayHeading, formatTime, isPastDay } from '../lib/dates';
import { describeRRule } from '../lib/recurrence';

interface Props {
  events: EventDocument[];
  query: string;
  selectedId: string | null;
  onOpenEvent: (id: string) => void;
  onReschedule: (eventId: string, entry: TimelineEntry, day: string) => void;
}

/**
 * A single chronological agenda over every dated event and reminder, grouped by
 * day. Rows are draggable between day buckets to update their date/time.
 */
export default function TimelineView({
  events,
  query,
  selectedId,
  onOpenEvent,
  onReschedule,
}: Props) {
  const [dragging, setDragging] = useState<TimelineEntry | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  const entries = useMemo(() => {
    const all = deriveTimeline(events);
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (e) =>
        e.title.toLowerCase().includes(q) ||
        e.eventTitle.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [events, query]);

  const days = useMemo(() => timelineDays(entries), [entries]);
  const byDay = useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const e of entries) {
      const key = timelineDay(e);
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    return map;
  }, [entries]);

  function drop(day: string) {
    if (dragging) onReschedule(dragging.eventId, dragging, day);
    setDragging(null);
    setOverDay(null);
  }

  if (entries.length === 0 && !query) {
    return <p className="empty">Nothing scheduled yet. Add an event with a date to see it here.</p>;
  }

  return (
    <div className="timeline">
      {days.map((day) => {
        const rows = byDay.get(day) ?? [];
        const past = isPastDay(day);
        return (
          <section
            key={day}
            className={
              'tl-day' + (overDay === day ? ' over' : '') + (past ? ' past' : '')
            }
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOverDay(day);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setOverDay(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(day);
            }}
          >
            <div className="tl-day-head">
              <span className="tl-day-name">{formatDayHeading(day)}</span>
              {rows.length > 0 && <span className="tl-day-count">{rows.length}</span>}
              {past && rows.length > 0 && <span className="tl-day-flag">overdue</span>}
            </div>
            {rows.length === 0 ? (
              <p className="tl-empty">Drop here to schedule</p>
            ) : (
              <ul className="tl-list">
                {rows.map((entry) => {
                  const meta = EVENT_KIND_META[entry.kind];
                  const done = entry.status === 'done' || entry.status === 'cancelled';
                  return (
                    <li
                      key={entry.key}
                      className={
                        'tl-card' +
                        (entry.source === 'reminder' ? ' reminder' : '') +
                        (dragging?.key === entry.key ? ' dragging' : '') +
                        (entry.eventId === selectedId ? ' selected' : '') +
                        (done ? ' done' : '')
                      }
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        setDragging(entry);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOverDay(null);
                      }}
                      onClick={() => onOpenEvent(entry.eventId)}
                    >
                      <span className="tl-grip" aria-hidden>
                        ⠿
                      </span>
                      <span className="tl-time">
                        {entry.hasTime ? formatTime(entry.date) : 'All day'}
                      </span>
                      <span className="tl-body">
                        <span className="tl-title">
                          <span className="tl-icon">
                            {entry.source === 'reminder' ? '🔔' : meta.icon}
                          </span>
                          {entry.title}
                        </span>
                        <span className="tl-sub">
                          {entry.source === 'reminder' && (
                            <span className="tl-context">{entry.eventTitle}</span>
                          )}
                          {entry.tags.map((t) => (
                            <span key={t} className="badge tag">
                              {labelize(t)}
                            </span>
                          ))}
                          {entry.recurrenceRule && (
                            <span className="badge routine">
                              {describeRRule(entry.recurrenceRule)}
                            </span>
                          )}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

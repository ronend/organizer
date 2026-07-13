import { useMemo, useRef, useState } from 'react';
import type { EventDocument } from '../types/organizer';
import { labelize } from '../types/organizer';
import {
  deriveTimeline,
  timelineDay,
  timelineDays,
  type TimelineEntry,
} from '../lib/derive';
import { formatDayHeading, formatTime, isPastDay } from '../lib/dates';
import { describeRRule } from '../lib/recurrence';
import Icon, { KIND_ICON, type IconName } from './Icon';

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
  // A synchronous mirror of `dragging`: drop/dragover fire faster than React
  // commits state, so we read the ref to avoid a stale null.
  const draggingRef = useRef<TimelineEntry | null>(null);

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

  const dated = useMemo(() => entries.filter((e) => e.date), [entries]);
  const undated = useMemo(() => entries.filter((e) => !e.date), [entries]);

  const days = useMemo(() => timelineDays(dated), [dated]);
  const byDay = useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const e of dated) {
      const key = timelineDay(e);
      if (!key) continue;
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    return map;
  }, [dated]);

  function drop(day: string) {
    const entry = draggingRef.current;
    if (entry) onReschedule(entry.eventId, entry, day);
    draggingRef.current = null;
    setDragging(null);
    setOverDay(null);
  }

  function renderCard(entry: TimelineEntry) {
    const done = entry.status === 'done' || entry.status === 'cancelled';
    const iconName: IconName =
      entry.source === 'reminder'
        ? 'bell'
        : entry.source === 'item'
          ? 'check-circle'
          : KIND_ICON[entry.kind];
    const showContext = entry.source !== 'event';
    return (
      <li
        key={entry.key}
        className={
          'tl-card' +
          (entry.source === 'reminder' ? ' reminder' : '') +
          (entry.source === 'item' ? ' item' : '') +
          (dragging?.key === entry.key ? ' dragging' : '') +
          (entry.eventId === selectedId ? ' selected' : '') +
          (done ? ' done' : '')
        }
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          // Some browsers won't start a drag unless data is set.
          e.dataTransfer.setData('text/plain', entry.key);
          draggingRef.current = entry;
          setDragging(entry);
        }}
        onDragEnd={() => {
          draggingRef.current = null;
          setDragging(null);
          setOverDay(null);
        }}
        onClick={() => onOpenEvent(entry.eventId)}
      >
        <span className="tl-grip" aria-hidden>
          <Icon name="grip" size={16} />
        </span>
        <span className="tl-time">
          {entry.date ? (entry.hasTime ? formatTime(entry.date) : 'All day') : 'No date'}
        </span>
        <span className="tl-body">
          <span className="tl-title">
            <span className="tl-icon">
              <Icon name={iconName} size={16} />
            </span>
            {entry.title}
          </span>
          <span className="tl-sub">
            {showContext && <span className="tl-context">{entry.eventTitle}</span>}
            {entry.tags.map((t) => (
              <span key={t} className="badge tag">
                {labelize(t)}
              </span>
            ))}
            {entry.recurrenceRule && (
              <span className="badge routine">{describeRRule(entry.recurrenceRule)}</span>
            )}
          </span>
        </span>
      </li>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="empty">
        {query ? 'Nothing matches your search.' : 'Nothing here yet. Add an event to get started.'}
      </p>
    );
  }

  return (
    <div className="timeline">
      {days.map((day) => {
        const rows = byDay.get(day) ?? [];
        const past = isPastDay(day);
        return (
          <section
            key={day}
            className={'tl-day' + (overDay === day ? ' over' : '') + (past ? ' past' : '')}
            onDragEnter={(e) => {
              if (!draggingRef.current) return;
              e.preventDefault();
              setOverDay(day);
            }}
            onDragOver={(e) => {
              if (!draggingRef.current) return;
              // Must run on every dragover or the browser rejects the drop.
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overDay !== day) setOverDay(day);
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
              <ul className="tl-list">{rows.map(renderCard)}</ul>
            )}
          </section>
        );
      })}

      {undated.length > 0 && (
        <section className="tl-day tl-unscheduled">
          <div className="tl-day-head">
            <span className="tl-day-name">Unscheduled</span>
            <span className="tl-day-count">{undated.length}</span>
            <span className="tl-day-hint">drag onto a day to schedule</span>
          </div>
          <ul className="tl-list">{undated.map(renderCard)}</ul>
        </section>
      )}
    </div>
  );
}

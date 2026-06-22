import type { EventDocument } from '../types/organizer';

/** Local YYYY-MM-DD for a given date (defaults to now). */
export function toDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayStr(): string {
  return toDateStr();
}

export function tomorrowStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateStr(d);
}

/** Parse an ISO date ("2026-07-14") or datetime, as local time. Null if empty. */
export function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const hasTime = value.includes('T');
  const d = new Date(hasTime ? value : `${value}T00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The date an event is "about" — its start_date (used for sorting/Today). */
export function eventEpoch(event: Pick<EventDocument, 'start_date'>): number {
  const d = parseIso(event.start_date ?? null);
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}

/** Sort comparator: earliest start first, undated last. */
export function compareByStart(a: EventDocument, b: EventDocument): number {
  return eventEpoch(a) - eventEpoch(b);
}

function isDoneStatus(status: string): boolean {
  return status === 'done' || status === 'cancelled';
}

/** Past its start date and not done. (Events without a date are never overdue.) */
export function isOverdue(event: EventDocument): boolean {
  const d = parseIso(event.start_date ?? null);
  return !!d && !isDoneStatus(event.status) && d.getTime() < Date.now();
}

export function isToday(event: EventDocument): boolean {
  return !!event.start_date && event.start_date.slice(0, 10) === todayStr();
}

/** Urgency bucket for date styling: red overdue, amber today, muted future. */
export function dateUrgency(event: EventDocument): 'overdue' | 'today' | 'future' | 'none' {
  if (!event.start_date) return 'none';
  if (isOverdue(event)) return 'overdue';
  if (isToday(event)) return 'today';
  return 'future';
}

/** Human-friendly date, e.g. "Jul 14" or "Jul 14, 9:00 AM" if a time is present. */
export function formatDate(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return '';
  const hasTime = !!iso && iso.includes('T');
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(hasTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

/** "Jul 14 – Jul 21" date span (either bound may be missing). */
export function formatRange(a: string | null | undefined, b: string | null | undefined): string {
  const x = formatDate(a);
  const y = formatDate(b);
  if (x && y) return `${x} – ${y}`;
  return x || y || 'No dates';
}

/** Convert a YYYY-MM-DD (+ optional HH:MM) into an ISO datetime string. */
export function combineDateTime(date: string, time: string): string {
  if (!date) return '';
  return time ? `${date}T${time}:00` : `${date}T00:00:00`;
}

/** Split an ISO datetime back into { date, time } for form inputs. */
export function splitDateTime(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const [date, rest] = iso.split('T');
  return { date: date ?? '', time: rest ? rest.slice(0, 5) : '' };
}

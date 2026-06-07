import type { Organizer } from '../types/organizer';

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

/** Combined due date+time as epoch ms (for comparisons). */
export function dueEpoch(item: Pick<Organizer, 'dueDate' | 'dueTime'>): number {
  if (!item.dueDate) return Number.POSITIVE_INFINITY;
  return new Date(`${item.dueDate}T${item.dueTime || '00:00'}`).getTime();
}

/** Sort comparator: earliest due first. Lexicographic on date+time works. */
export function compareByDue(a: Organizer, b: Organizer): number {
  return `${a.dueDate}T${a.dueTime}`.localeCompare(`${b.dueDate}T${b.dueTime}`);
}

/** Past due and not completed. */
export function isOverdue(item: Organizer): boolean {
  return !item.done && dueEpoch(item) < Date.now();
}

export function isToday(item: Organizer): boolean {
  return item.dueDate === todayStr();
}

/** Human-friendly due label, e.g. "Jun 7, 9:00 AM". */
export function formatDue(item: Pick<Organizer, 'dueDate' | 'dueTime'>): string {
  if (!item.dueDate) return 'No due date';
  const d = new Date(`${item.dueDate}T${item.dueTime || '00:00'}`);
  if (Number.isNaN(d.getTime())) return item.dueDate;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

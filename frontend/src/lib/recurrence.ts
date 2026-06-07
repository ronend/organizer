import type { Reminder, Recurrence } from '../types/organizer';
import { toDateStr } from './dates';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function toTimeStr(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function parseDue(dateStr: string, timeStr: string): Date {
  return new Date(`${dateStr}T${timeStr || '00:00'}`);
}

function startOfWeek(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - s.getDay());
  return s;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Next occurrence strictly after `prev`, honoring the recurrence rule.
 * `anchor` aligns interval steps for weekly/monthly rules.
 */
export function nextOccurrence(prev: Date, r: Recurrence, anchor: Date): Date {
  const interval = Math.max(1, Math.floor(r.interval || 1));

  if (r.freq === 'day') {
    const d = new Date(prev);
    d.setDate(d.getDate() + interval);
    return d;
  }

  if (r.freq === 'week') {
    if (r.weekdays && r.weekdays.length) {
      const set = new Set(r.weekdays);
      const anchorWeek = startOfWeek(anchor).getTime();
      const d = new Date(prev);
      for (let i = 0; i < 366; i++) {
        d.setDate(d.getDate() + 1);
        const weeksFromAnchor = Math.round(
          (startOfWeek(d).getTime() - anchorWeek) / (7 * 86400000),
        );
        if (set.has(d.getDay()) && ((weeksFromAnchor % interval) + interval) % interval === 0) {
          return d;
        }
      }
    }
    const d = new Date(prev);
    d.setDate(d.getDate() + 7 * interval);
    return d;
  }

  // month
  const d = new Date(prev);
  if (r.monthDay) {
    d.setMonth(d.getMonth() + interval, 1);
    d.setDate(Math.min(r.monthDay, daysInMonth(d.getFullYear(), d.getMonth())));
    return d;
  }
  d.setMonth(d.getMonth() + interval);
  return d;
}

/** Due date/time of a reminder for an occurrence at `occurrence`. */
export function reminderDue(occurrence: Date, r: Reminder): Date {
  const d = new Date(occurrence);
  d.setDate(d.getDate() - (r.daysBefore || 0));
  return d;
}

export function reminderDueStrings(occurrence: Date, r: Reminder): {
  dueDate: string;
  dueTime: string;
} {
  const d = reminderDue(occurrence, r);
  return { dueDate: toDateStr(d), dueTime: toTimeStr(d) };
}

/** Human-readable cadence, e.g. "Every 3 weeks on Mon, Thu". */
export function describeRecurrence(r: Recurrence | null | undefined): string {
  if (!r) return '';
  const n = Math.max(1, Math.floor(r.interval || 1));
  const unit = r.freq;
  const every = n > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`;
  if (r.freq === 'week' && r.weekdays && r.weekdays.length) {
    const days = [...r.weekdays].sort((a, b) => a - b).map((w) => WEEKDAY_NAMES[w]).join(', ');
    return `${every} on ${days}`;
  }
  if (r.freq === 'month' && r.monthDay) {
    return `${every} on day ${r.monthDay}`;
  }
  return every;
}

export { WEEKDAY_NAMES };

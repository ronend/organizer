// Helpers for the structured habit recurrence rule and routine reminder offsets.
// Mirrors the sub-schemas in backend/src/routes/items.py.

import type { RecurrenceRule, Weekday } from '../types/organizer';
import { WEEKDAYS } from '../types/organizer';

export type RecurrenceFreq = RecurrenceRule['freq'];

const WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

const ORDINAL = ['th', 'st', 'nd', 'rd'];
function ordinal(n: number): string {
  const v = n % 100;
  return n + (ORDINAL[(v - 20) % 10] || ORDINAL[v] || ORDINAL[0]);
}

/** A sensible default rule for a freshly-picked frequency. */
export function defaultRecurrence(freq: RecurrenceFreq): RecurrenceRule {
  switch (freq) {
    case 'daily':
      return { freq: 'daily', interval: 1 };
    case 'weekly':
      return { freq: 'weekly', interval: 1, days: ['mon'] };
    case 'every_n_days':
      return { freq: 'every_n_days', n: 2 };
    case 'monthly':
      return { freq: 'monthly', interval: 1, day_of_month: 1 };
  }
}

/** Human-readable cadence, e.g. "Every 6 weeks on Mon, Wed". */
export function describeRecurrence(rule: RecurrenceRule | null | undefined): string {
  if (!rule) return '';
  const every = (n: number | undefined, unit: string) =>
    (n ?? 1) > 1 ? `Every ${n} ${unit}s` : `Every ${unit}`;
  switch (rule.freq) {
    case 'daily':
      return every(rule.interval, 'day');
    case 'every_n_days':
      return `Every ${rule.n} days`;
    case 'weekly': {
      const days = WEEKDAYS.filter((d) => rule.days.includes(d)).map((d) => WEEKDAY_LABEL[d]);
      return `${every(rule.interval, 'week')}${days.length ? ` on ${days.join(', ')}` : ''}`;
    }
    case 'monthly':
      return `${every(rule.interval, 'month')} on the ${ordinal(rule.day_of_month)}`;
  }
}

// ── Reminder offsets ────────────────────────────────────────────────────────────

const OFFSET_RE = /^([+-]?)(\d+)\s*([smhdw])$/i;
const UNIT_LABEL: Record<string, string> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
};

/** Human-readable offset, e.g. "-30m" → "30 minutes before". */
export function describeOffset(rule: string | null | undefined): string {
  if (rule == null) return '';
  const r = rule.trim().toLowerCase();
  if (r === '0' || r === '+0' || r === '-0') return 'at the time';
  const m = OFFSET_RE.exec(r);
  if (!m) return rule;
  const [, sign, num, unit] = m;
  const n = parseInt(num, 10);
  const label = UNIT_LABEL[unit] + (n === 1 ? '' : 's');
  return `${n} ${label} ${sign === '-' ? 'before' : 'after'}`;
}

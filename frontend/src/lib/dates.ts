/** Calendar-day helpers. ISODate = 'YYYY-MM-DD' in local time; no time zones. */
import type { ISODate, LocalDateTime } from '../types/coo';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): ISODate {
  return toISO(new Date());
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Adds calendar months, clamping to the month's last day (Jan 31 + 1m = Feb 28). */
export function addMonths(s: ISODate, n: number): ISODate {
  const d = parseISO(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: ISODate, b: ISODate): number {
  const ms = parseISO(b).getTime() - parseISO(a).getTime();
  return Math.round(ms / 86_400_000);
}

export function daysFromToday(s: ISODate): number {
  return diffDays(today(), s);
}

export function weekday(s: ISODate): string {
  return DAYS[parseISO(s).getDay()];
}

/** "Nov 8, 2026" (year dropped when `compact` and it is this year). */
export function fmtDate(s: ISODate | null | undefined, compact = false): string {
  if (!s) return '';
  const d = parseISO(s);
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (compact && d.getFullYear() === new Date().getFullYear()) return base;
  return `${base}, ${d.getFullYear()}`;
}

/** "Fri, Dec 4" */
export function fmtDayHeading(s: ISODate): string {
  const d = parseISO(s);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Sunday, November 8" */
export function fmtLongToday(): string {
  const d = new Date();
  return `${DAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;
}

/** Due label for agenda rows. */
export function dueLabel(s: ISODate | null): { text: string; overdue: boolean } {
  if (!s) return { text: 'No date', overdue: false };
  const n = daysFromToday(s);
  if (n < 0) return { text: `${-n} ${-n === 1 ? 'day' : 'days'} overdue`, overdue: true };
  if (n === 0) return { text: 'Today', overdue: false };
  if (n === 1) return { text: 'Tomorrow', overdue: false };
  if (n <= 6) return { text: `${weekday(s)}, ${fmtDate(s, true)}`, overdue: false };
  return { text: fmtDate(s, true), overdue: false };
}

/** "Today", "Tomorrow", "Wed, Nov 11" or "Nov 24" — no overdue wording. */
export function relativeDay(s: ISODate): string {
  const n = daysFromToday(s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n <= 6) return `${weekday(s)}, ${fmtDate(s, true)}`;
  return fmtDate(s, true);
}

export function fmtRange(a: ISODate, b: ISODate, compact = true): string {
  return `${fmtDate(a, compact)} – ${fmtDate(b, compact)}`;
}

export function datePart(dt: LocalDateTime): ISODate {
  return dt.slice(0, 10);
}

export function timePart(dt: LocalDateTime): string {
  return dt.slice(11, 16);
}

export function fmtDateTime(dt: LocalDateTime): string {
  return `${fmtDayHeading(datePart(dt))}, ${timePart(dt)}`;
}

export function age(birthYear: number | null): number | null {
  if (!birthYear) return null;
  return new Date().getFullYear() - birthYear;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning.';
  if (h < 18) return 'Good afternoon.';
  return 'Good evening.';
}

export function nowStamp(): string {
  return new Date().toISOString();
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function inDays(n: number): string {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  return `in ${n} days`;
}

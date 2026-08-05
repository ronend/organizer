// Date/time helpers operating on ISO strings (the entity model stores ISO
// date-times everywhere). No coupling to any entity shape.

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

/** Epoch ms for a date string; +Infinity when absent (so undated sorts last). */
export function epoch(iso: string | null | undefined): number {
  const d = parseIso(iso ?? null);
  return d ? d.getTime() : Number.POSITIVE_INFINITY;
}

/** Past and not done. Undated is never overdue. */
export function isOverdue(iso: string | null | undefined, done = false): boolean {
  const d = parseIso(iso ?? null);
  return !!d && !done && d.getTime() < Date.now();
}

export function isToday(iso: string | null | undefined): boolean {
  return !!iso && iso.slice(0, 10) === todayStr();
}

/** Urgency bucket for date styling. */
export function urgency(
  iso: string | null | undefined,
  done = false,
): 'overdue' | 'today' | 'future' | 'none' {
  if (!iso) return 'none';
  if (isOverdue(iso, done)) return 'overdue';
  if (isToday(iso)) return 'today';
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

/** "Jul 14 – Jul 21" span (either bound may be missing). */
export function formatRange(a: string | null | undefined, b: string | null | undefined): string {
  const x = formatDate(a);
  const y = formatDate(b);
  if (x && y) return `${x} – ${y}`;
  return x || y || 'No dates';
}

/** Just the time part of an ISO value, e.g. "9:00 AM" (empty if date-only). */
export function formatTime(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d || !iso || !iso.includes('T')) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Heading for a day bucket: "Today", "Tomorrow", or "Mon, Jul 14". */
export function formatDayHeading(day: string): string {
  const d = parseIso(day);
  if (!d) return day;
  const key = toDateStr(d);
  if (key === todayStr()) return 'Today';
  if (key === tomorrowStr()) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** The local YYYY-MM-DD an ISO value falls on, or null. */
export function dayOf(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/**
 * Apply a relative offset ("-2h", "-1d", "-30m", "+1d", "0") to an ISO datetime.
 * Mirrors backend/src/recurrence.resolve_offset. Returns null if unparseable.
 */
const OFFSET_RE = /^([+-]?)(\d+)\s*([smhdw])$/i;
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function applyOffset(baseIso: string | null | undefined, offset: string): string | null {
  const base = parseIso(baseIso ?? null);
  if (!base) return null;
  const rule = (offset || '').trim().toLowerCase();
  if (rule === '0' || rule === '+0' || rule === '-0' || rule === '') return isoOf(base);
  const m = OFFSET_RE.exec(rule);
  if (!m) return null;
  const [, sign, num, unit] = m;
  const delta = Number(num) * UNIT_MS[unit];
  return isoOf(new Date(base.getTime() + (sign === '-' ? -delta : delta)));
}

/** Combine a YYYY-MM-DD (+ optional HH:MM) into an ISO datetime string. */
export function combineDateTime(date: string, time: string): string {
  if (!date) return '';
  return time ? `${date}T${time}:00` : `${date}T00:00:00`;
}

/** ISO string without milliseconds, matching the server's format. */
export function isoOf(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

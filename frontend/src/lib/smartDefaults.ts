import type { Reminder, Recurrence } from '../types/organizer';

/**
 * Heuristics that pre-fill a Recurring entry's reminder + cadence from its
 * title. Applied when the user finishes typing the title, and only to fields
 * the user hasn't manually touched.
 */

interface ReminderRule {
  test: RegExp;
  reminder: Reminder;
}

// Order matters: the first matching rule wins.
const REMINDER_RULES: ReminderRule[] = [
  {
    // "biannual teeth check", "ENT appointment", "see the dr"
    test: /\b(appointment|doctor|dr|dentist|dental|teeth|checkup|check-up|exam|physical)\b/i,
    reminder: { label: 'Schedule appointment', daysBefore: 90, note: '' },
  },
  {
    test: /\b(license|licence|passport|renew|renewal|expir)\w*/i,
    reminder: { label: 'Start renewal process', daysBefore: 180, note: '' },
  },
  {
    test: /\b(car|maintenance|service|servicing|oil)\b/i,
    reminder: { label: 'Book service appointment', daysBefore: 30, note: '' },
  },
  {
    test: /\b(medication|medicine|prescription|refill)\b/i,
    reminder: { label: 'Order refill', daysBefore: 5, note: '' },
  },
];

const DEFAULT_REMINDER: Reminder = { label: '', daysBefore: 7, note: '' };

/** Suggested reminder for a title (always returns one row). */
export function suggestReminder(title: string): Reminder {
  const t = title.trim();
  if (!t) return { ...DEFAULT_REMINDER };
  for (const rule of REMINDER_RULES) {
    if (rule.test.test(t)) return { ...rule.reminder };
  }
  return { ...DEFAULT_REMINDER };
}

interface CadenceRule {
  test: RegExp;
  recurrence: Recurrence;
}

// e.g. "biannual teeth check" -> every 6 months; "weekly review" -> every week.
const CADENCE_RULES: CadenceRule[] = [
  { test: /\b(biannual|bi-annual|semi-?annual|twice a year)\b/i, recurrence: { freq: 'month', interval: 6 } },
  { test: /\b(quarterly)\b/i, recurrence: { freq: 'month', interval: 3 } },
  { test: /\b(annual|annually|yearly|every year)\b/i, recurrence: { freq: 'month', interval: 12 } },
  { test: /\b(monthly|every month)\b/i, recurrence: { freq: 'month', interval: 1 } },
  { test: /\b(biweekly|bi-weekly|fortnightly)\b/i, recurrence: { freq: 'week', interval: 2 } },
  { test: /\b(weekly|every week)\b/i, recurrence: { freq: 'week', interval: 1 } },
  { test: /\b(daily|every day)\b/i, recurrence: { freq: 'day', interval: 1 } },
];

/** Suggested cadence for a title, or null if no keyword matched. */
export function suggestCadence(title: string): Recurrence | null {
  const t = title.trim();
  if (!t) return null;
  for (const rule of CADENCE_RULES) {
    if (rule.test.test(t)) return { ...rule.recurrence };
  }
  return null;
}

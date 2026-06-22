// RFC 5545 RRULE + reminder offset_rule helpers (the supported subset mirrors
// backend/src/recurrence.py: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY + INTERVAL).

export type RRuleFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface ParsedRRule {
  freq: RRuleFreq;
  interval: number;
}

/** Build an RRULE string, e.g. buildRRule('MONTHLY', 6) → "RRULE:FREQ=MONTHLY;INTERVAL=6". */
export function buildRRule(freq: RRuleFreq, interval: number): string {
  const n = Math.max(1, Math.floor(interval || 1));
  return n > 1 ? `RRULE:FREQ=${freq};INTERVAL=${n}` : `RRULE:FREQ=${freq}`;
}

export function parseRRule(rule: string | null | undefined): ParsedRRule | null {
  if (!rule) return null;
  const body = rule.includes(':') ? rule.split(':', 2)[1] : rule;
  const parts: Record<string, string> = {};
  for (const chunk of body.split(';')) {
    const [k, v] = chunk.split('=');
    if (k && v) parts[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  const freq = parts.FREQ as RRuleFreq | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const interval = Math.max(1, parseInt(parts.INTERVAL ?? '1', 10) || 1);
  return { freq, interval };
}

const FREQ_UNIT: Record<RRuleFreq, string> = {
  DAILY: 'day',
  WEEKLY: 'week',
  MONTHLY: 'month',
  YEARLY: 'year',
};

/** Human-readable cadence, e.g. "Every 6 months". */
export function describeRRule(rule: string | null | undefined): string {
  const parsed = parseRRule(rule);
  if (!parsed) return '';
  const unit = FREQ_UNIT[parsed.freq];
  return parsed.interval > 1 ? `Every ${parsed.interval} ${unit}s` : `Every ${unit}`;
}

// ── offset_rule ────────────────────────────────────────────────────────────

const OFFSET_RE = /^([+-]?)(\d+)\s*([smhdw])$/i;
const UNIT_LABEL: Record<string, string> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
};

/** Human-readable offset, e.g. "-30d" → "30 days before", "+1d" → "1 day after". */
export function describeOffset(rule: string | null | undefined): string {
  if (rule == null) return '';
  const r = rule.trim().toLowerCase();
  if (r === '0' || r === '+0' || r === '-0') return 'at the time of the event';
  const m = OFFSET_RE.exec(r);
  if (!m) return rule;
  const [, sign, num, unit] = m;
  const n = parseInt(num, 10);
  const label = UNIT_LABEL[unit] + (n === 1 ? '' : 's');
  return `${n} ${label} ${sign === '-' ? 'before' : 'after'}`;
}

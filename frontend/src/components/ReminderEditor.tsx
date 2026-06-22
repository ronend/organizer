import type { Reminder } from '../types/organizer';
import { newLocalId } from '../lib/localId';
import { describeOffset, buildRRule, parseRRule, type RRuleFreq } from '../lib/recurrence';
import { formatDate } from '../lib/dates';
import DateTimeField from './DateTimeField';

interface Props {
  value: Reminder[];
  /** What the offset_rule is relative to (event start_date / item date). */
  relativeToLabel?: string;
  onChange: (next: Reminder[]) => void;
}

// Common relative timings — one tap instead of typing the offset rule.
const OFFSET_PRESETS: { label: string; value: string }[] = [
  { label: '2h', value: '-2h' },
  { label: '1d', value: '-1d' },
  { label: '3d', value: '-3d' },
  { label: '1wk', value: '-1w' },
  { label: '2wk', value: '-2w' },
  { label: '30d', value: '-30d' },
  { label: 'at time', value: '0' },
];

export function newReminder(): Reminder {
  return {
    id: newLocalId(),
    title: '',
    status: 'pending',
    fire_at: '',
    offset_rule: '',
    recurrence_rule: null,
    notes: null,
    url: null,
    login_hint: null,
    attrs: {},
  };
}

const RRULE_OPTIONS: { label: string; value: string }[] = [
  { label: 'Does not repeat', value: '' },
  { label: 'Daily', value: buildRRule('DAILY', 1) },
  { label: 'Weekly', value: buildRRule('WEEKLY', 1) },
  { label: 'Monthly', value: buildRRule('MONTHLY', 1) },
  { label: 'Yearly', value: buildRRule('YEARLY', 1) },
];

export default function ReminderEditor({ value, relativeToLabel, onChange }: Props) {
  function patch(i: number, p: Partial<Reminder>) {
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...p } : r)));
  }

  return (
    <div className="reminders-edit">
      {value.map((r, i) => {
        const parsed = parseRRule(r.recurrence_rule);
        return (
          <div className="reminder-card" key={r.id}>
            <div className="reminder-card-head">
              <input
                className="reminder-title"
                placeholder="Reminder title"
                value={r.title}
                onChange={(e) => patch(i, { title: e.target.value })}
              />
              <button
                type="button"
                className="prereq-del"
                aria-label="Remove reminder"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>

            <div className="field">
              <span>Remind {relativeToLabel ? `(${relativeToLabel})` : ''}</span>
              <div className="offset-presets">
                {OFFSET_PRESETS.map((p) => (
                  <button
                    type="button"
                    key={p.value}
                    className={'dt-chip' + (r.offset_rule === p.value ? ' active' : '')}
                    onClick={() => patch(i, { offset_rule: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
                <input
                  className="offset-input"
                  placeholder="-30d, -2h, +1d, 0"
                  value={r.offset_rule ?? ''}
                  onChange={(e) => patch(i, { offset_rule: e.target.value || null })}
                />
              </div>
              {r.offset_rule ? (
                <small className="muted">
                  {describeOffset(r.offset_rule)} — fire time is computed from this on save.
                </small>
              ) : (
                <small className="muted">Or set an exact fire date &amp; time below.</small>
              )}
            </div>

            <label className="field">
              <span>Fire at (exact)</span>
              <DateTimeField
                value={r.fire_at || null}
                ariaLabel="Reminder fire date and time"
                onChange={(v) => patch(i, { fire_at: v ?? '' })}
              />
            </label>

            <div className="field-row compact">
              <label className="field">
                <span>Repeats</span>
                <select
                  value={parsed ? buildRRule(parsed.freq, 1) : ''}
                  onChange={(e) => patch(i, { recurrence_rule: e.target.value || null })}
                >
                  {RRULE_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {parsed && (
                <label className="field">
                  <span>Every</span>
                  <input
                    type="number"
                    min={1}
                    value={parsed.interval}
                    onChange={(e) =>
                      patch(i, {
                        recurrence_rule: buildRRule(
                          parsed.freq as RRuleFreq,
                          Number(e.target.value) || 1,
                        ),
                      })
                    }
                  />
                </label>
              )}
              <label className="field">
                <span>Status</span>
                <select value={r.status} onChange={(e) => patch(i, { status: e.target.value })}>
                  <option value="pending">Pending</option>
                  <option value="snoozed">Snoozed</option>
                  <option value="done">Done</option>
                  <option value="skipped">Skipped</option>
                </select>
              </label>
            </div>

            <input
              className="reminder-note"
              placeholder="Notes (shown in the notification)"
              value={r.notes ?? ''}
              onChange={(e) => patch(i, { notes: e.target.value || null })}
            />
            <input
              className="reminder-note"
              type="url"
              placeholder="Action URL (optional)"
              value={r.url ?? ''}
              onChange={(e) => patch(i, { url: e.target.value || null })}
            />
          </div>
        );
      })}
      <button type="button" className="seg-btn add" onClick={() => onChange([...value, newReminder()])}>
        + Add reminder
      </button>
    </div>
  );
}

/** Compact one-line summary of a reminder for read views. */
export function reminderSummary(r: Reminder): string {
  const when = r.offset_rule ? describeOffset(r.offset_rule) : formatDate(r.fire_at);
  return [r.title || '(untitled)', when].filter(Boolean).join(' · ');
}

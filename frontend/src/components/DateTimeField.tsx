import { toDateStr, combineDateTime } from '../lib/dates';

interface Props {
  value: string | null;
  onChange: (iso: string | null) => void;
  /** 'datetime' shows date + time; 'date' is date-only (e.g. event start/end). */
  mode?: 'datetime' | 'date';
  /** Time applied by the quick chips in datetime mode. */
  defaultTime?: string;
  ariaLabel?: string;
}

/**
 * Smooth date/time editor: one native control (so both date and time are edited
 * in place) plus quick-pick chips for the common cases. Works directly with ISO
 * strings — onChange emits "YYYY-MM-DD" (date mode) or "YYYY-MM-DDTHH:MM:SS".
 */
export default function DateTimeField({
  value,
  onChange,
  mode = 'datetime',
  defaultTime = '09:00',
  ariaLabel,
}: Props) {
  const isDate = mode === 'date';

  function setRelativeDays(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const date = toDateStr(d);
    onChange(isDate ? date : combineDateTime(date, defaultTime));
  }

  const inputValue = isDate ? value?.slice(0, 10) ?? '' : value?.slice(0, 16) ?? '';

  function handleInput(v: string) {
    if (!v) {
      onChange(null);
      return;
    }
    if (isDate) {
      onChange(v);
      return;
    }
    // datetime-local yields "YYYY-MM-DDTHH:MM" — keep seconds in the stored ISO.
    onChange(v.length >= 16 ? `${v.slice(0, 16)}:00` : v);
  }

  return (
    <div className="dt-field">
      <input
        type={isDate ? 'date' : 'datetime-local'}
        className="dt-input"
        value={inputValue}
        aria-label={ariaLabel}
        onChange={(e) => handleInput(e.target.value)}
      />
      <div className="dt-chips">
        <button type="button" className="dt-chip" onClick={() => setRelativeDays(0)}>
          Today
        </button>
        <button type="button" className="dt-chip" onClick={() => setRelativeDays(1)}>
          Tomorrow
        </button>
        <button type="button" className="dt-chip" onClick={() => setRelativeDays(7)}>
          +1 wk
        </button>
        {value && (
          <button type="button" className="dt-chip clear" onClick={() => onChange(null)}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

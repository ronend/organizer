import type { Attrs } from '../types/organizer';

interface Props {
  value: Attrs;
  onChange: (next: Attrs) => void;
}

type Row = { key: string; value: string };

function toRows(attrs: Attrs): Row[] {
  return Object.entries(attrs).map(([key, v]) => ({
    key,
    value: typeof v === 'string' ? v : JSON.stringify(v),
  }));
}

/** Coerce a string back to a primitive: number, boolean, else string. */
function coerce(v: string): unknown {
  const t = v.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && !Number.isNaN(Number(t))) return Number(t);
  return v;
}

function fromRows(rows: Row[]): Attrs {
  const out: Attrs = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (k) out[k] = coerce(r.value);
  }
  return out;
}

/** Open key/value editor for the `attrs` extension bag (data-structure.md). */
export default function AttrsEditor({ value, onChange }: Props) {
  const rows = toRows(value);

  function update(next: Row[]) {
    onChange(fromRows(next));
  }

  return (
    <div className="attrs">
      {rows.map((row, i) => (
        <div className="attr-row" key={i}>
          <input
            className="attr-key"
            placeholder="key"
            value={row.key}
            onChange={(e) => update(rows.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)))}
          />
          <input
            className="attr-value"
            placeholder="value"
            value={row.value}
            onChange={(e) =>
              update(rows.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)))
            }
          />
          <button
            type="button"
            className="prereq-del"
            aria-label="Remove attribute"
            onClick={() => update(rows.filter((_, idx) => idx !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="seg-btn add" onClick={() => update([...rows, { key: '', value: '' }])}>
        + Add field
      </button>
    </div>
  );
}

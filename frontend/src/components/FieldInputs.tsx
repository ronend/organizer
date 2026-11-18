/**
 * Inputs and display for registry-defined fields (subject attributes,
 * document fields, reservation fields). One component per field type, so a
 * new field in registry.json needs no UI code.
 */
import type { CooState, FieldValue, Fields } from '../types/coo';
import { type FieldDef, fieldText } from '../lib/registry';
import { contactName, contactsTagged, maskId, subjectsOfType } from '../lib/model';
import { fmtDate } from '../lib/dates';
import { Field } from './ui';

function parseNumber(raw: string, integer?: boolean): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return integer ? Math.round(n) : n;
}

/** One input for one field definition. */
export function FieldInput({
  s,
  def,
  value,
  onChange,
  id,
  suggestions,
}: {
  s: CooState;
  def: FieldDef;
  value: FieldValue | undefined;
  onChange: (v: FieldValue) => void;
  id: string;
  /** Values to offer as you type (text fields with `suggest`). */
  suggestions?: string[];
}) {
  const text = value == null ? '' : Array.isArray(value) ? '' : String(value);
  switch (def.type) {
    case 'longtext':
      return <textarea id={id} rows={2} value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'number':
      return (
        <input
          id={id}
          type="number"
          inputMode={def.integer ? 'numeric' : 'decimal'}
          step={def.integer ? 1 : 'any'}
          value={text}
          onChange={(e) => onChange(parseNumber(e.target.value, def.integer))}
        />
      );
    case 'date':
      return <input id={id} type="date" value={text} onChange={(e) => onChange(e.target.value || null)} />;
    case 'boolean':
      return <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />;
    case 'url':
      return <input id={id} type="url" inputMode="url" placeholder="https://" value={text} onChange={(e) => onChange(e.target.value)} />;
    case 'select':
      return (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">—</option>
          {(def.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
    case 'contact':
      return (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">None</option>
          {contactsTagged(s, def.tags).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.role ? ` · ${c.role}` : ''}
            </option>
          ))}
        </select>
      );
    case 'subject':
      return (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">None</option>
          {(def.subjectType ? subjectsOfType(s, def.subjectType) : s.subjects).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      );
    case 'subjects': {
      const chosen = Array.isArray(value) ? value : [];
      const pool = def.subjectType ? subjectsOfType(s, def.subjectType) : s.subjects;
      return (
        <div className="check-list" id={id} role="group" aria-label={def.label}>
          {pool.map((x) => (
            <label key={x.id} className="check-row">
              <input
                type="checkbox"
                checked={chosen.includes(x.id)}
                onChange={(e) => onChange(e.target.checked ? [...chosen, x.id] : chosen.filter((c) => c !== x.id))}
              />
              <span>{x.name}</span>
            </label>
          ))}
          {pool.length === 0 && <span className="muted small">Nothing to choose yet.</span>}
        </div>
      );
    }
    default:
      return (
        <>
          <input
            id={id}
            value={text}
            list={suggestions?.length ? `${id}-list` : undefined}
            autoComplete={def.type === 'secret' ? 'off' : undefined}
            onChange={(e) => onChange(def.normalize === 'plate' ? e.target.value.toUpperCase() : e.target.value)}
          />
          {suggestions?.length ? (
            <datalist id={`${id}-list`}>
              {suggestions.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          ) : null}
        </>
      );
  }
}

/** A labelled input per definition, in a two-column grid. */
export function FieldsEditor({
  s,
  defs,
  values,
  onChange,
  suggestionsFor,
}: {
  s: CooState;
  defs: FieldDef[];
  values: Fields;
  onChange: (next: Fields) => void;
  suggestionsFor?: (key: string) => string[];
}) {
  if (defs.length === 0) return null;
  return (
    <div className="fields wrap">
      {defs.map((d) => (
        <Field key={d.key} label={d.label} optional={!d.required} className={d.type === 'longtext' || d.type === 'subjects' ? 'wide' : ''}>
          {(id) => (
            <FieldInput
              s={s}
              def={d}
              id={id}
              value={values[d.key]}
              suggestions={d.suggest ? suggestionsFor?.(d.key) : undefined}
              onChange={(v) => onChange({ ...values, [d.key]: v })}
            />
          )}
        </Field>
      ))}
    </div>
  );
}

/** A field's value as display text ('' when empty). Secrets are masked unless `full`. */
export function fieldDisplay(s: CooState, def: FieldDef, fields: Fields, full = false): string {
  const v = fields[def.key];
  if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) return '';
  switch (def.type) {
    case 'contact':
      return contactName(s, String(v));
    case 'subject':
      return s.subjects.find((x) => x.id === v)?.name ?? '';
    case 'subjects':
      return (Array.isArray(v) ? v : []).map((i) => s.subjects.find((x) => x.id === i)?.name).filter(Boolean).join(', ');
    case 'date':
      return fmtDate(String(v));
    case 'boolean':
      return v ? 'Yes' : 'No';
    case 'secret':
      return full ? String(v) : maskId(String(v));
    default:
      return fieldText(fields, def.key);
  }
}

/** Problems with required / unique fields, for a form to show before saving. */
export function fieldProblems(defs: FieldDef[], values: Fields, others: Fields[]): string[] {
  const out: string[] = [];
  const norm = (d: FieldDef, v: FieldValue | undefined) =>
    typeof v === 'string' ? (d.normalize === 'plate' ? v.toUpperCase().replace(/[^A-Z0-9]/g, '') : v.trim().toLowerCase()) : v;
  for (const d of defs) {
    const v = values[d.key];
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0);
    if (d.required && empty) out.push(`${d.label} is required`);
    if (d.unique && !empty && others.some((o) => norm(d, o[d.key]) === norm(d, v))) out.push(`That ${d.label.toLowerCase()} is already used`);
  }
  return out;
}

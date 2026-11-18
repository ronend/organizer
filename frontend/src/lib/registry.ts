/**
 * The registry — which subjects exist, what they can hold, and every field
 * definition. `registry.json` is a verbatim copy of backend/src/registry.json
 * (the backend's tests fail if they drift); edit the backend file and copy it
 * here. See data-structure.md.
 */
import data from './registry.json';
import type { DocCategory, FieldValue, Fields, ReservationType, RoutineArea, Subject, SubjectType, SubjectTypeRecord } from '../types/coo';

export type FieldType =
  | 'text' | 'secret' | 'longtext' | 'url' | 'number' | 'date' | 'boolean' | 'select'
  | 'contact' | 'subject' | 'subjects';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  integer?: boolean;
  options?: string[];
  /** contact fields: contacts with one of these tags. */
  tags?: string[];
  /** subject(s) fields: subjects of this type. */
  subjectType?: SubjectType;
  normalize?: 'plate';
  /** Offer values already used on other records (e.g. health episodes). */
  suggest?: boolean;
  deprecated?: boolean;
}

export type ObjectKind = 'task' | 'document' | 'assignment' | 'reservation';

export interface SubjectTypeInfo {
  /** Label of the name input, e.g. "Make and model". */
  nameLabel: string;
  namePlaceholder: string;
  label: string;
  plural: string;
  icon: string;
  attributes: FieldDef[];
  allows: ObjectKind[];
  documentCategories: DocCategory[];
  routineAreas: RoutineArea[];
  rules: { rule: 'dateOrder'; fields: [string, string] }[];
  /** Defined by the household (not built in). */
  custom?: boolean;
}

export interface CategoryRules {
  replaceOnLink: boolean;
  expiryDrivesRoutine: boolean;
  onePerType: boolean;
  onePerTypeExempt: string[];
  renewal: { remindDays: Record<string, number>; defaultRemindDays: number } | null;
}

export interface Category {
  label: string;
  /** Short label for filters, e.g. "IDs". */
  short: string;
  plural: string;
  icon: string;
  area: RoutineArea | null;
  expiring: boolean;
  /** Label of the expiry input, e.g. "Expiry date". */
  expiryLabel: string;
  /** Label of the document date input. */
  dateLabel: string;
  types: string[];
  defaultType: string;
  datedByDefault: boolean;
  fileRoles: string[];
  fields: FieldDef[];
  typeFields: Record<string, FieldDef[]>;
  typeAliases: Record<string, string>;
  pin: { label: string; default: boolean };
  /** Heading of the pinned documents section, e.g. "In the glovebox". */
  pinnedTitle: string;
  rules: CategoryRules;
}

const BUILT_IN = data.subjectTypes as unknown as Record<SubjectType, SubjectTypeInfo>;

/**
 * Built-in subject types plus the household's own (see applyCustomSubjectTypes).
 * Mutated in place when the household's types load, so every lookup sees them.
 */
export const SUBJECT_TYPES: Record<SubjectType, SubjectTypeInfo> = { ...BUILT_IN };

export function subjectTypeKeys(): SubjectType[] {
  return Object.keys(SUBJECT_TYPES);
}

/** Makes the household's own subject types part of the registry (called when state loads). */
export function applyCustomSubjectTypes(records: SubjectTypeRecord[]) {
  for (const k of Object.keys(SUBJECT_TYPES)) if (!(k in BUILT_IN)) delete SUBJECT_TYPES[k];
  for (const r of records) {
    if (r.archived || r.id in BUILT_IN) continue;
    SUBJECT_TYPES[r.id] = {
      label: r.label, plural: r.plural, nameLabel: r.nameLabel || 'Name', namePlaceholder: r.namePlaceholder ?? '',
      icon: r.icon || 'document', attributes: r.attributes ?? [], allows: r.allows ?? [],
      documentCategories: r.documentCategories ?? [], routineAreas: r.routineAreas ?? [], rules: r.rules ?? [], custom: true,
    };
  }
}
export const CATEGORIES = data.documentCategories as unknown as Record<DocCategory, Category>;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as DocCategory[];
export const RESERVATION_TYPES = data.reservationTypes as Record<ReservationType, { label: string; icon: string }>;
export const RESERVATION_FIELDS = data.reservationFields as FieldDef[];
export const ROUTINE_AREAS = data.routineAreas as Record<RoutineArea, { label: string; icon: string }>;

export function subjectType(t: SubjectType): SubjectTypeInfo {
  return SUBJECT_TYPES[t];
}

export function category(kind: DocCategory): Category {
  return CATEGORIES[kind];
}

/** A category's fields plus those of the given type (the type's win on a clash). */
export function categoryFields(kind: DocCategory, type: string | null | undefined): FieldDef[] {
  const c = CATEGORIES[kind];
  const out = new Map(c.fields.map((f) => [f.key, f]));
  for (const f of c.typeFields[type ?? ''] ?? []) out.set(f.key, f);
  return [...out.values()].filter((f) => !f.deprecated);
}

/** Fields that belong to the type only (e.g. a passport's nationality). */
export function typeFields(kind: DocCategory, type: string): FieldDef[] {
  return (CATEGORIES[kind].typeFields[type] ?? []).filter((f) => !f.deprecated);
}

export function remindDefault(kind: DocCategory, type: string): number {
  const r = CATEGORIES[kind].rules.renewal;
  return r ? (r.remindDays[type] ?? r.defaultRemindDays) : 90;
}

export function allows(t: SubjectType, kind: ObjectKind): boolean {
  return SUBJECT_TYPES[t].allows.includes(kind);
}

// ── values ──────────────────────────────────────────────────────────────────

export function fieldText(fields: Fields, key: string): string {
  const v = fields[key];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

export function fieldNumber(fields: Fields, key: string): number | null {
  const v = fields[key];
  return typeof v === 'number' ? v : null;
}

export function fieldList(fields: Fields, key: string): string[] {
  const v = fields[key];
  return Array.isArray(v) ? v : [];
}

/** Drops empty values; stored records only keep what's filled in. */
export function compactFields(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v as FieldValue;
  }
  return out;
}

export function attr(sub: Subject, key: string): string {
  return fieldText(sub.attributes, key);
}

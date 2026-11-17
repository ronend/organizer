/**
 * The subject and document registry — which subjects exist and which documents
 * each can hold. `registry.json` is a verbatim copy of backend/src/registry.json
 * (the backend's contract test fails if they drift); edit the backend file and
 * copy it here.
 */
import data from './registry.json';
import type { DocKind, SubjectType } from '../types/coo';

export interface Category {
  label: string;
  /** Short label for filters, e.g. "IDs". */
  short: string;
  plural: string;
  icon: string;
  area: string;
  types: string[];
  defaultType: string;
  /** Document fields this category uses (see backend/src/documents.py FEATURE_FIELDS). */
  features: string[];
  /** Suggested detail rows per type. */
  detailFields: Record<string, string[]>;
  typeAliases: Record<string, string>;
  providerGroups?: string[];
  pin: { label: string; default: boolean };
  replaceOnLink: boolean;
  expiryDrivesRoutine: boolean;
  onePerType: boolean;
  onePerTypeExempt: string[];
  renewal: { remindDays: Record<string, number>; defaultRemindDays: number } | null;
}

export interface SubjectTypeInfo {
  label: string;
  plural: string;
  collection: string;
  nameField: string;
  icon: string;
  categories: DocKind[];
}

export const SUBJECT_TYPES = data.subjectTypes as Record<SubjectType, SubjectTypeInfo>;
export const CATEGORIES = data.categories as Record<DocKind, Category>;
export const CATEGORY_KEYS = Object.keys(CATEGORIES) as DocKind[];

export function category(kind: DocKind): Category {
  return CATEGORIES[kind];
}

export function remindDefault(kind: DocKind, type: string): number {
  const r = CATEGORIES[kind].renewal;
  return r ? (r.remindDays[type] ?? r.defaultRemindDays) : 90;
}

export function detailFields(kind: DocKind, type: string): string[] {
  return CATEGORIES[kind].detailFields[type] ?? [];
}

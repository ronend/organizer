// New subdocuments (items, reminders, checklists, attachments) get a temporary
// local id so React has a stable key while editing. On save, temp ids are
// stripped to null so the server assigns canonical prefixed ids (itm_, rem_, …).

let seq = 0;

export function newLocalId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${seq++}`;
  return `tmp_${rand}`;
}

export function isLocalId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('tmp_');
}

/** Replace temp ids with null (so the server assigns real ids) recursively. */
export function stripLocalIds<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripLocalIds(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'id' && isLocalId(v as string)) {
        out[k] = null;
      } else {
        out[k] = stripLocalIds(v);
      }
    }
    return out as T;
  }
  return value;
}

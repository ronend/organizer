/**
 * Local mock backend (VITE_LOCAL_MOCK=1). Persists to localStorage so the UI
 * can be exercised without AWS. Files are kept as data URLs.
 */
import type { ChangeSet, CooState, Document, Entity, EntityKind, FileRef } from '../types/coo';
import type { SaveDocumentRequest, SaveDocumentResult } from './client';
import { Tx, makeDocument, renewalRoutineForId, saveDocument } from '../lib/ops';
import { category, remindDefault } from '../lib/registry';

const STATE_KEY = 'coo.mock.state';
const FILE_PREFIX = 'coo.mock.file.';

type Store = Record<string, Entity>;

function load(): Store {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
  } catch {
    return {};
  }
}

function save(store: Store) {
  localStorage.setItem(STATE_KEY, JSON.stringify(store));
}

const COLLECTION: Record<EntityKind, keyof CooState> = {
  person: 'people',
  car: 'cars',
  contact: 'contacts',
  routine: 'routines',
  assignment: 'assignments',
  task: 'tasks',
  document: 'documents',
  trip: 'trips',
  reservation: 'reservations',
};

const delay = () => new Promise((r) => setTimeout(r, 60));

export async function mockState(): Promise<CooState> {
  await delay();
  const state: CooState = {
    people: [], cars: [], contacts: [], routines: [], assignments: [],
    tasks: [], documents: [], trips: [], reservations: [],
  };
  for (const e of Object.values(load())) {
    (state[COLLECTION[e.kind]] as Entity[]).push(e);
  }
  return state;
}

export async function mockBatch(cs: ChangeSet): Promise<void> {
  await delay();
  const store = load();
  const now = new Date().toISOString();
  for (const e of cs.put) store[`${e.kind}#${e.id}`] = { ...e, updatedAt: now };
  for (const d of cs.delete) delete store[`${d.kind}#${d.id}`];
  save(store);
}

/**
 * Mock of POST /api/documents. Uses the app's own document ops, so it covers
 * the common rules (archive on link, close tasks, renewal reminders, expiry
 * edits) but not the server's validation; the real rules live in
 * backend/src/documents.py.
 */
export async function mockSaveDocument(req: SaveDocumentRequest): Promise<SaveDocumentResult> {
  const s = await mockState();
  // Drop unset fields (as JSON does for the real API), so `id: undefined`
  // can't override a new document's generated id.
  const f = Object.fromEntries(Object.entries(req.document).filter(([, v]) => v !== undefined)) as SaveDocumentRequest['document'];
  const prev = f.id ? s.documents.find((d) => d.id === f.id) : undefined;
  let d: Document;
  if (prev) {
    d = { ...prev, ...f } as Document;
  } else {
    if (!f.docKind || !f.subjectType || !f.subjectId) throw new Error('A new document needs subjectType, subjectId, docKind');
    const cat = category(f.docKind);
    d = makeDocument({
      ...f,
      docKind: f.docKind,
      subjectType: f.subjectType,
      subjectId: f.subjectId,
      name: (f.name ?? '').trim(),
      type: f.type || cat.defaultType,
      pinned: f.pinned ?? cat.pin.default,
      date: f.date !== undefined ? f.date : cat.features.includes('date') ? (req.today ?? null) : null,
    });
  }
  if (!d.name.trim()) throw new Error('A document needs a name');
  const tx = new Tx(s);
  const summary: SaveDocumentResult['summary'] = {};
  if (req.renewal && !d.assignmentId && d.validUntil) {
    const { assignment, firstDate } = renewalRoutineForId(s, d, req.renewal.remindDays ?? remindDefault(d.docKind, d.type), tx);
    d = { ...d, assignmentId: assignment.id };
    summary.remindersPlannedFrom = firstDate;
  }
  const archivedBefore = new Set(s.documents.filter((o) => o.archived).map((o) => o.id));
  const changes = saveDocument(s, d, { closeTaskId: req.closeTaskId }, tx);
  const archived = changes.put.filter((e): e is Document => e.kind === 'document' && e.id !== d.id && e.archived && !archivedBefore.has(e.id));
  if (archived.length) summary.archivedOlder = archived.map((o) => o.name);
  await mockBatch(changes);
  const now = new Date().toISOString();
  const stamped = { ...changes, put: changes.put.map((e) => ({ ...e, updatedAt: now })) };
  return { document: stamped.put.find((e) => e.kind === 'document' && e.id === d.id) as Document, changes: stamped, summary };
}

export async function mockUpload(file: Blob, name: string, contentType: string): Promise<FileRef> {
  const key = `u/mock/${crypto.randomUUID()}/${name.replace(/[^\w.-]+/g, '_')}`;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  try {
    localStorage.setItem(FILE_PREFIX + key, dataUrl);
  } catch {
    throw new Error('Mock storage is full (localStorage). Use smaller files locally.');
  }
  return { key, name, contentType, size: file.size };
}

export async function mockUrls(keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = localStorage.getItem(FILE_PREFIX + k);
    if (v) out[k] = v;
  }
  return out;
}

/** The mock can't fetch other sites; it makes up a readable title from the URL. */
export async function mockLinkTitle(url: string): Promise<string | null> {
  await delay();
  try {
    const u = new URL(url);
    const slug = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const words = slug.replace(/\.[a-z]+$/i, '').replace(/[-_]+/g, ' ').trim();
    const site = u.hostname.replace(/^www\./, '');
    if (!words) return site;
    return `${words[0].toUpperCase()}${words.slice(1)} · ${site}`;
  } catch {
    return null;
  }
}

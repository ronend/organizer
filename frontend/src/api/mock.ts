/**
 * Local mock backend (VITE_LOCAL_MOCK=1). Persists to localStorage so the UI
 * can be exercised without AWS. Files are kept as data URLs.
 */
import type { ChangeSet, CooState, Entity, EntityKind, FileRef } from '../types/coo';

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

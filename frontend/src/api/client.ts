/**
 * All calls to /api/*. Same origin via CloudFront — no CORS. Every request
 * carries the Cognito access token; a 401 clears it and sends the user to login.
 *
 * With VITE_LOCAL_MOCK=1 (npm run dev:mock) the calls are served by an
 * in-browser mock backed by localStorage instead (no AWS, no login).
 */
import type { ChangeSet, CooState, FileRef } from '../types/coo';

const BASE_URL = '/api';
export const MOCK = import.meta.env.VITE_LOCAL_MOCK === '1';

let tokenGetter: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

export function configureApiClient(getter: () => string | null, unauthorized: () => void) {
  tokenGetter = getter;
  onUnauthorized = unauthorized;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenGetter();
  if (!token) {
    onUnauthorized();
    throw new Error('Not authenticated');
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    onUnauthorized();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? '');
    } catch {
      /* non-JSON body */
    }
    throw new Error(detail || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function mock() {
  return import('./mock');
}

export async function fetchState(): Promise<CooState> {
  if (MOCK) return (await mock()).mockState();
  return request<CooState>('/state');
}

export async function sendBatch(changes: ChangeSet): Promise<void> {
  if (changes.put.length === 0 && changes.delete.length === 0) return;
  if (MOCK) return (await mock()).mockBatch(changes);
  // The API caps a batch at 500 operations; split larger change sets.
  const ops = [
    ...changes.put.map((e) => ({ put: e })),
    ...changes.delete.map((d) => ({ del: d })),
  ];
  for (let i = 0; i < ops.length; i += 400) {
    const chunk = ops.slice(i, i + 400);
    await request('/batch', {
      method: 'POST',
      body: JSON.stringify({
        put: chunk.flatMap((o) => ('put' in o ? [o.put] : [])),
        delete: chunk.flatMap((o) => ('del' in o ? [o.del] : [])),
      }),
    });
  }
}

/** Uploads a file to the user's private S3 prefix and returns its reference. */
export async function uploadFile(file: Blob, name: string): Promise<FileRef> {
  const contentType = file.type || 'application/octet-stream';
  if (MOCK) return (await mock()).mockUpload(file, name, contentType);
  const { file: ref, uploadUrl } = await request<{ file: FileRef; uploadUrl: string }>(
    '/files/upload-url',
    { method: 'POST', body: JSON.stringify({ name, contentType, size: file.size }) },
  );
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  return ref;
}

/** Short-lived download URLs for file keys. */
export async function fileUrls(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {};
  if (MOCK) return (await mock()).mockUrls(keys);
  const out: Record<string, string> = {};
  for (let i = 0; i < keys.length; i += 100) {
    const { urls } = await request<{ urls: Record<string, string> }>('/files/urls', {
      method: 'POST',
      body: JSON.stringify({ keys: keys.slice(i, i + 100) }),
    });
    Object.assign(out, urls);
  }
  return out;
}

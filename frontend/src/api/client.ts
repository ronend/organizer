import type { NewOrganizer, Organizer } from '../types/organizer';

const BASE_URL = '/api';

/**
 * The AuthContext wires these in at app startup so this module (which is not a
 * React component) can read the current token and trigger login/logout.
 */
let tokenGetter: () => string | null = () => null;
let onUnauthorized: () => void = () => {};

export function configureApiClient(getter: () => string | null, unauthorized: () => void) {
  tokenGetter = getter;
  onUnauthorized = unauthorized;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenGetter();
  if (!token) {
    // No valid token — bounce to login and stop.
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
    throw new Error(`Request failed: ${res.status}`);
  }
  // DELETE may return an empty body.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function getOrganizers(): Promise<Organizer[]> {
  return request<Organizer[]>('/organizers');
}

export function createOrganizer(data: NewOrganizer): Promise<Organizer> {
  return request<Organizer>('/organizers', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateOrganizer(
  id: string,
  updates: Partial<NewOrganizer>,
): Promise<Organizer> {
  return request<Organizer>(`/organizers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function deleteOrganizer(id: string): Promise<void> {
  return request<void>(`/organizers/${id}`, { method: 'DELETE' });
}

/** Atomically complete a routine occurrence; backend spawns the next one + prereqs. */
export function completeRoutine(id: string): Promise<{ created: Organizer[] }> {
  return request<{ created: Organizer[] }>(`/organizers/${id}/complete`, { method: 'POST' });
}

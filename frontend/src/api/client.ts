import type { Entity, EntityType, NewEntity, EntityUpdate } from '../types/organizer';

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
    // Surface the server's validation detail when present.
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

// ── Items ──────────────────────────────────────────────────────────────────────

export function getItems(type?: EntityType): Promise<Entity[]> {
  const qs = type ? `?type=${encodeURIComponent(type)}` : '';
  return request<Entity[]>(`/items${qs}`);
}

export function createItem(data: NewEntity): Promise<Entity> {
  return request<Entity>('/items', { method: 'POST', body: JSON.stringify(data) });
}

export function updateItem(id: string, updates: EntityUpdate): Promise<Entity> {
  return request<Entity>(`/items/${id}`, { method: 'PUT', body: JSON.stringify(updates) });
}

export function deleteItem(id: string): Promise<void> {
  return request<void>(`/items/${id}`, { method: 'DELETE' });
}

/** Record a habit occurrence for a date. Returns the updated habit. */
export function logHabit(id: string, date: string, completed: boolean): Promise<Entity> {
  return request<Entity>(`/items/${id}/log`, {
    method: 'POST',
    body: JSON.stringify({ date, completed }),
  });
}

// ── Derived views (also available server-side for MCP/programmatic use) ────────

export interface ReminderIndexRow {
  id: string;
  source_id: string;
  source_type: EntityType;
  title: string;
  fire_at: string;
  status: string;
}

export function getUpcomingReminders(before?: string): Promise<ReminderIndexRow[]> {
  const qs = before ? `?before=${encodeURIComponent(before)}` : '';
  return request<ReminderIndexRow[]>(`/reminders/upcoming${qs}`);
}

export interface StoryTimeline {
  story: Entity;
  timeline: Entity[];
}

export function getStoryTimeline(id: string): Promise<StoryTimeline> {
  return request<StoryTimeline>(`/items/${id}/timeline`);
}

import type {
  EventDocument,
  NewEvent,
  UpdateEvent,
  Template,
  NewTemplate,
  ReminderIndexEntry,
  ShoppingEntry,
} from '../types/organizer';

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

// ── Events ─────────────────────────────────────────────────────────────────

export function getEvents(): Promise<EventDocument[]> {
  return request<EventDocument[]>('/events');
}

export function createEvent(data: NewEvent): Promise<EventDocument> {
  return request<EventDocument>('/events', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateEvent(id: string, updates: UpdateEvent): Promise<EventDocument> {
  return request<EventDocument>(`/events/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function deleteEvent(id: string): Promise<void> {
  return request<void>(`/events/${id}`, { method: 'DELETE' });
}

/** Mark done; if the event recurs, the backend spawns the next occurrence. */
export function completeEvent(
  id: string,
): Promise<{ completed: EventDocument; next: EventDocument | null }> {
  return request(`/events/${id}/complete`, { method: 'POST' });
}

// ── Templates ────────────────────────────────────────────────────────────────

export function getTemplates(): Promise<Template[]> {
  return request<Template[]>('/templates');
}

export function createTemplate(data: NewTemplate): Promise<Template> {
  return request<Template>('/templates', { method: 'POST', body: JSON.stringify(data) });
}

export function updateTemplate(id: string, updates: Partial<NewTemplate>): Promise<Template> {
  return request<Template>(`/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

export function deleteTemplate(id: string): Promise<void> {
  return request<void>(`/templates/${id}`, { method: 'DELETE' });
}

// ── Derived views ────────────────────────────────────────────────────────────

export function getUpcomingReminders(before?: string): Promise<ReminderIndexEntry[]> {
  const qs = before ? `?before=${encodeURIComponent(before)}` : '';
  return request<ReminderIndexEntry[]>(`/reminders/upcoming${qs}`);
}

export function getShoppingList(): Promise<ShoppingEntry[]> {
  return request<ShoppingEntry[]>('/views/shopping');
}

import { useCallback, useEffect, useState } from 'react';
import type { EventDocument, NewEvent, UpdateEvent } from '../types/organizer';
import * as api from '../api/client';

export function useEvents() {
  const [events, setEvents] = useState<EventDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getEvents();
      setEvents(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addEvent = useCallback(async (data: NewEvent): Promise<EventDocument> => {
    // Templates may auto-apply server-side (extra checklists/reminders), so use
    // the returned canonical document rather than the submitted payload.
    const created = await api.createEvent(data);
    setEvents((prev) => [...prev, created]);
    return created;
  }, []);

  const updateEvent = useCallback(
    async (id: string, updates: UpdateEvent): Promise<EventDocument> => {
      const updated = await api.updateEvent(id, updates);
      setEvents((prev) => prev.map((e) => (e.id === id ? updated : e)));
      return updated;
    },
    [],
  );

  const removeEvent = useCallback(async (id: string) => {
    await api.deleteEvent(id);
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Completing a recurring event spawns a new occurrence server-side, so merge
  // both the completed and the (optional) next document back into state.
  const completeEvent = useCallback(async (id: string) => {
    const { completed, next } = await api.completeEvent(id);
    setEvents((prev) => {
      const merged = prev.map((e) => (e.id === id ? completed : e));
      return next ? [...merged, next] : merged;
    });
  }, []);

  return {
    events,
    loading,
    error,
    refresh,
    addEvent,
    updateEvent,
    removeEvent,
    completeEvent,
  };
}

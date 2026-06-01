import { useCallback, useEffect, useState } from 'react';
import type { Organizer } from '../types/organizer';
import * as api from '../api/client';

export function useOrganizers() {
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getOrganizers();
      setOrganizers(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load organizers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addOrganizer = useCallback(async (text: string) => {
    const created = await api.createOrganizer(text);
    setOrganizers((prev) => [...prev, created]);
  }, []);

  const toggleOrganizer = useCallback(async (id: string, done: boolean) => {
    const updated = await api.updateOrganizer(id, done);
    setOrganizers((prev) => prev.map((t) => (t.id === id ? updated : t)));
  }, []);

  const removeOrganizer = useCallback(async (id: string) => {
    await api.deleteOrganizer(id);
    setOrganizers((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { organizers, loading, error, refresh, addOrganizer, toggleOrganizer, removeOrganizer };
}

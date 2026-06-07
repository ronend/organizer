import { useCallback, useEffect, useState } from 'react';
import type { NewOrganizer, Organizer } from '../types/organizer';
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
      setError(e instanceof Error ? e.message : 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addOrganizer = useCallback(async (data: NewOrganizer): Promise<Organizer> => {
    const created = await api.createOrganizer(data);
    setOrganizers((prev) => [...prev, created]);
    return created;
  }, []);

  const updateOrganizer = useCallback(
    async (id: string, updates: Partial<NewOrganizer>): Promise<Organizer> => {
      const updated = await api.updateOrganizer(id, updates);
      setOrganizers((prev) => prev.map((o) => (o.id === id ? updated : o)));
      return updated;
    },
    [],
  );

  const removeOrganizer = useCallback(async (id: string) => {
    await api.deleteOrganizer(id);
    setOrganizers((prev) => prev.filter((o) => o.id !== id));
  }, []);

  return {
    organizers,
    loading,
    error,
    refresh,
    addOrganizer,
    updateOrganizer,
    removeOrganizer,
  };
}

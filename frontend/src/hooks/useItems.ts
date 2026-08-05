import { useCallback, useEffect, useState } from 'react';
import type { Entity, NewEntity, EntityUpdate } from '../types/organizer';
import * as api from '../api/client';

export function useItems() {
  const [items, setItems] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.getItems());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addItem = useCallback(async (data: NewEntity): Promise<Entity> => {
    const created = await api.createItem(data);
    setItems((prev) => [...prev, created]);
    return created;
  }, []);

  const updateItem = useCallback(async (id: string, updates: EntityUpdate): Promise<Entity> => {
    const updated = await api.updateItem(id, updates);
    setItems((prev) => prev.map((e) => (e.id === id ? updated : e)));
    return updated;
  }, []);

  const removeItem = useCallback(async (id: string) => {
    await api.deleteItem(id);
    setItems((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const logHabit = useCallback(async (id: string, date: string, completed: boolean): Promise<Entity> => {
    const updated = await api.logHabit(id, date, completed);
    setItems((prev) => prev.map((e) => (e.id === id ? updated : e)));
    return updated;
  }, []);

  return { items, loading, error, refresh, addItem, updateItem, removeItem, logHabit };
}

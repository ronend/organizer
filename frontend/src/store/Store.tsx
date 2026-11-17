import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchState, sendBatch } from '../api/client';
import type { ChangeSet, CooState } from '../types/coo';
import { applyChanges, inverse } from '../lib/ops';
import { useToast } from './Toast';

const EMPTY: CooState = {
  people: [], cars: [], contacts: [], routines: [], assignments: [],
  tasks: [], documents: [], trips: [], reservations: [],
};

interface ApplyOpts {
  /** Toast text after the change. */
  toast?: string;
  /** Offer Undo in the toast. */
  undo?: boolean;
}

interface StoreValue {
  s: CooState;
  ready: boolean;
  loadError: string | null;
  apply: (cs: ChangeSet, opts?: ApplyOpts) => void;
  /**
   * Runs a server-side change (e.g. POST /api/documents) after earlier writes
   * have landed, then applies the ChangeSet it returns locally without
   * re-sending it. Rejects if the call fails, so a form can stay open.
   */
  commit: (run: () => Promise<ChangeSet>, opts?: { toast?: string | ((cs: ChangeSet) => string) }) => Promise<ChangeSet>;
  reload: () => Promise<void>;
}

const Ctx = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [s, setS] = useState<CooState>(EMPTY);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const ref = useRef(s);
  ref.current = s;
  // Writes are serialized so a later change never lands before an earlier one.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async () => {
    try {
      const st = await fetchState();
      ref.current = st;
      setS(st);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load your data.');
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const apply = useCallback(
    (cs: ChangeSet, opts: ApplyOpts = {}) => {
      if (cs.put.length === 0 && cs.delete.length === 0) return;
      const before = ref.current;
      const undo = inverse(before, cs);
      const after = applyChanges(before, cs);
      ref.current = after;
      setS(after);
      queue.current = queue.current
        .then(() => sendBatch(cs))
        .catch((e) => {
          toast.show({ text: `Couldn’t save: ${e instanceof Error ? e.message : 'network error'}. Reloaded.` });
          return reload();
        });
      if (opts.toast) {
        toast.show({
          text: opts.toast,
          undo: opts.undo
            ? () => {
                const cur = ref.current;
                const reverted = applyChanges(cur, undo);
                ref.current = reverted;
                setS(reverted);
                queue.current = queue.current.then(() => sendBatch(undo)).catch(() => reload());
              }
            : undefined,
        });
      }
    },
    [reload, toast],
  );

  const commit = useCallback(
    async (run: () => Promise<ChangeSet>, opts: { toast?: string | ((cs: ChangeSet) => string) } = {}) => {
      const p = queue.current.then(run);
      queue.current = p.then(
        () => {},
        () => {},
      );
      const cs = await p;
      const after = applyChanges(ref.current, cs);
      ref.current = after;
      setS(after);
      const text = typeof opts.toast === 'function' ? opts.toast(cs) : opts.toast;
      if (text) toast.show({ text });
      return cs;
    },
    [toast],
  );

  const value = useMemo(() => ({ s, ready, loadError, apply, commit, reload }), [s, ready, loadError, apply, commit, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}

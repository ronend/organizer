import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Dialog and viewer host. One dialog at a time; opening another replaces it.
 * Focus returns to the opener on close; the page behind does not scroll.
 * Also holds UI memory that should survive navigation (ID card flip state).
 */
interface UIApi {
  openDialog: (node: ReactNode) => void;
  closeDialog: () => void;
  openViewer: (node: ReactNode) => void;
  closeViewer: () => void;
  isFlipped: (id: string) => boolean;
  toggleFlip: (id: string) => void;
}

const Ctx = createContext<UIApi | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<{ node: ReactNode; key: number } | null>(null);
  const [viewer, setViewer] = useState<{ node: ReactNode; key: number } | null>(null);
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const opener = useRef<HTMLElement | null>(null);
  const viewerOpener = useRef<HTMLElement | null>(null);
  const seq = useRef(0);

  const openDialog = useCallback((node: ReactNode) => {
    if (!opener.current) opener.current = document.activeElement as HTMLElement | null;
    setDialog({ node, key: ++seq.current });
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
    const el = opener.current;
    opener.current = null;
    if (el && document.contains(el)) requestAnimationFrame(() => el.focus());
  }, []);

  const openViewer = useCallback((node: ReactNode) => {
    viewerOpener.current = document.activeElement as HTMLElement | null;
    setDialog(null);
    setViewer({ node, key: ++seq.current });
  }, []);

  const closeViewer = useCallback(() => {
    setViewer(null);
    const el = viewerOpener.current;
    viewerOpener.current = null;
    if (el && document.contains(el)) requestAnimationFrame(() => el.focus());
  }, []);

  const isFlipped = useCallback((id: string) => flipped.has(id), [flipped]);
  const toggleFlip = useCallback((id: string) => {
    setFlipped((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  useEffect(() => {
    document.body.classList.toggle('no-scroll', !!dialog || !!viewer);
  }, [dialog, viewer]);

  const api = useMemo(
    () => ({ openDialog, closeDialog, openViewer, closeViewer, isFlipped, toggleFlip }),
    [openDialog, closeDialog, openViewer, closeViewer, isFlipped, toggleFlip],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {dialog && <div key={dialog.key}>{dialog.node}</div>}
      {viewer && <div key={viewer.key}>{viewer.node}</div>}
    </Ctx.Provider>
  );
}

export function useUI(): UIApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUI outside UIProvider');
  return v;
}

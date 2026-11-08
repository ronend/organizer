import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastMsg {
  id: number;
  text: string;
  undo?: () => void;
}

interface ToastApi {
  show: (m: { text: string; undo?: () => void }) => void;
}

const Ctx = createContext<ToastApi>({ show: () => {} });

/** One toast at a time, bottom center, ~5 s, polite live region. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const timer = useRef<number>();
  const seq = useRef(0);

  const show = useCallback((m: { text: string; undo?: () => void }) => {
    window.clearTimeout(timer.current);
    setMsg({ ...m, id: ++seq.current });
    timer.current = window.setTimeout(() => setMsg(null), 5000);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {msg && (
          <div className="toast" key={msg.id}>
            <span>{msg.text}</span>
            {msg.undo && (
              <button
                type="button"
                className="toast-undo"
                onClick={() => {
                  msg.undo?.();
                  setMsg(null);
                }}
              >
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}

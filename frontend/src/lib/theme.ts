import { useCallback, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'theme';

/** Current theme: from <html data-theme>, else stored, else system. */
export function getTheme(): Theme {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  const stored = localStorage.getItem(KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore storage errors */
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => getTheme());
  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return next;
    });
  }, []);
  return { theme, toggle };
}

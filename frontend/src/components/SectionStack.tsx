/**
 * A subject's sections, one after the other. Only sections with content are
 * passed in; a row of toggles turns each on or off. What's off is remembered
 * per scope (the subject type), so a new kind of section shows up turned on.
 */
import { useState, type ReactNode } from 'react';

export interface PageSection {
  key: string;
  title: string;
  count: number;
  render: () => ReactNode;
}

const storageKey = (scope: string) => `coo.sections.hidden.${scope}`;

function loadHidden(scope: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(storageKey(scope)) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function SectionStack({ scope, sections }: { scope: string; sections: PageSection[] }) {
  const [hidden, setHidden] = useState<string[]>(() => loadHidden(scope));
  const toggle = (key: string) => {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    try {
      localStorage.setItem(storageKey(scope), JSON.stringify(next));
    } catch {
      /* storage full or blocked: the toggle still works for this visit */
    }
  };
  if (sections.length === 0) return null;
  const shown = sections.filter((x) => !hidden.includes(x.key));
  return (
    <>
      <div className="section-toggles chips" role="group" aria-label="Sections to show">
        {sections.map((x) => {
          const on = !hidden.includes(x.key);
          return (
            <button key={x.key} type="button" className={`chip small-chip ${on ? 'selected' : ''}`} aria-pressed={on} onClick={() => toggle(x.key)}>
              {x.title}
              <span className="muted">{x.count}</span>
            </button>
          );
        })}
      </div>
      {shown.map((x) => (
        <div key={x.key}>{x.render()}</div>
      ))}
      {shown.length === 0 && <p className="muted small">All sections are turned off. Use the toggles above to show them.</p>}
    </>
  );
}

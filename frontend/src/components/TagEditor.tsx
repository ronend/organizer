import { useState } from 'react';
import { labelize, normalizeTag, type Tag } from '../types/organizer';

interface Props {
  value: Tag[];
  /** All tags currently in use across entries, offered for quick re-selection. */
  known: Tag[];
  onChange: (tags: Tag[]) => void;
}

/** Pill-style multi-select with inline "+ New Tag" creation. */
export default function TagEditor({ value, known, onChange }: Props) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  const toggle = (t: Tag) =>
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);

  function commit() {
    const v = normalizeTag(draft);
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft('');
    setAdding(false);
  }

  // Selected tags first, then any known-but-unselected tags as quick adds.
  const suggestions = known.filter((t) => !value.includes(t));

  return (
    <div className="tag-editor">
      {value.map((t) => (
        <button
          key={t}
          type="button"
          className="tag-pill active ripple"
          onClick={() => toggle(t)}
          title="Remove tag"
        >
          {labelize(t)} <span className="tag-x">×</span>
        </button>
      ))}
      {suggestions.map((t) => (
        <button
          key={t}
          type="button"
          className="tag-pill ripple"
          onClick={() => toggle(t)}
        >
          {labelize(t)}
        </button>
      ))}
      {adding ? (
        <input
          className="tag-input"
          autoFocus
          value={draft}
          placeholder="new tag"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            } else if (e.key === 'Escape') {
              setDraft('');
              setAdding(false);
            }
          }}
        />
      ) : (
        <button type="button" className="tag-pill add" onClick={() => setAdding(true)}>
          + New Tag
        </button>
      )}
    </div>
  );
}

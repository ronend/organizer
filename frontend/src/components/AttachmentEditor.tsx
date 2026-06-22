import type { Attachment } from '../types/organizer';
import { newLocalId } from '../lib/localId';

interface Props {
  value: Attachment[];
  onChange: (next: Attachment[]) => void;
}

function newAttachment(): Attachment {
  return {
    id: newLocalId(),
    label: '',
    item_id: null,
    mime_type: null,
    url: '',
    storage_key: null,
  };
}

export default function AttachmentEditor({ value, onChange }: Props) {
  function patch(id: string, p: Partial<Attachment>) {
    onChange(value.map((a) => (a.id === id ? { ...a, ...p } : a)));
  }

  return (
    <div className="attachments-edit">
      {value.map((a) => (
        <div className="attachment-row" key={a.id}>
          <input
            placeholder="Label"
            value={a.label}
            onChange={(e) => patch(a.id, { label: e.target.value })}
          />
          <input
            type="url"
            placeholder="https://… (URL)"
            value={a.url ?? ''}
            onChange={(e) => patch(a.id, { url: e.target.value || null })}
          />
          {a.url && (
            <a className="btn btn-ghost ripple" href={a.url} target="_blank" rel="noreferrer">
              🔗
            </a>
          )}
          <button
            type="button"
            className="prereq-del"
            aria-label="Remove attachment"
            onClick={() => onChange(value.filter((x) => x.id !== a.id))}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="seg-btn add" onClick={() => onChange([...value, newAttachment()])}>
        + Add attachment
      </button>
    </div>
  );
}

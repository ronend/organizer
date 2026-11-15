import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Tone } from '../lib/model';
import { useUI } from '../store/UI';
import { Icon } from './Icon';
import { useFileUrl } from '../lib/files';
import type { FileRef } from '../types/coo';

// ── Status ──────────────────────────────────────────────────────────────────

export function StatusText({ tone, text, className }: { tone: Tone; text: string; className?: string }) {
  return (
    <span className={`status tone-${tone} ${className ?? ''}`}>
      <span className="dot" aria-hidden="true" />
      {text}
    </span>
  );
}

/** Count circle + icon, no visible words. Tooltip and SR text carry the meaning. */
export function CountCircle({
  tone,
  count,
  icon,
  label,
}: {
  tone: Tone;
  count: number | 'check';
  icon: string;
  label: string;
}) {
  return (
    <span className={`count tone-${tone}`} title={label}>
      <span className="count-circle" aria-hidden="true">
        {count === 'check' ? <Icon name="check" size={13} /> : count}
      </span>
      <Icon name={icon} size={20} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

// ── Layout bits ─────────────────────────────────────────────────────────────

export function PageHead({
  eyebrow,
  title,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function SectionHead({ title, count, action }: { title: ReactNode; count?: number | string; action?: ReactNode }) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      <div className="section-head-right">
        {action}
        {count !== undefined && <span className="muted">{count}</span>}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

// ── Segmented control and chips ─────────────────────────────────────────────

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'selected' : ''}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`chip ${o.value === value ? 'selected' : ''}`}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Form fields ─────────────────────────────────────────────────────────────

export function Field({
  label,
  optional,
  children,
  hint,
  className,
}: {
  label: string;
  optional?: boolean;
  children: (id: string) => ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`field ${className ?? ''}`}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="optional"> (optional)</span>}
      </label>
      {children(id)}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Fieldset({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="fieldset">
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

// ── Dialog ──────────────────────────────────────────────────────────────────

export function Dialog({
  eyebrow,
  title,
  wide,
  children,
  onSubmit,
  actions,
  destructive,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  wide?: boolean;
  children: ReactNode;
  /** When set, the body is a form and the action bar submits it. */
  onSubmit?: () => void;
  actions?: ReactNode;
  destructive?: ReactNode;
}) {
  const { closeDialog } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>(
      '.dialog-body input:not([type=hidden]):not([disabled]), .dialog-body select, .dialog-body textarea, .dialog-body button',
    );
    (first ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeDialog();
      }
      if (e.key === 'Tab') trapFocus(e, el);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeDialog]);

  const body = (
    <>
      <div className="dialog-body">{children}</div>
      {(actions || destructive) && (
        <div className="dialog-actions">
          {destructive && <div className="dialog-destructive">{destructive}</div>}
          {actions}
        </div>
      )}
    </>
  );

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && closeDialog()}>
      <div
        ref={ref}
        className={`dialog ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="dialog-head">
          <div>
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            <h2 id={titleId} className="dialog-title">
              {title}
            </h2>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={closeDialog}>
            <Icon name="close" />
          </button>
        </div>
        {onSubmit ? (
          <form
            className="dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
          >
            {body}
          </form>
        ) : (
          body
        )}
      </div>
    </div>
  );
}

export function trapFocus(e: KeyboardEvent, root: HTMLElement) {
  const items = [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
    (x) => x.offsetParent !== null,
  );
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Cancel (ghost) + primary submit. */
export function FormActions({ submit, cancel = 'Cancel', disabled }: { submit: string; cancel?: string; disabled?: boolean }) {
  const { closeDialog } = useUI();
  return (
    <>
      <button type="button" className="btn ghost" onClick={closeDialog}>
        {cancel}
      </button>
      <button type="submit" className="btn primary" disabled={disabled}>
        {submit}
      </button>
    </>
  );
}

// ── Full-screen viewer ──────────────────────────────────────────────────────

export function Viewer({
  title,
  onDownload,
  onEdit,
  children,
  white,
}: {
  title: string;
  onDownload?: () => void;
  /** Shows an Edit button; the edit form replaces the viewer. */
  onEdit?: () => void;
  children: ReactNode;
  white?: boolean;
}) {
  const { closeViewer } = useUI();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('.viewer-bar button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeViewer();
      if (e.key === 'Tab' && ref.current) trapFocus(e, ref.current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeViewer]);
  return (
    <div ref={ref} className={`viewer ${white ? 'viewer-white' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="viewer-bar">
        <button type="button" className="btn ghost" onClick={closeViewer}>
          <Icon name="close" /> Close
        </button>
        <div className="viewer-title">{title}</div>
        <span className="viewer-actions">
          {onEdit && (
            <button type="button" className="btn ghost" onClick={onEdit}>
              <Icon name="edit" /> Edit
            </button>
          )}
          {onDownload && (
            <button type="button" className="btn ghost" onClick={onDownload}>
              <Icon name="download" /> Download
            </button>
          )}
        </span>
      </div>
      <div className="viewer-scroll">{children}</div>
    </div>
  );
}

// ── Files ───────────────────────────────────────────────────────────────────

export function FileImage({ file, alt, className }: { file: FileRef | null; alt: string; className?: string }) {
  const url = useFileUrl(file);
  if (!file || !url) return null;
  return <img src={url} alt={alt} className={className} />;
}

export function isImage(f: FileRef | null | undefined) {
  return !!f && f.contentType.startsWith('image/');
}

export function FileInput({
  accept,
  multiple,
  onFiles,
  id,
}: {
  accept: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  id: string;
}) {
  return (
    <input
      id={id}
      type="file"
      accept={accept}
      multiple={multiple}
      onChange={(e) => onFiles([...(e.target.files ?? [])])}
    />
  );
}

/** Tooltip-free, accessible icon button. */
export function IconButton({
  icon,
  label,
  onClick,
  href,
  size = 20,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  href?: string;
  size?: number;
}) {
  if (href) {
    return (
      <a className="icon-btn" href={href} target="_blank" rel="noreferrer noopener" aria-label={label} title={label}>
        <Icon name={icon} size={size} />
      </a>
    );
  }
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      setBusy(true);
      try {
        return await fn();
      } finally {
        setBusy(false);
      }
    },
  };
}

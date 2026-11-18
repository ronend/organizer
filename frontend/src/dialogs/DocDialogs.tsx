/**
 * Documents: one form for every category, built from the registry
 * (lib/registry.json) — the category's types, files (front/back roles or a
 * single file), date, expiry, fields and per-type fields, custom fields,
 * routine link, renewal reminders and pin. Saving goes through
 * POST /api/documents, which applies the document rules server-side.
 */
import { useState, type KeyboardEvent } from 'react';
import type { CooState, CustomField, DocCategory, Document, DocumentFile, FileRef, Fields } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { useToast } from '../store/Toast';
import { saveDocument, uploadFile, type SaveDocumentRequest, type SaveDocumentResult } from '../api/client';
import { Dialog, Field, FilePreview, Fieldset, FormActions, IconButton, StatusText, Viewer, isImage, isPdf, useBusy } from '../components/ui';
import { FieldsEditor, fieldDisplay } from '../components/FieldInputs';
import { copyText } from '../lib/clipboard';
import { Icon } from '../components/Icon';
import { fmtDate } from '../lib/dates';
import { assignmentsFor, docValidity, fileOf, routineOf, subjectName, validUntil } from '../lib/model';
import { CATEGORIES, category, categoryFields, compactFields, remindDefault, typeFields } from '../lib/registry';
import { downloadOriginal, getFileUrl, safeFilename, saveBlob, summarySvg } from '../lib/files';

// ── Form ────────────────────────────────────────────────────────────────────

export interface DocFormProps {
  category: DocCategory;
  subjectId: string;
  assignmentId?: string | null;
  docType?: string;
  closeTaskId?: string;
  doc?: Document;
}

/** Opens the form for a category (kept as the public entry point). */
export function DocFormFor(p: DocFormProps) {
  return <DocDialog {...p} />;
}

/** On a type change, drop empty values of fields only the old type had. */
function moveTypeFields(fields: Fields, kind: DocCategory, from: string, to: string): Fields {
  const keep = new Set(categoryFields(kind, to).map((f) => f.key));
  const dropped = new Set(typeFields(kind, from).map((f) => f.key).filter((k) => !keep.has(k)));
  return Object.fromEntries(Object.entries(fields).filter(([k, v]) => !dropped.has(k) || (v !== '' && v != null)));
}

function FilePicker({
  label,
  current,
  onFile,
  remove,
  onRemove,
}: {
  label: string;
  current: FileRef | null;
  onFile: (f: File | null) => void;
  remove: boolean;
  onRemove: (v: boolean) => void;
}) {
  return (
    <Field label={label} optional hint="An image or a PDF.">
      {(id) => (
        <>
          <input id={id} type="file" accept="image/*,application/pdf" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {current && (
            <label className="check-row small">
              <input type="checkbox" checked={remove} onChange={(e) => onRemove(e.target.checked)} />
              <span>Remove the current file ({current.name})</span>
            </label>
          )}
        </>
      )}
    </Field>
  );
}

/**
 * Saves through POST /api/documents and applies what it wrote. Returns null,
 * after a toast, if it failed, so the form stays open.
 */
function useSaveDocument() {
  const { commit } = useStore();
  const toast = useToast();
  return async (req: SaveDocumentRequest, message: (r: SaveDocumentResult) => string): Promise<SaveDocumentResult | null> => {
    let result: SaveDocumentResult | null = null;
    try {
      await commit(async () => {
        result = await saveDocument(req);
        return result.changes;
      });
    } catch (e) {
      toast.show({ text: `Couldn’t save: ${e instanceof Error ? e.message : 'error'}` });
      return null;
    }
    toast.show({ text: message(result!) });
    return result;
  };
}

function savedText(r: SaveDocumentResult): string {
  const parts = ['Saved.'];
  if (r.summary.remindersPlannedFrom) parts.push(`Renewal reminders planned from ${fmtDate(r.summary.remindersPlannedFrom, true)}.`);
  if (r.summary.archivedOlder?.length) parts.push('The older one was archived.');
  if (r.summary.routineMovedTo) parts.push(`${r.summary.linkedRoutine ?? 'The routine'} moved to ${fmtDate(r.summary.routineMovedTo, true)}.`);
  return parts.join(' ');
}

const ROLE_LABEL: Record<string, string> = { front: 'Front', back: 'Back' };
const roleKey = (r: string | null) => r ?? '';

export function DocDialog({ category: kind, subjectId, assignmentId, docType, closeTaskId, doc }: DocFormProps) {
  const { s } = useStore();
  const save = useSaveDocument();
  const { closeDialog } = useUI();
  const toast = useToast();
  const { busy, run } = useBusy();
  const cat = category(kind);
  const subject = s.subjects.find((x) => x.id === subjectId);
  const initialType = doc?.type ?? docType ?? cat.defaultType;
  // Cards (front/back) of a person get "<Name>’s <type>" as a starting title.
  const defaultTitle = (t: string) => (cat.fileRoles.length && subject?.subjectType === 'person' ? `${subject.name}’s ${t.toLowerCase()}` : '');

  const [title, setTitle] = useState(doc?.title ?? defaultTitle(initialType));
  const [type, setType] = useState(initialType);
  const [date, setDate] = useState(doc?.date ?? (cat.datedByDefault ? new Date().toISOString().slice(0, 10) : ''));
  const [expiry, setExpiry] = useState((doc && validUntil(doc)) ?? '');
  const [fields, setFields] = useState<Fields>(doc?.fields ?? {});
  const [custom, setCustom] = useState<CustomField[]>(doc?.customFields ?? []);
  const roles: (string | null)[] = cat.fileRoles.length ? cat.fileRoles : [null];
  const [picked, setPicked] = useState<Record<string, File | null>>({});
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [linked, setLinked] = useState(doc?.assignmentId ?? assignmentId ?? '');
  const [remind, setRemind] = useState(!doc && !!cat.rules.renewal);
  const [remindDays, setRemindDays] = useState(String(remindDefault(kind, initialType)));
  const [pinned, setPinned] = useState(doc?.pinned ?? cat.pin.default);
  const routines = cat.area ? assignmentsFor(s, subjectId, cat.area) : [];
  const defs = categoryFields(kind, type);

  const changeType = (t: string) => {
    setFields((cur) => moveTypeFields(cur, kind, type, t));
    setRemindDays(String(remindDefault(kind, t)));
    if (title === defaultTitle(type)) setTitle(defaultTitle(t));
    setType(t);
  };

  const suggestionsFor = (key: string) => [
    ...new Set(
      s.documents
        .filter((d) => d.subjectId === subjectId && d.category === kind)
        .map((d) => d.fields[key])
        .filter((v): v is string => typeof v === 'string' && !!v),
    ),
  ];

  const submit = () =>
    run(async () => {
      const firstPicked = Object.values(picked).find(Boolean);
      const t = title.trim() || firstPicked?.name || '';
      if (!t) {
        toast.show({ text: 'Give the document a title' });
        return;
      }
      const files: DocumentFile[] = [];
      try {
        const uploads = await Promise.all(
          roles.map(async (role) => {
            const f = picked[roleKey(role)];
            return [role, f ? await uploadFile(f, f.name) : null] as const;
          }),
        );
        for (const [role, up] of uploads) {
          const cur = doc ? fileOf(doc, role) : null;
          const file = up ?? (removed[roleKey(role)] ? null : cur);
          if (file) files.push({ role, file });
        }
        // Files beyond the form's roles (e.g. a second file added elsewhere) are kept.
        for (const f of doc?.files ?? []) if (!roles.includes(f.role)) files.push(f);
      } catch (e) {
        toast.show({ text: `Upload failed: ${e instanceof Error ? e.message : 'error'}` });
        return;
      }
      const result = await save(
        {
          document: {
            id: doc?.id,
            subjectId,
            category: kind,
            title: t,
            type,
            date: date || null,
            expiry: cat.expiring && expiry ? { validUntil: expiry, outdated: doc?.expiry?.outdated ?? false } : null,
            files,
            fields: compactFields(Object.fromEntries(Object.entries(fields).filter(([k]) => defs.some((d) => d.key === k)))),
            customFields: custom.map((r) => ({ label: r.label.trim(), value: r.value.trim() })).filter((r) => r.label && r.value),
            assignmentId: linked || null,
            pinned,
          },
          renewal:
            cat.rules.renewal && !linked && remind && expiry ? { remindDays: Math.max(0, Number(remindDays) || remindDefault(kind, type)) } : null,
          closeTaskId,
          expectUpdatedAt: doc?.updatedAt,
        },
        savedText,
      );
      if (!result) return;
      closeDialog();
    });

  const heading = kind === 'identity' ? 'Add an ID or document' : kind === 'attachment' ? 'Add a file' : `Add a ${cat.label.toLowerCase()} document`;
  return (
    <Dialog
      eyebrow={`${subjectName(s, subjectId)} · ${cat.label}`}
      title={doc ? `Edit ${doc.title}` : heading}
      wide
      onSubmit={submit}
      actions={<FormActions submit={busy ? 'Saving…' : 'Save'} disabled={busy} />}
    >
      <div className="fields">
        <Field label="Title" hint={roles[0] === null && !doc ? 'Leave empty to use the file name.' : undefined}>
          {(id) => <input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        {cat.types.length > 1 && (
          <Field label="Type">
            {(id) => (
              <select id={id} value={type} onChange={(e) => changeType(e.target.value)}>
                {cat.types.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            )}
          </Field>
        )}
      </div>
      {(cat.datedByDefault || cat.expiring) && (
        <div className="fields">
          {cat.datedByDefault && <Field label={cat.dateLabel}>{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>}
          {cat.expiring && (
            <Field label={cat.expiryLabel} optional>
              {(id) => <input id={id} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />}
            </Field>
          )}
        </div>
      )}
      <FieldsEditor s={s} defs={defs} values={fields} onChange={setFields} suggestionsFor={suggestionsFor} />
      <Fieldset legend="More details">
        {custom.map((r, i) => (
          <div key={i} className="fields detail-row">
            <input aria-label="Field name" placeholder="Field" value={r.label} onChange={(e) => setCustom((cur) => cur.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input aria-label={r.label || 'Value'} placeholder="Value" value={r.value} onChange={(e) => setCustom((cur) => cur.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          </div>
        ))}
        <button type="button" className="link" onClick={() => setCustom((cur) => [...cur, { label: '', value: '' }])}>
          + Add a field
        </button>
      </Fieldset>
      <div className="fields">
        {roles.map((role) => (
          <FilePicker
            key={roleKey(role)}
            label={role ? ROLE_LABEL[role] ?? role : 'File'}
            current={doc ? fileOf(doc, role) : null}
            onFile={(f) => setPicked((cur) => ({ ...cur, [roleKey(role)]: f }))}
            remove={!!removed[roleKey(role)]}
            onRemove={(v) => setRemoved((cur) => ({ ...cur, [roleKey(role)]: v }))}
          />
        ))}
      </div>
      {cat.fileRoles.includes('back') && <p className="muted small">Clicking a card anywhere flips it between front and back.</p>}
      {cat.area && (
        <Field label="Linked routine" optional>
          {(id) => (
            <select id={id} value={linked} onChange={(e) => setLinked(e.target.value)}>
              <option value="">None</option>
              {routines.map((a) => (
                <option key={a.id} value={a.id}>
                  {routineOf(s, a)?.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {cat.rules.renewal && !linked && (
        <Fieldset legend="Renewal reminder">
          <label className="check-row">
            <input type="checkbox" checked={remind} onChange={(e) => setRemind(e.target.checked)} />
            <span>Remind me to renew it</span>
          </label>
          {remind && (
            <Field label="Start reminding me this many days before expiry" hint={expiry ? undefined : 'Needs an expiry date.'}>
              {(id) => <input id={id} type="number" min={0} value={remindDays} onChange={(e) => setRemindDays(e.target.value)} />}
            </Field>
          )}
        </Fieldset>
      )}
      <label className="check-row">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        <span>{cat.pin.label}</span>
      </label>
    </Dialog>
  );
}

// ── Card flip (categories with front/back files) ────────────────────────────

export function IdFlipCard({ doc, large }: { doc: Document; large?: boolean }) {
  const { isFlipped, toggleFlip } = useUI();
  const flipped = isFlipped(doc.id);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleFlip(doc.id);
    }
  };
  const side = (f: FileRef | null, which: 'front' | 'back') => (
    <div className={`flip-face flip-${which}`}>
      {f ? (
        <FilePreview
          file={f}
          alt={`${doc.title}, ${which}`}
          className="flip-img"
          fallback={
            <div className="flip-placeholder">
              <Icon name="document" size={large ? 36 : 28} />
              <span>{f.name}</span>
            </div>
          }
        />
      ) : (
        <div className="flip-placeholder">
          <Icon name="idcard" size={large ? 36 : 28} />
          <span>No {which} image yet</span>
        </div>
      )}
    </div>
  );
  return (
    <div
      className={`flip ${large ? 'large' : ''} ${flipped ? 'flipped' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      aria-label={`${doc.title}: showing the ${flipped ? 'back' : 'front'}. Press to flip.`}
      onClick={() => toggleFlip(doc.id)}
      onKeyDown={onKey}
    >
      <div className="flip-inner">
        {side(fileOf(doc, 'front'), 'front')}
        {side(fileOf(doc, 'back'), 'back')}
      </div>
    </div>
  );
}

// ── Viewer and download ─────────────────────────────────────────────────────

/** Label/value rows: date, expiry, registry fields, custom fields, routine. */
function docRows(s: CooState, d: Document, full: boolean): [string, string][] {
  const cat = CATEGORIES[d.category];
  const rows: [string, string][] = [];
  if (d.date) rows.push([cat.dateLabel, fmtDate(d.date)]);
  const until = validUntil(d);
  if (until) rows.push([cat.expiryLabel === 'Expiry date' ? 'Expires' : cat.expiryLabel, fmtDate(until)]);
  for (const f of categoryFields(d.category, d.type)) rows.push([f.label, fieldDisplay(s, f, d.fields, full)]);
  for (const r of d.customFields) rows.push([r.label, r.value]);
  const r = routineOf(s, s.assignments.find((a) => a.id === d.assignmentId));
  if (r) rows.push(['Routine', r.title]);
  return rows.filter(([, v]) => v);
}

function isCard(d: Document) {
  return CATEGORIES[d.category].fileRoles.includes('front');
}

export async function downloadDoc(s: CooState, d: Document) {
  const files = d.files.map((f) => f.file);
  if (!isCard(d) && files.length === 1) {
    await downloadOriginal(files[0]);
    return;
  }
  const images = files.filter((f) => isImage(f));
  const blob = await summarySvg({ title: d.title, typeLabel: d.type, rows: docRows(s, d, true), images });
  saveBlob(blob, `${safeFilename(d.title)}.svg`);
  // PDFs can't be embedded in the SVG card, so save them alongside it.
  for (const f of files) if (!isImage(f)) await downloadOriginal(f);
}

function OpenFileButton({ file, label }: { file: FileRef; label: string }) {
  return (
    <button
      type="button"
      className="btn secondary"
      onClick={async () => {
        const url = await getFileUrl(file.key);
        if (url) window.open(url, '_blank', 'noopener');
      }}
    >
      <Icon name="document" /> {label}
    </button>
  );
}

export function DocViewer({ docId }: { docId: string }) {
  const { s } = useStore();
  const toast = useToast();
  const { openDialog } = useUI();
  const d = s.documents.find((x) => x.id === docId);
  if (!d) return null;
  const v = docValidity(d);
  const card = isCard(d);
  const first = d.files[0]?.file ?? null;
  const until = validUntil(d);
  return (
    <Viewer
      title={d.title}
      onDownload={() => downloadDoc(s, d)}
      onEdit={() => openDialog(<DocFormFor category={d.category} subjectId={d.subjectId} doc={d} />)}
    >
      <div className="viewer-card">
        <div className="eyebrow">{d.type}</div>
        <h2 className="viewer-heading">{d.title}</h2>
        {card && (
          <>
            <IdFlipCard doc={d} large />
            <p className="muted small center">Click the card to flip it</p>
            {d.files.map(
              (f) => isPdf(f.file) && <OpenFileButton key={f.file.key} file={f.file} label={f.role ? `Open the ${f.role} PDF` : `Open ${f.file.name}`} />,
            )}
          </>
        )}
        {!card && first && <FilePreview file={first} alt={d.title} className="viewer-image" />}
        {!card && d.files.map((f) => !isImage(f.file) && <OpenFileButton key={f.file.key} file={f.file} label={`Open ${f.file.name}`} />)}
        <dl className="big-dl">
          {docRows(s, d, true).map(([k, val]) => (
            <div key={k} className="dl-row">
              <div className="dl-text">
                <dt>{k}</dt>
                <dd>{val}</dd>
              </div>
              {k !== 'Routine' && (
                <IconButton
                  icon="copy"
                  label={`Copy ${k}`}
                  onClick={async () => toast.show({ text: (await copyText(val)) ? `Copied ${k.toLowerCase()}` : 'Couldn’t copy. Select the text instead.' })}
                />
              )}
            </div>
          ))}
        </dl>
        {v && <div className={`banner tone-${v.tone}`}>{v.tone === 'bad' && until ? `Expired on ${fmtDate(until)}` : v.text}</div>}
      </div>
    </Viewer>
  );
}

export { StatusText };

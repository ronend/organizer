import { useState, type KeyboardEvent } from 'react';
import type { CooState, DetailRow, DocKind, Document, FileRef, SubjectType } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { useToast } from '../store/Toast';
import { uploadFile } from '../api/client';
import { Dialog, Field, FileImage, Fieldset, FormActions, StatusText, Viewer, isImage, useBusy } from '../components/ui';
import { Icon } from '../components/Icon';
import { fmtDate } from '../lib/dates';
import { assignmentsFor, contactName, contactsFor, docValidity, routineOf, subjectName } from '../lib/model';
import { Tx, makeDocument, renewalRoutineForId, saveDocument } from '../lib/ops';
import { downloadOriginal, getFileUrl, safeFilename, saveBlob, summarySvg } from '../lib/files';

// ── Constants ───────────────────────────────────────────────────────────────

export const ID_TYPES = ['Passport', 'Driver license', 'City or state ID', 'Birth certificate', 'Social Security card', 'Visa or residence card', 'Other'];
export const HEALTH_TYPES = ['Result', 'Referral', 'Prescription', 'Visit summary', 'Imaging', 'Vaccination record', 'Insurance', 'Other'];
export const CAR_TYPES = ['ID card', 'Policy', 'Registration', 'Inspection', 'Receipt', 'Photo', 'Other'];

const ID_FIELDS: Record<string, string[]> = {
  Passport: ['Full name', 'Nationality', 'Place of birth', 'Date of birth'],
  'Driver license': ['Full name', 'Class', 'Restrictions and endorsements', 'Date of birth'],
  'City or state ID': ['Full name', 'Date of birth'],
  'Birth certificate': ['Full name', 'Place of birth', 'Date of birth'],
  'Social Security card': ['Full name'],
  'Visa or residence card': ['Full name', 'Category', 'Nationality'],
  Other: [],
};

export function remindDefault(type: string): number {
  return { Passport: 180, 'Driver license': 60, 'City or state ID': 60 }[type] ?? 90;
}

/** Swap suggested rows for the new type, keeping anything already typed. */
function swapRows(rows: DetailRow[], from: string, to: string): DetailRow[] {
  const oldNames = new Set(ID_FIELDS[from] ?? []);
  const next = (ID_FIELDS[to] ?? []).map((name) => ({ name, value: rows.find((r) => r.name === name)?.value ?? '' }));
  const names = new Set(next.map((r) => r.name));
  for (const r of rows) {
    if (names.has(r.name)) continue;
    if (oldNames.has(r.name) && !r.value) continue;
    if (!r.name && !r.value) continue;
    next.push(r);
  }
  return next;
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

export function DocFormFor(p: {
  kind: DocKind;
  subjectType: SubjectType;
  subjectId: string;
  assignmentId?: string | null;
  docType?: string;
  closeTaskId?: string;
  doc?: Document;
}) {
  if (p.kind === 'identity') return <IdDialog {...p} />;
  if (p.kind === 'health') return <HealthDocDialog {...p} />;
  return <CarDocDialog {...p} />;
}

interface FormProps {
  subjectType: SubjectType;
  subjectId: string;
  assignmentId?: string | null;
  docType?: string;
  closeTaskId?: string;
  doc?: Document;
}

async function maybeUpload(f: File | null): Promise<FileRef | null> {
  return f ? uploadFile(f, f.name) : null;
}

function ImagePicker({
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
    <Field label={label} optional>
      {(id) => (
        <>
          <input id={id} type="file" accept="image/*" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
          {current && (
            <label className="check-row small">
              <input type="checkbox" checked={remove} onChange={(e) => onRemove(e.target.checked)} />
              <span>Remove the current image ({current.name})</span>
            </label>
          )}
        </>
      )}
    </Field>
  );
}

// ── ID ──────────────────────────────────────────────────────────────────────

export function IdDialog({ subjectType, subjectId, assignmentId, docType, closeTaskId, doc }: FormProps) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const toast = useToast();
  const { busy, run } = useBusy();
  const person = s.people.find((p) => p.id === subjectId);
  const initialType = doc?.type ?? docType ?? 'Passport';
  const [name, setName] = useState(doc?.name ?? (person ? `${person.name}’s ${initialType.toLowerCase()}` : ''));
  const [type, setType] = useState(initialType);
  const [idNumber, setIdNumber] = useState(doc?.idNumber ?? '');
  const [issuer, setIssuer] = useState(doc?.issuer ?? '');
  const [issueDate, setIssueDate] = useState(doc?.issueDate ?? '');
  const [expiry, setExpiry] = useState(doc?.validUntil ?? '');
  const [rows, setRows] = useState<DetailRow[]>(doc?.details.length ? doc.details : (ID_FIELDS[initialType] ?? []).map((n) => ({ name: n, value: '' })));
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [rmFront, setRmFront] = useState(false);
  const [rmBack, setRmBack] = useState(false);
  const [linked, setLinked] = useState(doc?.assignmentId ?? assignmentId ?? '');
  const [remind, setRemind] = useState(!doc);
  const [remindDays, setRemindDays] = useState(String(remindDefault(initialType)));
  const [pinned, setPinned] = useState(doc?.pinned ?? false);
  const routines = assignmentsFor(s, subjectType, subjectId, 'identity');

  const changeType = (t: string) => {
    setRows((cur) => swapRows(cur, type, t));
    setRemindDays(String(remindDefault(t)));
    if (person && name === `${person.name}’s ${type.toLowerCase()}`) setName(`${person.name}’s ${t.toLowerCase()}`);
    setType(t);
  };

  const submit = () =>
    run(async () => {
      if (!name.trim()) return;
      let f: FileRef | null = null;
      let b: FileRef | null = null;
      try {
        [f, b] = await Promise.all([maybeUpload(front), maybeUpload(back)]);
      } catch (e) {
        toast.show({ text: `Upload failed: ${e instanceof Error ? e.message : 'error'}` });
        return;
      }
      const base = doc ?? makeDocument({ docKind: 'identity', subjectType, subjectId, name: name.trim(), type });
      let d: Document = {
        ...base,
        name: name.trim(),
        type,
        idNumber: idNumber.trim(),
        issuer: issuer.trim(),
        issueDate: issueDate || null,
        validUntil: expiry || null,
        details: rows.map((r) => ({ name: r.name.trim(), value: r.value.trim() })).filter((r) => r.name && r.value),
        front: f ?? (rmFront ? null : base.front),
        back: b ?? (rmBack ? null : base.back),
        assignmentId: linked || null,
        pinned,
      };
      const tx = new Tx(s);
      let planned: string | null = null;
      if (!linked && remind && expiry) {
        const { assignment, firstDate } = renewalRoutineForId(s, d, Math.max(0, Number(remindDays) || remindDefault(type)), tx);
        d = { ...d, assignmentId: assignment.id };
        planned = firstDate;
      }
      apply(saveDocument(s, d, { closeTaskId }, tx), {
        toast: planned ? `Saved. Renewal reminders planned from ${fmtDate(planned, true)}.` : 'Saved',
      });
      closeDialog();
    });

  return (
    <Dialog
      eyebrow={`${subjectName(s, subjectType, subjectId)} · Identity`}
      title={doc ? `Edit ${doc.name}` : 'Add an ID or document'}
      wide
      onSubmit={submit}
      actions={<FormActions submit={busy ? 'Saving…' : 'Save'} disabled={busy} />}
    >
      <div className="fields">
        <Field label="Name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
        <Field label="Type">
          {(id) => (
            <select id={id} value={type} onChange={(e) => changeType(e.target.value)}>
              {ID_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="fields">
        <Field label="ID number" optional hint="Shown masked to the last four digits in lists.">
          {(id) => <input id={id} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="Issued by" optional>{(id) => <input id={id} value={issuer} onChange={(e) => setIssuer(e.target.value)} />}</Field>
      </div>
      <div className="fields">
        <Field label="Issue date" optional>{(id) => <input id={id} type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />}</Field>
        <Field label="Expiry date" optional>{(id) => <input id={id} type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />}</Field>
      </div>
      <Fieldset legend="More details">
        {rows.map((r, i) => (
          <div key={i} className="fields detail-row">
            <input aria-label="Field name" placeholder="Field" value={r.name} onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input aria-label={r.name || 'Value'} placeholder="Value" value={r.value} onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
          </div>
        ))}
        <button type="button" className="link" onClick={() => setRows((cur) => [...cur, { name: '', value: '' }])}>
          + Add another field
        </button>
      </Fieldset>
      <div className="fields">
        <ImagePicker label="Front image" current={doc?.front ?? null} onFile={setFront} remove={rmFront} onRemove={setRmFront} />
        <ImagePicker label="Back image" current={doc?.back ?? null} onFile={setBack} remove={rmBack} onRemove={setRmBack} />
      </div>
      <p className="muted small">Clicking a card anywhere flips it between front and back.</p>
      <Field label="Linked renewal routine" optional>
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
      {!linked && (
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
        <span>Keep handy</span>
      </label>
    </Dialog>
  );
}

// ── Health ──────────────────────────────────────────────────────────────────

export function HealthDocDialog({ subjectType, subjectId, assignmentId, docType, closeTaskId, doc }: FormProps) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const toast = useToast();
  const { busy, run } = useBusy();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(doc?.name ?? '');
  const [type, setType] = useState(doc?.type ?? docType ?? 'Result');
  const [date, setDate] = useState(doc?.date ?? new Date().toISOString().slice(0, 10));
  const [providerId, setProviderId] = useState(doc?.providerId ?? '');
  const [about, setAbout] = useState(doc?.about ?? '');
  const episodes = [...new Set(s.documents.filter((d) => d.subjectId === subjectId && d.episode).map((d) => d.episode))];
  const [episode, setEpisode] = useState(doc?.episode ?? '');
  const [newEpisode, setNewEpisode] = useState('');
  const [linked, setLinked] = useState(doc?.assignmentId ?? assignmentId ?? '');
  const [pinned, setPinned] = useState(doc?.pinned ?? false);
  const routines = assignmentsFor(s, subjectType, subjectId, 'health');

  const submit = () =>
    run(async () => {
      const n = name.trim() || file?.name || '';
      if (!n) {
        toast.show({ text: 'Give the document a name' });
        return;
      }
      let up: FileRef | null = null;
      try {
        up = await maybeUpload(file);
      } catch (e) {
        toast.show({ text: `Upload failed: ${e instanceof Error ? e.message : 'error'}` });
        return;
      }
      const base = doc ?? makeDocument({ docKind: 'health', subjectType, subjectId, name: n, type });
      const d: Document = {
        ...base,
        name: n,
        type,
        date: date || null,
        providerId: providerId || null,
        about: about.trim(),
        episode: newEpisode.trim() || episode,
        assignmentId: linked || null,
        pinned,
        file: up ?? base.file,
      };
      apply(saveDocument(s, d, { closeTaskId }), { toast: 'Document saved' });
      closeDialog();
    });

  return (
    <Dialog
      eyebrow={`${subjectName(s, subjectType, subjectId)} · Health`}
      title={doc ? `Edit ${doc.name}` : 'Add a health document'}
      wide
      onSubmit={submit}
      actions={<FormActions submit={busy ? 'Saving…' : 'Save'} disabled={busy} />}
    >
      <Field label="File" optional={!!doc}>
        {(id) => <input id={id} type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
      </Field>
      <div className="fields">
        <Field label="Name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="MRI report, left knee" />}</Field>
        <Field label="Type">
          {(id) => (
            <select id={id} value={type} onChange={(e) => setType(e.target.value)}>
              {HEALTH_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="fields">
        <Field label="Document date">{(id) => <input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        <Field label="Provider" optional>
          {(id) => (
            <select id={id} value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              <option value="">None</option>
              {contactsFor(s, 'health').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="What this is about" optional>{(id) => <input id={id} value={about} onChange={(e) => setAbout(e.target.value)} placeholder="One line of context" />}</Field>
      <div className="fields">
        <Field label="Episode" optional>
          {(id) => (
            <select id={id} value={episode} onChange={(e) => setEpisode(e.target.value)} disabled={!!newEpisode.trim()}>
              <option value="">None</option>
              {episodes.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Or start a new episode" optional>{(id) => <input id={id} value={newEpisode} onChange={(e) => setNewEpisode(e.target.value)} placeholder="Knee injury" />}</Field>
      </div>
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
      <label className="check-row">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        <span>Keep handy on this page</span>
      </label>
    </Dialog>
  );
}

// ── Car ─────────────────────────────────────────────────────────────────────

export function CarDocDialog({ subjectType, subjectId, assignmentId, docType, closeTaskId, doc }: FormProps) {
  const { s, apply } = useStore();
  const { closeDialog } = useUI();
  const toast = useToast();
  const { busy, run } = useBusy();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(doc?.name ?? '');
  const [type, setType] = useState(doc?.type ?? docType ?? 'ID card');
  const [validUntil, setValidUntil] = useState(doc?.validUntil ?? '');
  const [linked, setLinked] = useState(doc?.assignmentId ?? assignmentId ?? '');
  const [pinned, setPinned] = useState(doc?.pinned ?? !doc);
  const routines = assignmentsFor(s, subjectType, subjectId);

  const submit = () =>
    run(async () => {
      const n = name.trim() || file?.name || '';
      if (!n) {
        toast.show({ text: 'Give the document a name' });
        return;
      }
      let up: FileRef | null = null;
      try {
        up = await maybeUpload(file);
      } catch (e) {
        toast.show({ text: `Upload failed: ${e instanceof Error ? e.message : 'error'}` });
        return;
      }
      const base = doc ?? makeDocument({ docKind: 'car', subjectType, subjectId, name: n, type });
      const d: Document = { ...base, name: n, type, validUntil: validUntil || null, assignmentId: linked || null, pinned, file: up ?? base.file };
      const archives = !doc && linked && s.documents.some((o) => o.assignmentId === linked && o.type === type && !o.archived);
      apply(saveDocument(s, d, { closeTaskId }), { toast: archives ? 'Saved. The older one was archived' : 'Document saved' });
      closeDialog();
    });

  return (
    <Dialog
      eyebrow={`${subjectName(s, subjectType, subjectId)} · Documents`}
      title={doc ? `Edit ${doc.name}` : 'Add a car document'}
      onSubmit={submit}
      actions={<FormActions submit={busy ? 'Saving…' : 'Save'} disabled={busy} />}
    >
      <Field label="File" optional={!!doc}>
        {(id) => <input id={id} type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
      </Field>
      <div className="fields">
        <Field label="Name">{(id) => <input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="Insurance card" />}</Field>
        <Field label="Type">
          {(id) => (
            <select id={id} value={type} onChange={(e) => setType(e.target.value)}>
              {CAR_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div className="fields">
        <Field label="Valid until" optional>{(id) => <input id={id} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}</Field>
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
      </div>
      <label className="check-row">
        <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
        <span>Keep in the glovebox</span>
      </label>
    </Dialog>
  );
}

// ── ID card flip ────────────────────────────────────────────────────────────

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
        <FileImage file={f} alt={`${doc.name}, ${which}`} className="flip-img" />
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
      aria-label={`${doc.name}: showing the ${flipped ? 'back' : 'front'}. Press to flip.`}
      onClick={() => toggleFlip(doc.id)}
      onKeyDown={onKey}
    >
      <div className="flip-inner">
        {side(doc.front, 'front')}
        {side(doc.back, 'back')}
      </div>
    </div>
  );
}

// ── Viewer and download ─────────────────────────────────────────────────────

function docRows(s: CooState, d: Document, full: boolean): [string, string][] {
  const rows: [string, string][] = [];
  if (d.docKind === 'identity') {
    rows.push(['ID number', full ? d.idNumber : d.idNumber ? `•••• ${d.idNumber.slice(-4)}` : '']);
    rows.push(['Issued by', d.issuer]);
    rows.push(['Issued', fmtDate(d.issueDate)]);
    rows.push(['Expires', fmtDate(d.validUntil)]);
    for (const r of d.details) rows.push([r.name, r.value]);
  } else if (d.docKind === 'health') {
    rows.push(['Date', fmtDate(d.date)]);
    rows.push(['Provider', contactName(s, d.providerId)]);
    rows.push(['About', d.about]);
    rows.push(['Episode', d.episode]);
  } else {
    rows.push(['Valid until', fmtDate(d.validUntil)]);
  }
  const a = s.assignments.find((x) => x.id === d.assignmentId);
  const r = routineOf(s, a);
  if (r) rows.push(['Routine', r.title]);
  return rows.filter(([, v]) => v);
}

export async function downloadDoc(s: CooState, d: Document) {
  if (d.docKind === 'identity') {
    const images = [d.front, d.back].filter((x): x is FileRef => !!x);
    const blob = await summarySvg({ title: d.name, typeLabel: d.type, rows: docRows(s, d, true), images });
    saveBlob(blob, `${safeFilename(d.name)}.svg`);
    return;
  }
  if (d.file) {
    await downloadOriginal(d.file);
    return;
  }
  const blob = await summarySvg({ title: d.name, typeLabel: d.type, rows: docRows(s, d, true), images: [] });
  saveBlob(blob, `${safeFilename(d.name)}.svg`);
}

export function openDocViewer(ui: ReturnType<typeof useUI>, _s: CooState, d: Document) {
  ui.openViewer(<DocViewer docId={d.id} />);
}

export function DocViewer({ docId }: { docId: string }) {
  const { s } = useStore();
  const d = s.documents.find((x) => x.id === docId);
  if (!d) return null;
  const v = docValidity(d);
  return (
    <Viewer title={d.name} onDownload={() => downloadDoc(s, d)}>
      <div className="viewer-card">
        <div className="eyebrow">{d.type}</div>
        <h2 className="viewer-heading">{d.name}</h2>
        {d.docKind === 'identity' && (
          <>
            <IdFlipCard doc={d} large />
            <p className="muted small center">Click the card to flip it</p>
          </>
        )}
        {d.docKind !== 'identity' && d.file && isImage(d.file) && <FileImage file={d.file} alt={d.name} className="viewer-image" />}
        {d.docKind !== 'identity' && d.file && !isImage(d.file) && (
          <button
            type="button"
            className="btn secondary"
            onClick={async () => {
              const url = await getFileUrl(d.file!.key);
              if (url) window.open(url, '_blank', 'noopener');
            }}
          >
            <Icon name="document" /> Open {d.file.name}
          </button>
        )}
        <dl className="big-dl">
          {docRows(s, d, true).map(([k, val]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{val}</dd>
            </div>
          ))}
        </dl>
        {v && (
          <div className={`banner tone-${v.tone}`}>
            {v.tone === 'bad' && d.validUntil ? `Expired on ${fmtDate(d.validUntil)}` : v.text}
          </div>
        )}
      </div>
    </Viewer>
  );
}

export { StatusText };

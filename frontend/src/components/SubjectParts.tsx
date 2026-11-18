import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Assignment, CooState, Document, RoutineArea, Subject } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Empty, IconButton, Segmented, SectionHead, StatusText, isImage } from './ui';
import { useFileUrl } from '../lib/files';
import { Icon } from './Icon';
import { TaskRow } from './TaskRow';
import { SubjectSwitcher, pagesFor } from './Shell';
import { RoutineDetailDialog } from '../dialogs/RoutineDetail';
import { AssignExistingDialog, RoutineFormDialog } from '../dialogs/RoutineForm';
import { DocFormFor, DocViewer, downloadDoc } from '../dialogs/DocDialogs';
import { dueLabel, fmtDate, plural, today } from '../lib/dates';
import {
  assignmentStatus,
  byDate,
  contactName,
  docValidity,
  docsOfAssignment,
  fileOf,
  isAdHoc,
  maskId,
  nextStep,
  routineOf,
  scheduleLine,
  subjectName,
  subjectPath,
  tasksForSubject,
  validUntil,
} from '../lib/model';
import { CATEGORIES, categoryFields, fieldText } from '../lib/registry';
import { addTask, setArchived } from '../lib/ops';

/** Mobile switcher + segmented control for the subject's pages. */
export function SubjectNav({ sub, page }: { sub: Subject; page: string }) {
  const navigate = useNavigate();
  return (
    <div className="subject-nav mobile-only">
      <SubjectSwitcher />
      <Segmented
        label="Pages"
        value={page}
        onChange={(v) => navigate(subjectPath(sub, v))}
        options={pagesFor(sub.subjectType)}
      />
    </div>
  );
}

export function RoutineCard({ a }: { a: Assignment }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const r = routineOf(s, a);
  if (!r) return null;
  const st = assignmentStatus(s, a);
  const next = nextStep(s, a);
  const docs = docsOfAssignment(s, a).length;
  return (
    <button type="button" className="tile routine-card" onClick={() => openDialog(<RoutineDetailDialog assignmentId={a.id} />)}>
      <span className="card-top">
        <Icon name={r.icon} />
        <StatusText tone={st.tone} text={st.text} />
      </span>
      <span className="tile-title">{r.title}</span>
      {r.description && <span className="clamp2 muted">{r.description}</span>}
      <span className="small">{scheduleLine(s, a)}</span>
      {next && (
        <span className="small muted">
          Next: {next.title} · {dueLabel(next.date).text}
        </span>
      )}
      {docs > 0 && <span className="small muted">{plural(docs, 'document')}</span>}
    </button>
  );
}

export function RoutineGrid({ sub, area, title }: { sub: Subject; area: RoutineArea; title: string }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const list = s.assignments
    .filter((a) => a.subjectId === sub.id && routineOf(s, a)?.area === area)
    .sort((x, y) => (x.date ?? '9999').localeCompare(y.date ?? '9999'));
  const target = sub.id;
  return (
    <section className="section">
      <SectionHead
        title={title}
        count={list.length}
        action={
          <button type="button" className="link" onClick={() => openDialog(<RoutineFormDialog preselect={target} area={area} />)}>
            Add routine
          </button>
        }
      />
      {list.length === 0 && <Empty>No routines yet. Add one, or assign an existing routine.</Empty>}
      <div className="card-grid">
        {list.map((a) => (
          <RoutineCard key={a.id} a={a} />
        ))}
        <button type="button" className="tile dashed" onClick={() => openDialog(<AssignExistingDialog subjectId={target} area={area} />)}>
          <Icon name="plus" /> Assign an existing routine
        </button>
      </div>
    </section>
  );
}

export function UpcomingAppointments({ id }: { id: string }) {
  const { s } = useStore();
  const list = tasksForSubject(s, id)
    .filter((t) => t.appointment && !t.done && (t.date ?? '') >= today())
    .sort(byDate);
  if (list.length === 0) return null;
  return (
    <section className="section">
      <SectionHead title="Upcoming appointments" count={list.length} />
      <ul className="list">
        {list.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ul>
    </section>
  );
}

export function SubjectTasks({ id, all }: { id: string; all?: boolean }) {
  const { s, apply } = useStore();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today());
  const list = tasksForSubject(s, id)
    .filter((t) => !t.done && !t.appointment && (all || isAdHoc(t)))
    .sort(byDate);
  return (
    <section className="section">
      <SectionHead title="Tasks" count={list.length} />
      {list.length > 0 && (
        <ul className="list">
          {list.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
        </ul>
      )}
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          apply(addTask(s, { title: title.trim(), date: date || null, subjectId: id }), { toast: 'Added to your agenda' });
          setTitle('');
        }}
      >
        <input aria-label="New task" placeholder="Add a task" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input aria-label="Task date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="submit" className="btn secondary small">
          Add
        </button>
      </form>
    </section>
  );
}

export function useDocActions() {
  const { s, apply } = useStore();
  const ui = useUI();
  return {
    show: (d: Document) => ui.openViewer(<DocViewer docId={d.id} />),
    download: (d: Document) => downloadDoc(s, d),
    archive: (d: Document) => apply(setArchived(s, d, true), { toast: `Archived ${d.title}`, undo: true }),
    restore: (d: Document) => apply(setArchived(s, d, false), { toast: `Restored ${d.title}` }),
    edit: (d: Document) => ui.openDialog(<DocFormFor category={d.category} subjectId={d.subjectId} doc={d} />),
  };
}

/** Small preview: the first image file (an ID's front); the category's icon otherwise. */
export function DocThumb({ d }: { d: Document }) {
  const img = (fileOf(d, 'front') && isImage(fileOf(d, 'front')) ? fileOf(d, 'front') : d.files.map((f) => f.file).find((f) => isImage(f))) ?? null;
  const url = useFileUrl(img);
  const card = CATEGORIES[d.category].fileRoles.includes('front');
  return (
    <span className={`doc-thumb ${card ? 'id' : ''}`} aria-hidden="true">
      {img && url ? <img src={url} alt="" /> : <Icon name={CATEGORIES[d.category].icon} size={20} />}
    </span>
  );
}

/** The detail lines under a document's title, from its registry fields. */
function docMeta(s: CooState, d: Document): string[] {
  const r = routineOf(s, s.assignments.find((a) => a.id === d.assignmentId));
  const f = (k: string) => fieldText(d.fields, k);
  const until = validUntil(d);
  if (d.category === 'identity') {
    return [
      [d.type, f('issuer')].filter(Boolean).join(' · '),
      [f('idNumber') ? `No. ${maskId(f('idNumber'))}` : '', until ? `Expires ${fmtDate(until)}` : ''].filter(Boolean).join(' · '),
    ].filter(Boolean);
  }
  if (d.category === 'health') {
    return [[d.type, fmtDate(d.date), contactName(s, f('providerId') || null), f('episode')].filter(Boolean).join(' · ')];
  }
  return [[d.type, until ? `Valid until ${fmtDate(until)}` : '', fmtDate(d.date), r?.title].filter(Boolean).join(' · ')];
}

/**
 * One document in a list: thumbnail, name and details. Clicking opens it full
 * screen, where it can be edited or downloaded. Archive stays on the row.
 */
export function DocRow({ d, actions = true, showSubject = false }: { d: Document; actions?: boolean; showSubject?: boolean }) {
  const { s } = useStore();
  const act = useDocActions();
  const v = docValidity(d);
  const a = s.assignments.find((x) => x.id === d.assignmentId);
  const renewal = CATEGORIES[d.category].rules.renewal && a ? assignmentStatus(s, a) : null;
  return (
    <li className={`row doc-row ${d.archived ? 'archived' : ''}`}>
      <button type="button" className="row-main row-body with-icon" onClick={() => act.show(d)} aria-label={`Show ${d.title}`}>
        <DocThumb d={d} />
        <span className="row-main">
          <span className="row-title">{d.title}</span>
          {showSubject && <span className="row-meta strong">{subjectName(s, d.subjectId)}</span>}
          {docMeta(s, d).map((line, i) => (
            <span key={i} className="row-meta">
              {line}
            </span>
          ))}
          {renewal && <span className="row-meta">Renewal: {renewal.text}</span>}
        </span>
      </button>
      {v && !d.archived && <StatusText tone={v.tone} text={v.text} />}
      {actions && (
        <span className="row-actions">
          {d.archived ? (
            <button type="button" className="btn ghost small" onClick={() => act.restore(d)}>
              Restore
            </button>
          ) : (
            <IconButton icon="archive" label={`Archive ${d.title}`} onClick={() => act.archive(d)} />
          )}
        </span>
      )}
    </li>
  );
}

export function DocList({ docs, showSubject = false }: { docs: Document[]; showSubject?: boolean }) {
  return (
    <ul className="list doc-list">
      {docs.map((d) => (
        <DocRow key={d.id} d={d} showSubject={showSubject} />
      ))}
    </ul>
  );
}

/** "Keep handy" / "In the glovebox": pinned documents, as a list. */
export function PinnedTiles({ docs, title }: { docs: Document[]; title: string }) {
  if (docs.length === 0) return null;
  return (
    <section className="section">
      <SectionHead title={title} count={docs.length} />
      <DocList docs={docs} />
    </section>
  );
}

export function ArchiveSection({ docs, showSubject = false }: { docs: Document[]; showSubject?: boolean }) {
  const [open, setOpen] = useState(false);
  if (docs.length === 0) return null;
  return (
    <section className="section">
      <SectionHead
        title={`Archive (${docs.length})`}
        action={
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Hide' : 'Show'}
          </button>
        }
      />
      {open && <DocList docs={docs} showSubject={showSubject} />}
    </section>
  );
}

export function docSearch(q: string, d: Document, s: CooState): boolean {
  if (!q.trim()) return true;
  const values = categoryFields(d.category, d.type).map((f) =>
    f.type === 'contact' ? contactName(s, fieldText(d.fields, f.key) || null) : f.type === 'secret' ? '' : fieldText(d.fields, f.key),
  );
  const hay = [d.title, d.type, ...values, ...d.customFields.map((r) => r.value)].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

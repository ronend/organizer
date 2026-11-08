import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Area, Assignment, Document, SubjectType } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Empty, IconButton, Segmented, SectionHead, StatusText } from './ui';
import { Icon } from './Icon';
import { TaskRow } from './TaskRow';
import { SubjectSwitcher, CAR_PAGES, PERSON_PAGES } from './Shell';
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
  isAdHoc,
  nextStep,
  routineOf,
  scheduleLine,
  subjectPath,
  tasksForSubject,
  type Subject,
} from '../lib/model';
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
        onChange={(v) => navigate(subjectPath(sub.type, sub.entity.id, v))}
        options={sub.type === 'person' ? PERSON_PAGES : CAR_PAGES}
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

export function RoutineGrid({ sub, area, title }: { sub: Subject; area: Area; title: string }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const list = s.assignments
    .filter((a) => a.subjectType === sub.type && a.subjectId === sub.entity.id && routineOf(s, a)?.area === area)
    .sort((x, y) => (x.date ?? '9999').localeCompare(y.date ?? '9999'));
  const target = { type: sub.type, id: sub.entity.id };
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
        <button type="button" className="tile dashed" onClick={() => openDialog(<AssignExistingDialog subject={target} area={area} />)}>
          <Icon name="plus" /> Assign an existing routine
        </button>
      </div>
    </section>
  );
}

export function UpcomingAppointments({ type, id }: { type: SubjectType; id: string }) {
  const { s } = useStore();
  const list = tasksForSubject(s, type, id)
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

export function SubjectTasks({ type, id, all }: { type: SubjectType; id: string; all?: boolean }) {
  const { s, apply } = useStore();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(today());
  const list = tasksForSubject(s, type, id)
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
          apply(addTask(s, { title: title.trim(), date: date || null, subjectType: type, subjectId: id }), { toast: 'Added to your agenda' });
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
    archive: (d: Document) => apply(setArchived(s, d, true), { toast: `Archived ${d.name}`, undo: true }),
    restore: (d: Document) => apply(setArchived(s, d, false), { toast: `Restored ${d.name}` }),
    edit: (d: Document) => ui.openDialog(<DocFormFor kind={d.docKind} subjectType={d.subjectType} subjectId={d.subjectId} doc={d} />),
  };
}

export function DocActions({ d }: { d: Document }) {
  const act = useDocActions();
  return (
    <span className="row-actions">
      <IconButton icon="monitor" label={`Show ${d.name}`} onClick={() => act.show(d)} />
      <IconButton icon="download" label={`Download ${d.name}`} onClick={() => act.download(d)} />
      <IconButton icon="archive" label={`Archive ${d.name}`} onClick={() => act.archive(d)} />
    </span>
  );
}

export function PinnedTiles({ docs, title }: { docs: Document[]; title: string }) {
  const act = useDocActions();
  if (docs.length === 0) return null;
  return (
    <section className="section">
      <SectionHead title={title} count={docs.length} />
      <div className="card-grid small-cards">
        {docs.map((d) => {
          const v = docValidity(d);
          return (
            <button key={d.id} type="button" className="tile handy-tile" onClick={() => act.show(d)}>
              <Icon name={d.docKind === 'identity' ? 'idcard' : 'document'} />
              <span className="tile-title">{d.name}</span>
              <span className="muted small">{d.type}</span>
              {v && <StatusText tone={v.tone} text={v.text} className="small" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function DocRow({ d }: { d: Document }) {
  const { s } = useStore();
  const act = useDocActions();
  const v = docValidity(d);
  const r = routineOf(s, s.assignments.find((a) => a.id === d.assignmentId));
  const meta = [d.type, d.docKind === 'health' ? fmtDate(d.date) : '', d.docKind === 'health' ? contactName(s, d.providerId) : '', r?.title].filter(Boolean).join(' · ');
  return (
    <li className="row doc-row">
      <button type="button" className="row-main row-body with-icon" onClick={() => act.edit(d)}>
        <Icon name="document" />
        <span className="row-main">
          <span className="row-title">{d.name}</span>
          <span className="row-meta">{meta}</span>
        </span>
      </button>
      {v && <StatusText tone={v.tone} text={v.text} />}
      <DocActions d={d} />
    </li>
  );
}

export function ArchiveSection({ docs }: { docs: Document[] }) {
  const [open, setOpen] = useState(false);
  const act = useDocActions();
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
      {open && (
        <ul className="list">
          {docs.map((d) => (
            <li key={d.id} className="row doc-row archived">
              <span className="row-main">
                <span className="row-title">{d.name}</span>
                <span className="row-meta">
                  {d.type}
                  {d.outdated ? ' · Outdated' : ''}
                </span>
              </span>
              <span className="row-actions">
                <IconButton icon="monitor" label={`Show ${d.name}`} onClick={() => act.show(d)} />
                <button type="button" className="btn ghost small" onClick={() => act.restore(d)}>
                  Restore
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function docSearch(q: string, d: Document, s: ReturnType<typeof useStore>['s']): boolean {
  if (!q.trim()) return true;
  const hay = [d.name, d.type, d.about, d.episode, contactName(s, d.providerId), ...d.details.map((r) => r.value)].join(' ').toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

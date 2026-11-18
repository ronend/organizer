/**
 * One page per subject (people, cars and any other type, including the
 * household's own; trips have TripPage). The subject's details, then every
 * section that has content, one after the other — appointments, tasks,
 * routines per area, pinned documents, documents per category, archive —
 * each of which can be toggled off (SectionStack). Empty sections are hidden;
 * the "Add" menu creates the first item of any of them.
 */
import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { DocCategory, Document, Subject } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Empty, PageHead, SectionHead } from '../components/ui';
import { Icon } from '../components/Icon';
import { fieldDisplay } from '../components/FieldInputs';
import { SectionStack, type PageSection } from '../components/SectionStack';
import { HealthHistory } from '../components/HealthHistory';
import { DocList, DocRow, RoutineGrid, SubjectNav, SubjectTasks, UpcomingAppointments, docSearch } from '../components/SubjectParts';
import { SubjectDialog } from '../dialogs/SubjectDialogs';
import { DocFormFor } from '../dialogs/DocDialogs';
import { AddTaskDialog } from '../dialogs/TaskDialogs';
import { RoutineFormDialog } from '../dialogs/RoutineForm';
import { byDate, findSubject, isAdHoc, routineOf, subjectIcon, subjectSub, tasksForSubject } from '../lib/model';
import { today } from '../lib/dates';
import { CATEGORIES, ROUTINE_AREAS, SUBJECT_TYPES, allows } from '../lib/registry';

const SECTION_TITLE: Partial<Record<DocCategory, string>> = {
  identity: 'IDs and documents',
  health: 'Treatment history',
  car: 'Documents',
  attachment: 'Files',
};

/** Link text in a category's section head. */
const ADD_LINK: Partial<Record<DocCategory, string>> = {
  identity: 'Add ID or document',
  health: 'Add document',
  car: 'Add document',
  attachment: 'Add a file',
};

const ADD_LABEL: Partial<Record<DocCategory, string>> = {
  identity: 'ID or document',
  health: 'Health document',
  car: 'Car document',
  attachment: 'File',
};

function Details({ sub }: { sub: Subject }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const info = SUBJECT_TYPES[sub.subjectType];
  // A plate-like attribute is shown as a badge; the rest as lines under the name.
  const badge = info.attributes.find((d) => d.normalize === 'plate');
  const lines = info.attributes
    .filter((d) => d !== badge && !d.deprecated)
    .map((d) => {
      const v = fieldDisplay(s, d, sub.attributes);
      if (!v) return '';
      if (d.key === 'odometer' && typeof sub.attributes.odometer === 'number') return `${sub.attributes.odometer.toLocaleString()} on the odometer`;
      if (d.key === 'birthYear') return `Born ${v}`;
      return `${d.label}: ${v}`;
    })
    .filter(Boolean);
  const badgeText = badge ? fieldDisplay(s, badge, sub.attributes) : '';
  return (
    <div className="subject-block">
      <Icon name={subjectIcon(sub)} size={22} />
      <div>
        <div className="subject-name">{sub.name}</div>
        {lines.map((l) => (
          <div key={l} className="muted">
            {l}
          </div>
        ))}
        {sub.notes && <div className="small pre">{sub.notes}</div>}
      </div>
      {badgeText && (
        <span className="plate" aria-label={`${badge!.label} ${badgeText}`}>
          {badgeText}
        </span>
      )}
      <button type="button" className="btn ghost small" onClick={() => openDialog(<SubjectDialog subjectType={sub.subjectType} sub={sub} />)}>
        Edit
      </button>
    </div>
  );
}

/** "Add" menu: the first item of any section, including the hidden empty ones. */
function AddMenu({ sub }: { sub: Subject }) {
  const { openDialog } = useUI();
  const [open, setOpen] = useState(false);
  const info = SUBJECT_TYPES[sub.subjectType];
  const items: { label: string; run: () => void }[] = [];
  if (allows(sub.subjectType, 'task')) items.push({ label: 'Task', run: () => openDialog(<AddTaskDialog initialFor={sub.id} />) });
  if (allows(sub.subjectType, 'assignment')) {
    for (const area of info.routineAreas) {
      items.push({
        label: info.routineAreas.length > 1 ? `${ROUTINE_AREAS[area].label} routine` : 'Routine',
        run: () => openDialog(<RoutineFormDialog preselect={sub.id} area={area} />),
      });
    }
  }
  if (allows(sub.subjectType, 'document')) {
    for (const k of info.documentCategories) {
      items.push({ label: ADD_LABEL[k] ?? `${CATEGORIES[k].label} document`, run: () => openDialog(<DocFormFor category={k} subjectId={sub.id} />) });
    }
  }
  if (items.length === 0) return null;
  return (
    <div className="add-menu">
      <button type="button" className="btn primary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="plus" /> Add
      </button>
      {open && (
        <div className="add-menu-list" role="menu">
          {items.map((x) => (
            <button
              key={x.label}
              type="button"
              role="menuitem"
              className="add-menu-item"
              onClick={() => {
                setOpen(false);
                x.run();
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryDocs({ sub, kind }: { sub: Subject; kind: DocCategory }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const [q, setQ] = useState('');
  const live = s.documents.filter((d) => d.subjectId === sub.id && d.category === kind && !d.attachedTo && !d.archived);
  const shown = live.filter((d) => docSearch(q, d, s)).sort((a, b) => (kind === 'identity' ? a.createdAt.localeCompare(b.createdAt) : a.title.localeCompare(b.title)));
  return (
    <section className="section">
      <SectionHead
        title={SECTION_TITLE[kind] ?? CATEGORIES[kind].plural}
        count={live.length}
        action={
          <button type="button" className="link" onClick={() => openDialog(<DocFormFor category={kind} subjectId={sub.id} />)}>
            {ADD_LINK[kind] ?? 'Add document'}
          </button>
        }
      />
      {live.length > 5 && (
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" aria-label={`Search ${CATEGORIES[kind].plural.toLowerCase()}`} placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      )}
      {shown.length === 0 ? (
        <Empty>Nothing matches.</Empty>
      ) : (
        <ul className="list doc-list">
          {shown.map((d) => (
            <DocRow key={d.id} d={d} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Every non-empty section of a subject, in page order. */
function sectionsFor(s: ReturnType<typeof useStore>['s'], sub: Subject): PageSection[] {
  const info = SUBJECT_TYPES[sub.subjectType];
  const out: PageSection[] = [];
  const mine = tasksForSubject(s, sub.id);
  const appointments = mine.filter((t) => t.appointment && !t.done && (t.date ?? '') >= today());
  if (appointments.length) out.push({ key: 'appointments', title: 'Appointments', count: appointments.length, render: () => <UpcomingAppointments id={sub.id} /> });
  const tasks = mine.filter((t) => !t.done && !t.appointment && isAdHoc(t)).sort(byDate);
  if (tasks.length) out.push({ key: 'tasks', title: 'Tasks', count: tasks.length, render: () => <SubjectTasks id={sub.id} /> });

  if (allows(sub.subjectType, 'assignment')) {
    for (const area of info.routineAreas) {
      const n = s.assignments.filter((a) => a.subjectId === sub.id && routineOf(s, a)?.area === area).length;
      const title = info.routineAreas.length > 1 ? `${ROUTINE_AREAS[area].label} routines` : 'Routines';
      if (n) out.push({ key: `routines-${area}`, title, count: n, render: () => <RoutineGrid sub={sub} area={area} title={title} /> });
    }
  }

  const docs = s.documents.filter((d) => d.subjectId === sub.id && !d.attachedTo);
  const live = docs.filter((d) => !d.archived);
  const pinned = live.filter((d) => d.pinned);
  if (pinned.length) {
    const main = info.documentCategories.find((k) => k !== 'attachment') ?? 'attachment';
    out.push({
      key: 'pinned',
      title: CATEGORIES[main].pinnedTitle,
      count: pinned.length,
      render: () => (
        <section className="section">
          <SectionHead title={CATEGORIES[main].pinnedTitle} count={pinned.length} />
          <DocList docs={pinned} />
        </section>
      ),
    });
  }
  for (const k of info.documentCategories) {
    const n = live.filter((d) => d.category === k).length;
    // Past health visits count too: the history shows them alongside documents.
    const visits = k === 'health' ? mine.filter((t) => t.appointment && t.done && routineOf(s, s.assignments.find((a) => a.id === (t.source?.kind === 'assignment' ? t.source.id : '')))?.area === 'health').length : 0;
    if (!n && !visits) continue;
    out.push({
      key: `docs-${k}`,
      title: SECTION_TITLE[k] ?? CATEGORIES[k].plural,
      // Same count as the section's header: documents (or the past visits when there are none).
      count: n || visits,
      render: () => (k === 'health' ? <HealthHistory person={sub} /> : <CategoryDocs sub={sub} kind={k} />),
    });
  }
  const archived = docs.filter((d) => d.archived);
  if (archived.length) out.push({ key: 'archive', title: 'Archive', count: archived.length, render: () => <ArchivedDocs docs={archived} /> });
  return out;
}

function ArchivedDocs({ docs }: { docs: Document[] }) {
  return (
    <section className="section">
      <SectionHead title="Archive" count={docs.length} />
      <DocList docs={docs} />
    </section>
  );
}

export default function SubjectPage() {
  const { id } = useParams();
  const { s } = useStore();
  const sub = findSubject(s, id);
  if (!sub || sub.subjectType === 'trip') return <Navigate to="/" replace />;
  if (!SUBJECT_TYPES[sub.subjectType]) return <Navigate to="/" replace />;
  const extra = subjectSub(sub);
  const sections = sectionsFor(s, sub);
  return (
    <div className="page">
      <SubjectNav />
      <PageHead eyebrow={extra || SUBJECT_TYPES[sub.subjectType].label} title={sub.name} actions={<AddMenu sub={sub} />} />
      <Details sub={sub} />
      {sections.length === 0 ? (
        <Empty>Nothing here yet. Use Add to create the first task, routine or document.</Empty>
      ) : (
        <SectionStack scope={sub.subjectType} sections={sections} />
      )}
    </div>
  );
}

/**
 * The page of any subject without a dedicated one (cars, and every subject
 * type added to the registry later): an overview built from the type's
 * registry attributes, tasks and routines, and a Documents page covering all
 * the type's document categories. People have PersonPage; trips TripPage.
 */
import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { DocCategory, Subject } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Empty, PageHead, SectionHead } from '../components/ui';
import { Icon } from '../components/Icon';
import { fieldDisplay } from '../components/FieldInputs';
import {
  ArchiveSection,
  DocRow,
  PinnedTiles,
  RoutineGrid,
  SubjectNav,
  SubjectTasks,
  UpcomingAppointments,
  docSearch,
} from '../components/SubjectParts';
import { SubjectDialog } from '../dialogs/SubjectDialogs';
import { DocFormFor } from '../dialogs/DocDialogs';
import { findSubject, subjectIcon, subjectSub } from '../lib/model';
import { CATEGORIES, ROUTINE_AREAS, SUBJECT_TYPES, allows } from '../lib/registry';

const EMPTY_HINT: Partial<Record<DocCategory, string>> = {
  car: 'Add the insurance card, registration and inspection report.',
};

function Overview({ sub }: { sub: Subject }) {
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
      return `${d.label}: ${v}`;
    })
    .filter(Boolean);
  const badgeText = badge ? fieldDisplay(s, badge, sub.attributes) : '';
  return (
    <>
      <div className="subject-block">
        <Icon name={subjectIcon(sub)} size={22} />
        <div>
          <div className="subject-name">{sub.name}</div>
          {lines.map((l) => (
            <div key={l} className="muted">
              {l}
            </div>
          ))}
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
      {sub.notes && <p className="pre">{sub.notes}</p>}
      {allows(sub.subjectType, 'task') && (
        <>
          <UpcomingAppointments id={sub.id} />
          <SubjectTasks id={sub.id} />
        </>
      )}
      {allows(sub.subjectType, 'assignment') &&
        info.routineAreas.map((area) => (
          <RoutineGrid key={area} sub={sub} area={area} title={info.routineAreas.length > 1 ? `${ROUTINE_AREAS[area].label} routines` : 'Routines'} />
        ))}
    </>
  );
}

function Documents({ sub }: { sub: Subject }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const [q, setQ] = useState('');
  const kinds = SUBJECT_TYPES[sub.subjectType].documentCategories;
  // Attachments of tasks/reservations live with those; this page lists the subject's own documents.
  const docs = s.documents.filter((d) => d.subjectId === sub.id && kinds.includes(d.category) && !d.attachedTo);
  const live = docs.filter((d) => !d.archived);
  const shown = live.filter((d) => docSearch(q, d, s)).sort((a, b) => a.title.localeCompare(b.title));
  const main = kinds.find((k) => k !== 'attachment') ?? kinds[0];
  return (
    <>
      <PinnedTiles title={CATEGORIES[main].pinnedTitle} docs={live.filter((d) => d.pinned)} />
      <section className="section">
        <SectionHead
          title="All documents"
          count={live.length}
          action={
            <span className="row-actions">
              {kinds.map((k) => (
                <button key={k} type="button" className="link" onClick={() => openDialog(<DocFormFor category={k} subjectId={sub.id} />)}>
                  {k === 'attachment' ? 'Add a file' : kinds.length > 1 ? `Add ${CATEGORIES[k].label.toLowerCase()} document` : 'Add document'}
                </button>
              ))}
            </span>
          }
        />
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" aria-label="Search documents" placeholder="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {shown.length === 0 ? (
          <Empty>{q ? 'Nothing matches.' : `No documents yet. ${EMPTY_HINT[main] ?? ''}`.trim()}</Empty>
        ) : (
          <ul className="list">
            {shown.map((d) => (
              <DocRow key={d.id} d={d} />
            ))}
          </ul>
        )}
      </section>
      <ArchiveSection docs={docs.filter((d) => d.archived)} />
    </>
  );
}

export default function SubjectPage({ page }: { page: 'overview' | 'documents' }) {
  const { id } = useParams();
  const { s } = useStore();
  const sub = findSubject(s, id);
  if (!sub || sub.subjectType === 'person' || sub.subjectType === 'trip') return <Navigate to="/" replace />;
  const extra = subjectSub(sub);
  return (
    <div className="page">
      <SubjectNav sub={sub} page={page} />
      <PageHead
        eyebrow={page === 'overview' ? extra || SUBJECT_TYPES[sub.subjectType].label : [sub.name, extra].filter(Boolean).join(' · ')}
        title={page === 'overview' ? sub.name : 'Documents'}
      />
      {page === 'overview' ? <Overview sub={sub} /> : <Documents sub={sub} />}
    </div>
  );
}

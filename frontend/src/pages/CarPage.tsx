import { useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import type { Car } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Empty, PageHead, SectionHead } from '../components/ui';
import { Icon } from '../components/Icon';
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
import { CarDialog } from '../dialogs/SubjectDialogs';
import { DocFormFor } from '../dialogs/DocDialogs';
import { docsFor } from '../lib/model';

function Overview({ car }: { car: Car }) {
  const { openDialog } = useUI();
  return (
    <>
      <div className="subject-block">
        <Icon name="car" size={22} />
        <div>
          <div className="subject-name">{car.makeModel}</div>
          {car.odometer != null && <div className="muted">{car.odometer.toLocaleString()} on the odometer</div>}
        </div>
        <span className="plate" aria-label={`Plate ${car.plate}`}>
          {car.plate}
        </span>
        <button type="button" className="btn ghost small" onClick={() => openDialog(<CarDialog car={car} />)}>
          Edit
        </button>
      </div>
      <UpcomingAppointments type="car" id={car.id} />
      <SubjectTasks type="car" id={car.id} />
      <RoutineGrid sub={{ type: 'car', entity: car }} area="car" title="Routines" />
    </>
  );
}

function Documents({ car }: { car: Car }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const [q, setQ] = useState('');
  const docs = docsFor(s, 'car', car.id, 'car');
  const live = docs.filter((d) => !d.archived);
  const shown = live.filter((d) => docSearch(q, d, s)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <PinnedTiles title="In the glovebox" docs={live.filter((d) => d.pinned)} />
      <section className="section">
        <SectionHead
          title="All documents"
          count={live.length}
          action={
            <button type="button" className="link" onClick={() => openDialog(<DocFormFor kind="car" subjectType="car" subjectId={car.id} />)}>
              Add document
            </button>
          }
        />
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" aria-label="Search documents" placeholder="Search documents" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {shown.length === 0 ? (
          <Empty>{q ? 'Nothing matches.' : 'No documents yet. Add the insurance card, registration and inspection report.'}</Empty>
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

export default function CarPage({ page }: { page: 'overview' | 'documents' }) {
  const { id } = useParams();
  const { s } = useStore();
  const car = s.cars.find((c) => c.id === id);
  if (!car) return <Navigate to="/" replace />;
  return (
    <div className="page">
      <SubjectNav sub={{ type: 'car', entity: car }} page={page} />
      <PageHead eyebrow={page === 'overview' ? car.plate : `${car.makeModel} · ${car.plate}`} title={page === 'overview' ? car.makeModel : 'Documents'} />
      {page === 'overview' ? <Overview car={car} /> : <Documents car={car} />}
    </div>
  );
}

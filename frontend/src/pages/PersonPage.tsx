import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Document, Person, Task } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Chips, Empty, PageHead, Segmented, SectionHead, StatusText } from '../components/ui';
import { Icon } from '../components/Icon';
import {
  ArchiveSection,
  DocActions,
  DocRow,
  PinnedTiles,
  RoutineGrid,
  SubjectNav,
  SubjectTasks,
  UpcomingAppointments,
  docSearch,
  useDocActions,
} from '../components/SubjectParts';
import { IndicatorRow } from './Home';
import { PersonDialog } from '../dialogs/SubjectDialogs';
import { DocFormFor, IdFlipCard } from '../dialogs/DocDialogs';
import { RoutineDetailDialog } from '../dialogs/RoutineDetail';
import { fmtDate, plural } from '../lib/dates';
import {
  assignmentStatus,
  assignmentsFor,
  contactName,
  docValidity,
  docsFor,
  indicators,
  maskId,
  routineOf,
  subjectPath,
  tasksForSubject,
  appointmentNote,
} from '../lib/model';

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function Overview({ person }: { person: Person }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const navigate = useNavigate();
  const areaTasks = (area: string) =>
    tasksForSubject(s, 'person', person.id).filter((t) => routineOf(s, s.assignments.find((a) => a.id === t.assignmentId))?.area === area);
  const areas = [
    { key: 'health', title: 'Health', icon: 'stethoscope', kind: 'health' as const },
    { key: 'identity', title: 'Identity', icon: 'idcard', kind: 'identity' as const },
  ];
  return (
    <>
      <div className="subject-block">
        <Icon name="person" size={22} />
        <div>
          <div className="subject-name">{person.name}</div>
        </div>
        <button type="button" className="btn ghost small" onClick={() => openDialog(<PersonDialog person={person} />)}>
          Edit
        </button>
      </div>
      <UpcomingAppointments type="person" id={person.id} />
      <SubjectTasks type="person" id={person.id} />
      <section className="section">
        <SectionHead title="Areas" />
        <div className="tile-grid">
          {areas.map((ar) => {
            const routines = assignmentsFor(s, 'person', person.id, ar.key).length;
            const docs = docsFor(s, 'person', person.id, ar.kind).filter((d) => !d.archived).length;
            return (
              <button key={ar.key} type="button" className="tile status-tile" onClick={() => navigate(subjectPath('person', person.id, ar.key))}>
                <span className="tile-top">
                  <Icon name={ar.icon} className="tile-icon" />
                  <span className="tile-text">
                    <span className="tile-title">{ar.title}</span>
                    <span className="tile-sub">
                      {plural(routines, 'routine')} · {plural(docs, 'document')}
                    </span>
                  </span>
                  <Icon name="chevron" size={18} className="tile-chevron" />
                </span>
                <span className="tile-bottom">
                  <IndicatorRow ind={indicators(areaTasks(ar.key))} />
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

type HistEntry = { date: string; doc?: Document; visit?: Task };

function Health({ person }: { person: Person }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const act = useDocActions();
  const [view, setView] = useState<'timeline' | 'list'>('timeline');
  const [episode, setEpisode] = useState('all');
  const [q, setQ] = useState('');
  const docs = docsFor(s, 'person', person.id, 'health');
  const live = docs.filter((d) => !d.archived);
  const episodes = [...new Set(live.map((d) => d.episode).filter(Boolean))];
  const visits = tasksForSubject(s, 'person', person.id).filter(
    (t) => t.appointment && t.done && routineOf(s, s.assignments.find((a) => a.id === t.assignmentId))?.area === 'health',
  );

  const entries: HistEntry[] = useMemo(() => {
    const list: HistEntry[] = live
      .filter((d) => (episode === 'all' || d.episode === episode) && docSearch(q, d, s))
      .map((d) => ({ date: d.date ?? d.createdAt.slice(0, 10), doc: d }));
    if (episode === 'all') {
      for (const v of visits) {
        const hay = `${v.title} ${v.notes} ${appointmentNote(s, v)}`.toLowerCase();
        if (q.trim() && !q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) continue;
        list.push({ date: v.date ?? v.doneAt?.slice(0, 10) ?? '', visit: v });
      }
    }
    return list.sort((a, b) => b.date.localeCompare(a.date));
  }, [live, visits, episode, q, s]);

  const months: { label: string; items: HistEntry[] }[] = [];
  for (const e of entries) {
    const [y, m] = e.date.split('-').map(Number);
    const label = `${MONTHS_LONG[m - 1]} ${y}`;
    const last = months[months.length - 1];
    if (last && last.label === label) last.items.push(e);
    else months.push({ label, items: [e] });
  }

  return (
    <>
      <RoutineGrid sub={{ type: 'person', entity: person }} area="health" title="Health routines" />
      <PinnedTiles title="Keep handy" docs={live.filter((d) => d.pinned)} />
      <section className="section">
        <SectionHead
          title="Treatment history"
          count={live.length}
          action={
            <button type="button" className="link" onClick={() => openDialog(<DocFormFor kind="health" subjectType="person" subjectId={person.id} />)}>
              Add document
            </button>
          }
        />
        <div className="toolbar">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'timeline', label: 'Timeline' },
              { value: 'list', label: 'List' },
            ]}
          />
          <label className="search">
            <Icon name="search" size={18} />
            <input type="search" aria-label="Search treatment history" placeholder="Search names, types, providers, episodes" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {view === 'timeline' && episodes.length > 0 && (
          <Chips label="Episode" value={episode} onChange={setEpisode} options={[{ value: 'all', label: 'All' }, ...episodes.map((e) => ({ value: e, label: e }))]} />
        )}
        {view === 'timeline' ? (
          entries.length === 0 ? (
            <Empty>{q || episode !== 'all' ? 'Nothing matches.' : 'No treatment history yet. Add results, referrals and visit summaries as they come.'}</Empty>
          ) : (
            <div className="timeline">
              {months.map((m) => (
                <div key={m.label} className="tl-month">
                  <div className="tl-month-label">{m.label}</div>
                  {m.items.map((e) =>
                    e.doc ? (
                      <div key={e.doc.id} className="tl-entry">
                        <span className="tl-dot" aria-hidden="true" />
                        <div className="tl-body">
                          <div className="muted small">{fmtDate(e.date)}</div>
                          <div className="row-title">{e.doc.name}</div>
                          <div className="row-meta">{[e.doc.type, contactName(s, e.doc.providerId)].filter(Boolean).join(' · ')}</div>
                          {e.doc.about && <div className="small">{e.doc.about}</div>}
                          <div className="tl-foot">
                            {e.doc.episode && (
                              <button type="button" className="chip small-chip" onClick={() => setEpisode(e.doc!.episode)}>
                                {e.doc.episode}
                              </button>
                            )}
                            <button type="button" className="btn ghost small" onClick={() => act.show(e.doc!)}>
                              Show
                            </button>
                            <button type="button" className="btn ghost small" onClick={() => act.download(e.doc!)}>
                              Download
                            </button>
                            <button type="button" className="btn ghost small" onClick={() => act.archive(e.doc!)}>
                              Archive
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div key={e.visit!.id} className="tl-entry">
                        <span className="tl-dot visit" aria-hidden="true" />
                        <div className="tl-body">
                          <div className="muted small">{fmtDate(e.date)}</div>
                          <div className="row-title">Visit · {e.visit!.title}</div>
                          <div className="row-meta">{[appointmentNote(s, e.visit!), e.visit!.notes].filter(Boolean).join(' · ')}</div>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          (() => {
            const list = live.filter((d) => docSearch(q, d, s)).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
            return list.length === 0 ? (
              <Empty>{q ? 'Nothing matches.' : 'No health documents yet.'}</Empty>
            ) : (
              <ul className="list">
                {list.map((d) => (
                  <DocRow key={d.id} d={d} />
                ))}
              </ul>
            );
          })()
        )}
      </section>
      <ArchiveSection docs={docs.filter((d) => d.archived)} />
    </>
  );
}

function IdCard({ d }: { d: Document }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const act = useDocActions();
  const v = docValidity(d);
  const a = s.assignments.find((x) => x.id === d.assignmentId);
  const st = a ? assignmentStatus(s, a) : null;
  const numbers = [
    d.idNumber ? `No. ${maskId(d.idNumber)}` : '',
    d.issueDate ? `Issued ${fmtDate(d.issueDate)}` : '',
    d.validUntil ? `Expires ${fmtDate(d.validUntil)}` : '',
  ].filter(Boolean);
  return (
    <div className="id-card">
      <IdFlipCard doc={d} />
      <div className="id-head">
        <span className="tile-title">{d.name}</span>
        {v && <StatusText tone={v.tone} text={v.text} />}
      </div>
      <div className="muted small">{[d.type, d.issuer].filter(Boolean).join(' · ')}</div>
      {numbers.length > 0 && <div className="small">{numbers.join(' · ')}</div>}
      {a && st ? (
        <button type="button" className="link small" onClick={() => openDialog(<RoutineDetailDialog assignmentId={a.id} />)}>
          Renewal: {st.text}
        </button>
      ) : (
        <span className="muted small">No renewal reminder</span>
      )}
      <div className="id-actions">
        <button type="button" className="btn primary small" onClick={() => act.show(d)}>
          Show
        </button>
        <button type="button" className="btn ghost small" onClick={() => act.edit(d)}>
          Edit
        </button>
        <button type="button" className="btn ghost small" onClick={() => act.download(d)}>
          Download
        </button>
        <button type="button" className="btn ghost small" aria-label={`Archive ${d.name}`} onClick={() => act.archive(d)}>
          Archive
        </button>
      </div>
    </div>
  );
}

function Identity({ person }: { person: Person }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const docs = docsFor(s, 'person', person.id, 'identity');
  const live = docs.filter((d) => !d.archived).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return (
    <>
      <section className="section">
        <SectionHead
          title="IDs and documents"
          count={live.length}
          action={
            <button type="button" className="link" onClick={() => openDialog(<DocFormFor kind="identity" subjectType="person" subjectId={person.id} />)}>
              Add ID or document
            </button>
          }
        />
        {live.length === 0 ? (
          <Empty>No IDs yet. Add a passport or license and coo reminds you before it expires.</Empty>
        ) : (
          <div className="id-grid">
            {live.map((d) => (
              <IdCard key={d.id} d={d} />
            ))}
          </div>
        )}
      </section>
      <RoutineGrid sub={{ type: 'person', entity: person }} area="identity" title="Renewals" />
      <ArchiveSection docs={docs.filter((d) => d.archived)} />
    </>
  );
}

export default function PersonPage({ page }: { page: 'overview' | 'health' | 'identity' }) {
  const { id } = useParams();
  const { s } = useStore();
  const person = s.people.find((p) => p.id === id);
  if (!person) return <Navigate to="/" replace />;
  const sub = { type: 'person' as const, entity: person };
  const title = { overview: person.name, health: 'Health', identity: 'Identity' }[page];
  const eyebrow = page === 'overview' ? 'Person' : person.name;
  return (
    <div className="page">
      <SubjectNav sub={sub} page={page} />
      <PageHead eyebrow={eyebrow} title={title} />
      {page === 'overview' && <Overview person={person} />}
      {page === 'health' && <Health person={person} />}
      {page === 'identity' && <Identity person={person} />}
    </div>
  );
}

export { DocActions };

import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Reservation } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Empty, IconButton, PageHead, Segmented, SectionHead, StatusText } from '../components/ui';
import { Icon } from '../components/Icon';
import { ReservationDetailDialog, ReservationFormDialog, TicketViewer, TripDialog } from '../dialogs/TripDialogs';
import { fmtDateTime, fmtDayHeading, plural, timePart, today } from '../lib/dates';
import { attachmentsOf, findSubject, nights, passportStatus, subjectPath, tripDates, tripInfo, tripReservations } from '../lib/model';
import { DocList } from '../components/SubjectParts';
import { DocFormFor } from '../dialogs/DocDialogs';
import { RES_ORDER, RES_TYPES, buildTimeline, resField, siteName } from '../lib/reservations';

function ResActions({ r }: { r: Reservation }) {
  const ui = useUI();
  const { s } = useStore();
  const link = resField(r, 'link');
  const hasTickets = attachmentsOf(s, 'reservation', r.id).length > 0 || !!resField(r, 'confirmation');
  return (
    <span className="row-actions">
      {hasTickets && (
        <IconButton icon="ticket" label={`Show tickets for ${r.title}`} onClick={() => ui.openViewer(<TicketViewer reservationId={r.id} />)} />
      )}
      {link && <IconButton icon="link" label={`Open link for ${r.title} (${siteName(link)})`} href={link} />}
    </span>
  );
}

function EventRow({ r, time, label }: { r: Reservation; time: string; label: string | null }) {
  const ui = useUI();
  const meta = RES_TYPES[r.type];
  const confirmation = resField(r, 'confirmation');
  const metaLine = [label, label === meta.endWord ? '' : resField(r, 'address'), confirmation ? `Ref ${confirmation}` : ''].filter(Boolean).join(' · ');
  return (
    <li className="row event-row">
      <span className="event-time">{time}</span>
      <button type="button" className="row-main row-body with-icon" onClick={() => ui.openDialog(<ReservationDetailDialog reservationId={r.id} />)}>
        <Icon name={meta.icon} />
        <span className="row-main">
          <span className="row-title">{r.title}</span>
          {metaLine && <span className="row-meta">{metaLine}</span>}
        </span>
      </button>
      {r.status === 'planned' && <StatusText tone="warn" text="Not booked" />}
      <ResActions r={r} />
    </li>
  );
}

export default function TripPage() {
  const { id } = useParams();
  const { s } = useStore();
  const ui = useUI();
  const navigate = useNavigate();
  const [view, setView] = useState<'timeline' | 'type'>('timeline');
  const trip = findSubject(s, id);
  if (!trip || trip.subjectType !== 'trip') return <Navigate to="/trips" replace />;
  const info = tripInfo(trip);
  // The trip's own files (not tickets attached to a reservation).
  const files = s.documents.filter((d) => d.subjectId === trip.id && !d.attachedTo && !d.archived);
  const res = tripReservations(s, trip);
  const notBooked = res.filter((r) => r.status === 'planned').length;
  const n = nights(trip);
  const days = buildTimeline(trip, res);
  const t0 = today();

  return (
    <div className="page">
      <PageHead
        eyebrow={[tripDates(trip), plural(n, 'night'), info.destination].filter(Boolean).join(' · ')}
        title={trip.name}
        actions={
          <>
            <button type="button" className="btn ghost" onClick={() => ui.openDialog(<TripDialog trip={trip} />)}>
              Edit trip
            </button>
            <button type="button" className="btn primary" onClick={() => ui.openDialog(<ReservationFormDialog tripId={trip.id} />)}>
              <Icon name="plus" /> Add reservation
            </button>
          </>
        }
      />
      <p className="summary-line">
        {plural(res.length, 'reservation')} · {notBooked > 0 ? `${notBooked} not booked yet` : res.length ? 'all booked' : 'nothing booked yet'}
        {trip.notes && <span className="muted"> · {trip.notes}</span>}
      </p>

      <section className="section">
        <SectionHead title="Travelers and passports" count={info.travelers.length} />
        {info.travelers.length === 0 ? (
          <Empty>No travelers yet. Edit the trip to say who is going.</Empty>
        ) : (
          <div className="chip-row">
            {info.travelers.map((pid) => {
              const p = findSubject(s, pid);
              if (!p) return null;
              const st = passportStatus(s, pid, trip);
              return (
                <button key={pid} type="button" className="chip traveler" onClick={() => navigate(subjectPath(p, 'identity'))}>
                  <strong>{p.name}</strong>
                  <StatusText tone={st.tone} text={st.text} />
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="section">
        <SectionHead
          title="Files"
          count={files.length}
          action={
            <button type="button" className="link" onClick={() => ui.openDialog(<DocFormFor category="attachment" subjectId={trip.id} />)}>
              Add a file
            </button>
          }
        />
        {files.length === 0 ? <Empty>Itineraries, visas and anything else for the whole trip.</Empty> : <DocList docs={files} />}
      </section>

      <div className="toolbar">
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'timeline', label: 'Timeline' },
            { value: 'type', label: 'By type' },
          ]}
        />
      </div>

      {res.length === 0 && (
        <Empty>Nothing here yet. Add a flight, hotel, car or activity and the timeline builds itself.</Empty>
      )}

      {view === 'timeline'
        ? days.map((d) => (
            <section key={d.date} className="section day-section">
              <SectionHead
                title={
                  <>
                    {fmtDayHeading(d.date)}
                    {d.date === t0 && <span className="accent"> · Today</span>}
                  </>
                }
                action={
                  <button
                    type="button"
                    className="link"
                    onClick={() => ui.openDialog(<ReservationFormDialog tripId={trip.id} initialStart={`${d.date}T09:00`} />)}
                  >
                    + Add{d.dayNumber >= 1 ? ` · Day ${d.dayNumber}` : ''}
                  </button>
                }
              />
              {d.entries.length === 0 ? (
                <div className="empty-row">Nothing planned yet</div>
              ) : (
                <ul className="list">
                  {d.entries.map((e, i) =>
                    e.kind === 'quiet' ? (
                      <li key={`q${i}`} className="row quiet-row">
                        <span className="event-time" />
                        <Icon name={RES_TYPES[e.res.type].icon} size={18} />
                        <span className="muted">{e.text}</span>
                      </li>
                    ) : (
                      <EventRow key={`${e.res.id}-${e.edge}`} r={e.res} time={e.time} label={e.label} />
                    ),
                  )}
                </ul>
              )}
            </section>
          ))
        : RES_ORDER.map((type) => {
            const list = res.filter((r) => r.type === type);
            if (list.length === 0) return null;
            return (
              <section key={type} className="section">
                <SectionHead title={RES_TYPES[type].plural} count={list.length} />
                <ul className="list">
                  {list.map((r) => (
                    <li key={r.id} className="row event-row">
                      <button type="button" className="row-main row-body with-icon" onClick={() => ui.openDialog(<ReservationDetailDialog reservationId={r.id} />)}>
                        <Icon name={RES_TYPES[type].icon} />
                        <span className="row-main">
                          <span className="row-title">{r.title}</span>
                          <span className="row-meta">
                            {fmtDateTime(r.start)}
                            {r.end ? ` – ${r.end.slice(0, 10) === r.start.slice(0, 10) ? timePart(r.end) : fmtDateTime(r.end)}` : ''}
                            {resField(r, 'confirmation') ? ` · Ref ${resField(r, 'confirmation')}` : ''}
                          </span>
                        </span>
                      </button>
                      <StatusText tone={r.status === 'booked' ? 'ok' : 'warn'} text={r.status === 'booked' ? 'Booked' : 'Not booked'} />
                      <ResActions r={r} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
    </div>
  );
}

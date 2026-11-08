import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import type { Reservation } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Empty, IconButton, PageHead, Segmented, SectionHead, StatusText } from '../components/ui';
import { Icon } from '../components/Icon';
import { ReservationDetailDialog, ReservationFormDialog, TicketViewer, TripDialog } from '../dialogs/TripDialogs';
import { fmtDateTime, fmtDayHeading, plural, timePart, today } from '../lib/dates';
import { nights, passportStatus, subjectPath, tripDates, tripReservations } from '../lib/model';
import { RES_ORDER, RES_TYPES, buildTimeline, siteName } from '../lib/reservations';

function ResActions({ r }: { r: Reservation }) {
  const ui = useUI();
  return (
    <span className="row-actions">
      {(r.files.length > 0 || r.confirmation) && (
        <IconButton icon="ticket" label={`Show tickets for ${r.title}`} onClick={() => ui.openViewer(<TicketViewer reservationId={r.id} />)} />
      )}
      {r.link && <IconButton icon="link" label={`Open link for ${r.title} (${siteName(r.link)})`} href={r.link} />}
    </span>
  );
}

function EventRow({ r, time, label }: { r: Reservation; time: string; label: string | null }) {
  const ui = useUI();
  const meta = RES_TYPES[r.type];
  const metaLine = [label, label === meta.endWord ? '' : r.address, r.confirmation ? `Ref ${r.confirmation}` : ''].filter(Boolean).join(' · ');
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
  const trip = s.trips.find((t) => t.id === id);
  if (!trip) return <Navigate to="/trips" replace />;
  const res = tripReservations(s, trip);
  const notBooked = res.filter((r) => r.status === 'planned').length;
  const n = nights(trip);
  const days = buildTimeline(trip, res);
  const t0 = today();

  return (
    <div className="page">
      <Link to="/trips" className="back-link">
        ← All trips
      </Link>
      <PageHead
        eyebrow={[tripDates(trip), plural(n, 'night'), trip.destination].filter(Boolean).join(' · ')}
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
        <SectionHead title="Travelers and passports" count={trip.travelers.length} />
        {trip.travelers.length === 0 ? (
          <Empty>No travelers yet. Edit the trip to say who is going.</Empty>
        ) : (
          <div className="chip-row">
            {trip.travelers.map((pid) => {
              const p = s.people.find((x) => x.id === pid);
              if (!p) return null;
              const st = passportStatus(s, pid, trip);
              return (
                <button key={pid} type="button" className="chip traveler" onClick={() => navigate(subjectPath('person', pid, 'identity'))}>
                  <strong>{p.name}</strong>
                  <StatusText tone={st.tone} text={st.text} />
                </button>
              );
            })}
          </div>
        )}
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
                            {r.confirmation ? ` · Ref ${r.confirmation}` : ''}
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

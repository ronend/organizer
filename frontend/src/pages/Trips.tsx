import { useNavigate } from 'react-router-dom';
import type { Subject } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Empty, PageHead, SectionHead, StatusText } from '../components/ui';
import { Icon } from '../components/Icon';
import { TripDialog } from '../dialogs/TripDialogs';
import { findSubject, isUpcomingTrip, tripDates, tripInfo, tripReservations, tripWhen, trips } from '../lib/model';
import { plural } from '../lib/dates';

function TripRow({ trip }: { trip: Subject }) {
  const { s } = useStore();
  const navigate = useNavigate();
  const res = tripReservations(s, trip);
  const notBooked = res.filter((r) => r.status === 'planned').length;
  const info = tripInfo(trip);
  const names = info.travelers.map((id) => findSubject(s, id)?.name).filter(Boolean);
  const when = tripWhen(trip);
  return (
    <li>
      <button type="button" className="row row-button" onClick={() => navigate(`/trips/${trip.id}`)}>
        <Icon name="suitcase" />
        <span className="row-main">
          <span className="row-title strong">{trip.name}</span>
          <span className="row-meta">
            {tripDates(trip)}
            {info.destination ? ` · ${info.destination}` : ''}
          </span>
          <span className="row-meta">
            {[names.join(', '), plural(res.length, 'reservation')].filter(Boolean).join(' · ')}
            {notBooked > 0 && (
              <>
                {' '}
                <StatusText tone="warn" text={`${notBooked} not booked`} />
              </>
            )}
          </span>
        </span>
        <span className="row-right">{when.text}</span>
      </button>
    </li>
  );
}

export default function Trips() {
  const { s } = useStore();
  const { openDialog } = useUI();
  const start = (t: Subject) => tripInfo(t).start;
  const upcoming = trips(s).filter(isUpcomingTrip).sort((a, b) => start(a).localeCompare(start(b)));
  const past = trips(s).filter((t) => !isUpcomingTrip(t)).sort((a, b) => start(b).localeCompare(start(a)));
  return (
    <div className="page">
      <PageHead
        eyebrow="Flights, stays, cars and plans in one timeline"
        title="Trips"
        actions={
          <button type="button" className="btn primary" onClick={() => openDialog(<TripDialog />)}>
            <Icon name="plus" /> New trip
          </button>
        }
      />
      <section className="section">
        <SectionHead title="Upcoming" count={upcoming.length} />
        {upcoming.length === 0 ? (
          <Empty>No trips planned. Start one and add flights, stays and plans as they come.</Empty>
        ) : (
          <ul className="list">
            {upcoming.map((t) => (
              <TripRow key={t.id} trip={t} />
            ))}
          </ul>
        )}
      </section>
      {past.length > 0 && (
        <section className="section">
          <SectionHead title="Past" count={past.length} />
          <ul className="list">
            {past.map((t) => (
              <TripRow key={t.id} trip={t} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

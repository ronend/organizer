import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { useAuth } from '../auth/useAuth';
import { MOCK } from '../api/client';
import { CountCircle, PageHead, SectionHead } from '../components/ui';
import { Icon } from '../components/Icon';
import { AddTaskDialog } from '../dialogs/TaskDialogs';
import { SubjectDialog } from '../dialogs/SubjectDialogs';
import { SIDEBAR_TYPES } from '../components/Shell';
import { SUBJECT_TYPES } from '../lib/registry';
import { TripDialog } from '../dialogs/TripDialogs';
import { fmtLongToday, greeting, plural, daysFromToday } from '../lib/dates';
import {
  allSubjects,
  indicators,
  isGeneral,
  isUpcomingTrip,
  subjectPath,
  subjectSub,
  tripDates,
  tripReservations,
  tripWhen,
  urgencyCompare,
  agendaTasks,
  subjectIcon,
  trips as tripsOf,
  tripInfo,
  type Indicators,
} from '../lib/model';
import { loadDemoData } from '../lib/seed';
import { useToast } from '../store/Toast';

export function IndicatorRow({ ind }: { ind: Indicators }) {
  const items = [];
  if (ind.overdue) items.push(<CountCircle key="o" tone="bad" count={ind.overdue} icon="alert" label={plural(ind.overdue, 'overdue item')} />);
  if (ind.reminders) items.push(<CountCircle key="r" tone="warn" count={ind.reminders} icon="bell" label={plural(ind.reminders, 'reminder')} />);
  if (ind.appointments)
    items.push(<CountCircle key="a" tone="info" count={ind.appointments} icon="calendar" label={plural(ind.appointments, 'appointment') + ' in the next 30 days'} />);
  if (items.length === 0) items.push(<CountCircle key="ok" tone="ok" count="check" icon="check" label="All clear" />);
  return <div className="indicators">{items}</div>;
}

export function StatusTile({
  icon,
  title,
  sub,
  onClick,
  children,
}: {
  icon: string;
  title: string;
  sub: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="tile status-tile" onClick={onClick}>
      <span className="tile-top">
        <Icon name={icon} size={20} className="tile-icon" />
        <span className="tile-text">
          <span className="tile-title">{title}</span>
          <span className="tile-sub">{sub}</span>
        </span>
        <Icon name="chevron" size={18} className="tile-chevron" />
      </span>
      <span className="tile-bottom">{children}</span>
    </button>
  );
}

export default function Home() {
  const { s, apply } = useStore();
  const { openDialog } = useUI();
  const { logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const subjects = allSubjects(s)
    .map((x) => ({ x, ind: indicators(s.tasks.filter((t) => t.subjectId === x.id)) }))
    .sort((a, b) => urgencyCompare(a.ind, b.ind));
  const general = indicators(s.tasks.filter(isGeneral));
  const trips = tripsOf(s).filter(isUpcomingTrip).sort((a, b) => tripInfo(a).start.localeCompare(tripInfo(b).start));
  const empty = s.subjects.length === 0 && s.tasks.length === 0;

  return (
    <div className="page">
      <PageHead
        eyebrow={fmtLongToday()}
        title={greeting()}
        actions={
          <button type="button" className="btn primary" onClick={() => openDialog(<AddTaskDialog />)}>
            <Icon name="plus" /> Add task
          </button>
        }
      />

      {empty && (
        <div className="empty welcome">
          <p>
            <strong>Welcome to coo.</strong> Add the people and cars you look after, then give them routines: renewals, checkups,
            inspections. coo turns the dates into an agenda.
          </p>
          <p>
            Want to look around first?{' '}
            <button
              type="button"
              className="link"
              onClick={async () => {
                try {
                  await loadDemoData(s, apply);
                  toast.show({ text: 'Demo household loaded' });
                } catch (e) {
                  toast.show({ text: `Couldn’t load the demo: ${e instanceof Error ? e.message : 'error'}` });
                }
              }}
            >
              Load a demo household
            </button>
            .
          </p>
        </div>
      )}

      <section className="section">
        <SectionHead title="Everyone and everything" count={subjects.length} />
        <div className="tile-grid">
          {subjects.map(({ x, ind }) => (
            <StatusTile
              key={x.id}
              icon={subjectIcon(x)}
              title={x.name}
              sub={subjectSub(x)}
              onClick={() => navigate(subjectPath(x))}
            >
              <IndicatorRow ind={ind} />
            </StatusTile>
          ))}
          <StatusTile icon="calendar" title="General" sub="Tasks not tied to anyone" onClick={() => navigate('/agenda?for=general')}>
            <IndicatorRow ind={general} />
          </StatusTile>
        </div>
      </section>

      {trips.length > 0 && (
        <section className="section">
          <SectionHead title="Trips" count={trips.length} />
          <div className="tile-grid">
            {trips.map((t) => {
              const when = tripWhen(t);
              const notBooked = tripReservations(s, t).filter((r) => r.status === 'planned').length;
              const reminders = agendaTasks(s.tasks).filter((x) => x.subjectId === t.id && !x.done && x.date && daysFromToday(x.date) <= 14).length;
              return (
                <StatusTile key={t.id} icon="suitcase" title={t.name} sub={tripDates(t, true)} onClick={() => navigate(`/trips/${t.id}`)}>
                  <div className="indicators">
                    {when.days === 0 ? (
                      <CountCircle tone="ok" count="check" icon="plane" label="Happening now" />
                    ) : (
                      <CountCircle tone="info" count={when.days ?? 0} icon="plane" label={`${plural(when.days ?? 0, 'day')} to go`} />
                    )}
                    {notBooked > 0 && <CountCircle tone="warn" count={notBooked} icon="alert" label={`${plural(notBooked, 'reservation')} not booked yet`} />}
                    {reminders > 0 && <CountCircle tone="warn" count={reminders} icon="bell" label={plural(reminders, 'trip reminder')} />}
                  </div>
                </StatusTile>
              );
            })}
          </div>
        </section>
      )}

      <section className="section">
        <div className="tile-grid add-grid">
          {SIDEBAR_TYPES.map((t) => (
            <button key={t} type="button" className="tile dashed" onClick={() => openDialog(<SubjectDialog subjectType={t} />)}>
              <Icon name="plus" /> Add {SUBJECT_TYPES[t].label.toLowerCase()}
            </button>
          ))}
          <button type="button" className="tile dashed" onClick={() => openDialog(<TripDialog />)}>
            <Icon name="plus" /> Plan a trip
          </button>
        </div>
      </section>

      {!MOCK && (
        <div className="mobile-only home-foot">
          <button type="button" className="btn ghost small" onClick={logout}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

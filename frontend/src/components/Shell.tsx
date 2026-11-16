import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { useAuth } from '../auth/useAuth';
import { MOCK } from '../api/client';
import { agendaBadge, allSubjects, findSubject, personSub, sortedCars, sortedPeople, subjectPath, subjectSub, type Subject } from '../lib/model';
import { Icon } from './Icon';
import { Breadcrumbs } from './Breadcrumbs';
import { CarDialog, PersonDialog, SubjectChooser } from '../dialogs/SubjectDialogs';

/** Parses /people/:id[/page] and /cars/:id[/page]. */
export function useCurrentSubject(): { sub: Subject | null; page: string } {
  const { s } = useStore();
  const { pathname } = useLocation();
  const m = pathname.match(/^\/(people|cars)\/([^/]+)(?:\/([^/]+))?/);
  if (!m) return { sub: null, page: '' };
  const sub = findSubject(s, m[1] === 'people' ? 'person' : 'car', m[2]);
  return { sub, page: m[3] ?? 'overview' };
}

export const PERSON_PAGES = [
  { value: 'overview', label: 'Overview' },
  { value: 'health', label: 'Health' },
  { value: 'identity', label: 'Identity' },
];
export const CAR_PAGES = [
  { value: 'overview', label: 'Overview' },
  { value: 'documents', label: 'Documents' },
];

function Sidebar() {
  const { s } = useStore();
  const { openDialog } = useUI();
  const { logout } = useAuth();
  const { pathname } = useLocation();
  const badge = agendaBadge(s);
  const { sub, page } = useCurrentSubject();

  const nav = (to: string, icon: string, label: string, extra?: ReactNode, activeAlso?: boolean) => (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `side-link ${isActive || activeAlso ? 'active' : ''}`}
    >
      <Icon name={icon} />
      <span className="side-label">{label}</span>
      {extra}
    </NavLink>
  );

  return (
    <nav className="sidebar" aria-label="Main">
      <Link to="/" className="brand">
        <span className="brand-mark" aria-hidden="true">c</span>
        <span>coo</span>
      </Link>
      <div className="side-group">
        {nav('/', 'home', 'Home')}
        {nav(
          '/agenda',
          'calendar',
          'Agenda',
          badge > 0 ? (
            <span className="badge" aria-label={`${badge} due or overdue`}>
              {badge}
            </span>
          ) : undefined,
        )}
        {nav('/trips', 'suitcase', 'Trips', undefined, pathname.startsWith('/trips/'))}
        {nav('/routines', 'repeat', 'Routines')}
        {nav('/documents', 'document', 'Documents')}
      </div>

      <div className="side-group">
        <div className="side-heading">People</div>
        {sortedPeople(s).map((p) => {
          const current = sub?.type === 'person' && sub.entity.id === p.id;
          return (
            <Link key={p.id} to={subjectPath('person', p.id)} className={`side-link subject ${current ? 'selected' : ''}`}>
              <Icon name="person" />
              <span className="side-label">
                {p.name}
                {personSub(p) && <span className="side-sub">{personSub(p)}</span>}
              </span>
            </Link>
          );
        })}
        <button type="button" className="side-link add" onClick={() => openDialog(<PersonDialog />)}>
          <Icon name="plus" />
          <span className="side-label">Add person</span>
        </button>
      </div>

      <div className="side-group">
        <div className="side-heading">Cars</div>
        {sortedCars(s).map((c) => {
          const current = sub?.type === 'car' && sub.entity.id === c.id;
          return (
            <Link key={c.id} to={subjectPath('car', c.id)} className={`side-link subject ${current ? 'selected' : ''}`}>
              <Icon name="car" />
              <span className="side-label">
                {c.makeModel}
                <span className="side-sub">{c.plate}</span>
              </span>
            </Link>
          );
        })}
        <button type="button" className="side-link add" onClick={() => openDialog(<CarDialog />)}>
          <Icon name="plus" />
          <span className="side-label">Add car</span>
        </button>
      </div>

      {sub && (
        <div className="side-group">
          <div className="side-heading">{sub.type === 'person' ? sub.entity.name : sub.entity.makeModel}</div>
          {(sub.type === 'person' ? PERSON_PAGES : CAR_PAGES).map((pg) => {
            const icon = { overview: sub.type === 'person' ? 'person' : 'car', health: 'stethoscope', identity: 'idcard', documents: 'document' }[pg.value]!;
            return (
              <Link
                key={pg.value}
                to={subjectPath(sub.type, sub.entity.id, pg.value)}
                className={`side-link ${page === pg.value ? 'active' : ''}`}
                aria-current={page === pg.value ? 'page' : undefined}
              >
                <Icon name={icon} />
                <span className="side-label">{pg.label}</span>
              </Link>
            );
          })}
        </div>
      )}

      <div className="side-group">
        <div className="side-heading">Shared</div>
        {nav('/contacts', 'contacts', 'Contacts')}
      </div>

      {!MOCK && (
        <div className="side-group side-foot">
          <button type="button" className="side-link" onClick={logout}>
            <Icon name="logout" />
            <span className="side-label">Sign out</span>
          </button>
        </div>
      )}
    </nav>
  );
}

function TabBar() {
  const { s } = useStore();
  const badge = agendaBadge(s);
  const { pathname } = useLocation();
  const tab = (to: string, icon: string, label: string, extra?: ReactNode, activeAlso?: boolean) => (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `tab ${isActive || activeAlso ? 'active' : ''}`}>
      <span className="tab-icon">
        <Icon name={icon} size={22} />
        {extra}
      </span>
      <span>{label}</span>
    </NavLink>
  );
  return (
    <nav className="tabbar" aria-label="Main">
      {tab('/', 'home', 'Home')}
      {tab(
        '/agenda',
        'calendar',
        'Agenda',
        badge > 0 ? (
          <span className="badge" aria-label={`${badge} due or overdue`}>
            {badge}
          </span>
        ) : undefined,
      )}
      {tab('/trips', 'suitcase', 'Trips', undefined, pathname.startsWith('/trips/'))}
      {tab('/routines', 'repeat', 'Routines')}
      {tab('/documents', 'document', 'Docs')}
      {tab('/contacts', 'contacts', 'Contacts')}
    </nav>
  );
}

/** Mobile: chips for every person and car + a "+" chip, at the top of subject pages. */
export function SubjectSwitcher() {
  const { s } = useStore();
  const { openDialog } = useUI();
  const navigate = useNavigate();
  const { sub, page } = useCurrentSubject();
  if (!sub) return null;

  const go = (target: Subject) => {
    let next = 'overview';
    if (page !== 'overview') {
      if (target.type === 'car') next = 'documents';
      else next = sub.type === 'person' ? page : 'health';
    }
    navigate(subjectPath(target.type, target.entity.id, next));
  };

  return (
    <div className="switcher" role="group" aria-label="People and cars">
      {allSubjects(s).map((x) => {
        const sel = x.type === sub.type && x.entity.id === sub.entity.id;
        return (
          <button
            key={x.entity.id}
            type="button"
            className={`chip ${sel ? 'selected' : ''}`}
            aria-pressed={sel}
            onClick={() => go(x)}
          >
            <Icon name={x.type} size={16} />
            {x.type === 'person' ? x.entity.name : x.entity.makeModel}
            {subjectSub(x) && <span className="muted">{subjectSub(x)}</span>}
          </button>
        );
      })}
      <button type="button" className="chip" aria-label="Add a person or car" onClick={() => openDialog(<SubjectChooser />)}>
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <main className="main" id="main">
        <div className="column">
          <Breadcrumbs />
          {children}
        </div>
      </main>
      <TabBar />
    </div>
  );
}

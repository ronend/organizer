import type { ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { useAuth } from '../auth/useAuth';
import { MOCK } from '../api/client';
import type { Subject, SubjectType } from '../types/coo';
import { agendaBadge, allSubjects, findSubject, subjectIcon, subjectPath, subjectSub, subjectsOfType } from '../lib/model';
import { SUBJECT_TYPES, SUBJECT_TYPE_KEYS, allows } from '../lib/registry';
import { Icon } from './Icon';
import { Breadcrumbs } from './Breadcrumbs';
import { SubjectChooser, SubjectDialog } from '../dialogs/SubjectDialogs';

/** Parses /people/:id, /cars/:id and /subjects/:id (+ /page). Trips have their own pages. */
export function useCurrentSubject(): { sub: Subject | null; page: string } {
  const { s } = useStore();
  const { pathname } = useLocation();
  const m = pathname.match(/^\/(people|cars|subjects)\/([^/]+)(?:\/([^/]+))?/);
  if (!m) return { sub: null, page: '' };
  return { sub: findSubject(s, m[2]), page: m[3] ?? 'overview' };
}

export interface SubjectPage {
  value: string;
  label: string;
  icon: string;
}

/** The pages a subject has: person → Overview / Health / Identity; anything that holds documents → Overview / Documents. */
export function pagesFor(t: SubjectType): SubjectPage[] {
  if (t === 'person') {
    return [
      { value: 'overview', label: 'Overview', icon: 'person' },
      { value: 'health', label: 'Health', icon: 'stethoscope' },
      { value: 'identity', label: 'Identity', icon: 'idcard' },
    ];
  }
  const pages: SubjectPage[] = [{ value: 'overview', label: 'Overview', icon: SUBJECT_TYPES[t].icon }];
  if (allows(t, 'document')) pages.push({ value: 'documents', label: 'Documents', icon: 'document' });
  return pages;
}

/** Subject types listed in the sidebar (trips have their own page). */
export const SIDEBAR_TYPES = SUBJECT_TYPE_KEYS.filter((t) => t !== 'trip');

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

      {SIDEBAR_TYPES.map((t) => (
        <div className="side-group" key={t}>
          <div className="side-heading">{SUBJECT_TYPES[t].plural}</div>
          {subjectsOfType(s, t).map((x) => {
            const current = sub?.id === x.id;
            return (
              <Link key={x.id} to={subjectPath(x)} className={`side-link subject ${current ? 'selected' : ''}`}>
                <Icon name={subjectIcon(x)} />
                <span className="side-label">
                  {x.name}
                  {subjectSub(x) && <span className="side-sub">{subjectSub(x)}</span>}
                </span>
              </Link>
            );
          })}
          <button type="button" className="side-link add" onClick={() => openDialog(<SubjectDialog subjectType={t} />)}>
            <Icon name="plus" />
            <span className="side-label">Add {SUBJECT_TYPES[t].label.toLowerCase()}</span>
          </button>
        </div>
      ))}

      {sub && (
        <div className="side-group">
          <div className="side-heading">{sub.name}</div>
          {pagesFor(sub.subjectType).map((pg) => {
            const icon = pg.icon;
            return (
              <Link
                key={pg.value}
                to={subjectPath(sub, pg.value)}
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
    // Keep the same page when the target has it (Health → Health), else its closest.
    const pages = pagesFor(target.subjectType).map((p) => p.value);
    const next = pages.includes(page) ? page : page !== 'overview' && pages.includes('documents') ? 'documents' : 'overview';
    navigate(subjectPath(target, next));
  };

  return (
    <div className="switcher" role="group" aria-label="Subjects">
      {allSubjects(s).map((x) => {
        const sel = x.id === sub.id;
        return (
          <button
            key={x.id}
            type="button"
            className={`chip ${sel ? 'selected' : ''}`}
            aria-pressed={sel}
            onClick={() => go(x)}
          >
            <Icon name={subjectIcon(x)} size={16} />
            {x.name}
            {subjectSub(x) && <span className="muted">{subjectSub(x)}</span>}
          </button>
        );
      })}
      <button type="button" className="chip" aria-label="Add a subject" onClick={() => openDialog(<SubjectChooser />)}>
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

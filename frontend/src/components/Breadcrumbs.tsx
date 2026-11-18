import { Fragment } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../store/Store';
import { findSubject, subjectPath } from '../lib/model';
import { Icon } from './Icon';

interface Crumb {
  label: string;
  to?: string;
}

const TOP: Record<string, string> = {
  agenda: 'Agenda',
  trips: 'Trips',
  routines: 'Routines',
  documents: 'Documents',
  contacts: 'Contacts',
};

/** Home › Section › Item › Page, from the current route. */
export function useCrumbs(): Crumb[] {
  const { s } = useStore();
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }];
  const [first, id] = parts;

  if (first in TOP) {
    crumbs.push({ label: TOP[first], to: `/${first}` });
    if (first === 'trips' && id) {
      crumbs.push({ label: findSubject(s, id)?.name ?? 'Trip', to: `/trips/${id}` });
    }
  } else if (first === 'people' || first === 'cars' || first === 'subjects') {
    const sub = findSubject(s, id);
    if (sub) {
      crumbs.push({ label: sub.name, to: subjectPath(sub) });
    } else {
      crumbs.push({ label: 'Not found' });
    }
  }
  // The last crumb is the current page: not a link.
  delete crumbs[crumbs.length - 1].to;
  return crumbs;
}

export function Breadcrumbs() {
  const crumbs = useCrumbs();
  if (crumbs.length === 0) return null;
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <li className="crumb-sep" aria-hidden="true">
                <Icon name="chevron" size={14} />
              </li>
            )}
            <li>
              {c.to ? (
                <Link to={c.to}>{c.label}</Link>
              ) : (
                <span aria-current="page">{c.label}</span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

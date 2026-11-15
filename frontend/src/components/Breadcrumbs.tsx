import { Fragment } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../store/Store';
import { subjectPath } from '../lib/model';
import { Icon } from './Icon';

interface Crumb {
  label: string;
  to?: string;
}

const TOP: Record<string, string> = {
  agenda: 'Agenda',
  trips: 'Trips',
  routines: 'Routines',
  contacts: 'Contacts',
};
const SUBPAGE: Record<string, string> = { health: 'Health', identity: 'Identity', documents: 'Documents' };

/** Home › Section › Item › Page, from the current route. */
export function useCrumbs(): Crumb[] {
  const { s } = useStore();
  const { pathname } = useLocation();
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const crumbs: Crumb[] = [{ label: 'Home', to: '/' }];
  const [first, id, page] = parts;

  if (first in TOP) {
    crumbs.push({ label: TOP[first], to: `/${first}` });
    if (first === 'trips' && id) {
      crumbs.push({ label: s.trips.find((t) => t.id === id)?.name ?? 'Trip', to: `/trips/${id}` });
    }
  } else if (first === 'people' || first === 'cars') {
    const type = first === 'people' ? 'person' : 'car';
    const name =
      type === 'person' ? s.people.find((p) => p.id === id)?.name : s.cars.find((c) => c.id === id)?.makeModel;
    crumbs.push({ label: name ?? (type === 'person' ? 'Person' : 'Car'), to: subjectPath(type, id) });
    if (page && SUBPAGE[page]) crumbs.push({ label: SUBPAGE[page], to: subjectPath(type, id, page) });
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

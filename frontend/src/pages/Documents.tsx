import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DocCategory, Document } from '../types/coo';
import { useStore } from '../store/Store';
import { Empty, PageHead, SectionHead, Segmented } from '../components/ui';
import { Icon } from '../components/Icon';
import { ArchiveSection, DocList } from '../components/SubjectParts';
import { allSubjects, subjectLabel, trips as tripsOf } from '../lib/model';
import { CATEGORIES, CATEGORY_KEYS } from '../lib/registry';

// One filter per registry category, in registry order.
const KINDS: { value: DocCategory; label: string }[] = CATEGORY_KEYS.map((k) => ({ value: k, label: CATEGORIES[k].short }));

type KindFilter = DocCategory | 'all';

function titleMatches(q: string, d: Document) {
  const name = d.title.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => name.includes(w));
}

/** Every document in the household, filterable by kind, owner and title. */
export default function Documents() {
  const { s } = useStore();
  const [params, setParams] = useSearchParams();
  // The title box keeps its own state so typing never waits on the router.
  const [q, setQ] = useState(() => params.get('q') ?? '');
  const forParam = params.get('for') ?? 'all';
  // A subject id (older links were "<type>:<id>").
  const forId = forParam.includes(':') ? forParam.split(':')[1] : forParam;

  // Build on the latest params: URL updates run as transitions, so the
  // `params` captured by this render can be stale.
  const setParam = (k: string, v: string | null) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (v === null || v === '') n.delete(k);
        else n.set(k, v);
        return n;
      },
      { replace: true },
    );

  // Owner and title narrow the list first; the kind chips count within that.
  const base = useMemo(
    () =>
      s.documents.filter((d) => {
        if (forParam !== 'all' && d.subjectId !== forId) return false;
        return titleMatches(q, d);
      }),
    [s.documents, forParam, q],
  );
  const live = base.filter((d) => !d.archived);
  const count = (k: DocCategory) => live.filter((d) => d.category === k).length;
  // Only offer kinds that exist at all, so the chips adapt to the household.
  const kinds = KINDS.filter((k) => s.documents.some((d) => d.category === k.value));
  const rawKind = params.get('kind') as KindFilter | null;
  const kind: KindFilter = rawKind && kinds.some((k) => k.value === rawKind) ? rawKind : 'all';

  const byKind = (d: Document) => kind === 'all' || d.category === kind;
  const shown = live.filter(byKind).sort((a, b) => a.title.localeCompare(b.title));
  const archived = base.filter((d) => d.archived && byKind(d)).sort((a, b) => a.title.localeCompare(b.title));
  const filtering = !!q.trim() || forParam !== 'all' || kind !== 'all';

  return (
    <div className="page">
      <PageHead eyebrow="IDs, health records and car papers in one place" title="Documents" />
      <div className="toolbar">
        {kinds.length > 1 && (
          <Segmented<KindFilter>
            label="Kind"
            value={kind}
            onChange={(v) => setParam('kind', v === 'all' ? null : v)}
            options={[
              { value: 'all', label: `All (${live.length})` },
              ...kinds.map((k) => ({ value: k.value, label: `${k.label} (${count(k.value)})` })),
            ]}
          />
        )}
        <select aria-label="Whose documents" className="filter-select" value={forParam} onChange={(e) => setParam('for', e.target.value === 'all' ? null : e.target.value)}>
          <option value="all">Everyone</option>
          {[...allSubjects(s), ...tripsOf(s)].map((x) => (
            <option key={x.id} value={x.id}>
              {subjectLabel(x)}
            </option>
          ))}
        </select>
      </div>
      <section className="section">
        <SectionHead title={kind === 'all' ? 'All documents' : KINDS.find((k) => k.value === kind)!.label} count={shown.length} />
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" aria-label="Filter by title" placeholder="Filter by title" value={q} onChange={(e) => {
              setQ(e.target.value);
              setParam('q', e.target.value);
            }} />
        </label>
        {shown.length === 0 ? (
          <Empty>
            {s.documents.length === 0
              ? 'No documents yet. Add IDs from a person’s Identity page, health records from Health, and car papers from a car’s Documents.'
              : filtering
                ? 'Nothing matches these filters.'
                : 'Everything here is archived.'}
          </Empty>
        ) : (
          <DocList docs={shown} showSubject />
        )}
      </section>
      <ArchiveSection docs={archived} showSubject />
    </div>
  );
}

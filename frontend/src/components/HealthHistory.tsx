/**
 * Treatment history (health documents and past health visits), as a timeline
 * grouped by month with episode filters, or as a list. One section of a
 * person's page.
 */
import { useMemo, useState } from 'react';
import type { Document, Subject, Task } from '../types/coo';
import { useStore } from '../store/Store';
import { useUI } from '../store/UI';
import { Chips, Empty, Segmented, SectionHead } from './ui';
import { Icon } from './Icon';
import { DocRow, docSearch, useDocActions } from './SubjectParts';
import { DocFormFor } from '../dialogs/DocDialogs';
import { fmtDate } from '../lib/dates';
import { notesText } from '../lib/richtext';
import { appointmentNote, assignmentIdOf, contactName, docsFor, routineOf, tasksForSubject } from '../lib/model';
import { fieldText } from '../lib/registry';

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const f = (d: Document, key: string) => fieldText(d.fields, key);

type HistEntry = { date: string; doc?: Document; visit?: Task };

/** A person's treatment history: health documents and past visits as a timeline or a list. */
export function HealthHistory({ person }: { person: Subject }) {
  const { s } = useStore();
  const { openDialog } = useUI();
  const act = useDocActions();
  const [view, setView] = useState<'timeline' | 'list'>('timeline');
  const [episode, setEpisode] = useState('all');
  const [q, setQ] = useState('');
  const docs = docsFor(s, person.id, 'health');
  const live = docs.filter((d) => !d.archived);
  const episodes = [...new Set(live.map((d) => f(d, 'episode')).filter(Boolean))];
  const visits = tasksForSubject(s, person.id).filter(
    (t) => t.appointment && t.done && routineOf(s, s.assignments.find((a) => a.id === assignmentIdOf(t)))?.area === 'health',
  );

  const entries: HistEntry[] = useMemo(() => {
    const list: HistEntry[] = live
      .filter((d) => (episode === 'all' || f(d, 'episode') === episode) && docSearch(q, d, s))
      .map((d) => ({ date: d.date ?? d.createdAt.slice(0, 10), doc: d }));
    if (episode === 'all') {
      for (const v of visits) {
        const hay = `${v.title} ${notesText(v.notes)} ${appointmentNote(s, v)}`.toLowerCase();
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
      <section className="section">
        <SectionHead
          title="Treatment history"
          count={live.length}
          action={
            <button type="button" className="link" onClick={() => openDialog(<DocFormFor category="health" subjectId={person.id} />)}>
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
                          <div className="row-title">{e.doc.title}</div>
                          <div className="row-meta">{[e.doc.type, contactName(s, f(e.doc, 'providerId') || null)].filter(Boolean).join(' · ')}</div>
                          {f(e.doc, 'about') && <div className="small">{f(e.doc, 'about')}</div>}
                          <div className="tl-foot">
                            {f(e.doc, 'episode') && (
                              <button type="button" className="chip small-chip" onClick={() => setEpisode(f(e.doc!, 'episode'))}>
                                {f(e.doc, 'episode')}
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
                          <div className="row-meta">{[appointmentNote(s, e.visit!), notesText(e.visit!.notes)].filter(Boolean).join(' · ')}</div>
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
    </>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useEvents } from '../hooks/useEvents';
import { useAuth } from '../auth/useAuth';
import type { EventKind, NewEvent } from '../types/organizer';
import { installRipple } from '../lib/ripple';
import { useTheme } from '../lib/theme';
import { deriveReminders, deriveShopping, deriveTimeline, rescheduleEntry } from '../lib/derive';
import type { TimelineEntry } from '../lib/derive';
import FilterTabs, {
  FIXED_TABS,
  TAB_META,
  itemsForTab,
  tabLabel,
  isViewTab,
  type Tab,
} from './FilterTabs';
import EventList from './EventList';
import EventDetail from './EventDetail';
import KindPicker from './KindPicker';
import RemindersView from './RemindersView';
import ShoppingView from './ShoppingView';
import TimelineView from './TimelineView';

type Selection =
  | { mode: 'none' }
  | { mode: 'pick' }
  | { mode: 'add'; kind: EventKind }
  | { mode: 'edit'; id: string };

const KIND_FOR_TAB: Record<EventKind, Tab> = {
  container: 'container',
  occurrence: 'occurrence',
  habit: 'habit',
  list: 'list',
};

export default function EventApp() {
  const { events, loading, error, addEvent, updateEvent, removeEvent, completeEvent } = useEvents();
  const { logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<Tab>('timeline');
  const [selection, setSelection] = useState<Selection>({ mode: 'none' });
  const [showDone, setShowDone] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => installRipple(), []);

  const sourceItems = useMemo(
    () =>
      showDone
        ? events
        : events.filter((e) => e.status !== 'done' && e.status !== 'cancelled'),
    [events, showDone],
  );

  const q = query.trim().toLowerCase();
  const searchedItems = useMemo(() => {
    if (!q) return sourceItems;
    return sourceItems.filter(
      (e) =>
        e.title.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [sourceItems, q]);

  const visibleItems = useMemo(
    () => itemsForTab(searchedItems, activeTab),
    [searchedItems, activeTab],
  );

  const tags = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => e.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [events]);

  const reminderCount = useMemo(() => deriveReminders(events, { status: 'pending' }).length, [events]);
  const shoppingCount = useMemo(() => deriveShopping(events).length, [events]);
  const timelineCount = useMemo(() => deriveTimeline(sourceItems).length, [sourceItems]);

  const counts = useMemo(() => {
    const c = {} as Record<Tab, number>;
    for (const tab of FIXED_TABS) {
      if (tab === 'timeline') c[tab] = timelineCount;
      else if (tab === 'reminders') c[tab] = reminderCount;
      else if (tab === 'shopping') c[tab] = shoppingCount;
      else c[tab] = itemsForTab(searchedItems, tab).length;
    }
    return c;
  }, [searchedItems, timelineCount, reminderCount, shoppingCount]);

  const selectedItem =
    selection.mode === 'edit' ? events.find((e) => e.id === selection.id) ?? null : null;

  async function handleSave(data: NewEvent) {
    if (selection.mode === 'edit') {
      await updateEvent(selection.id, data);
    } else {
      const created = await addEvent(data);
      setActiveTab(KIND_FOR_TAB[created.kind] ?? 'timeline');
      setSelection({ mode: 'edit', id: created.id });
    }
  }

  async function handleDelete() {
    if (selection.mode !== 'edit') return;
    await removeEvent(selection.id);
    setSelection({ mode: 'none' });
  }

  async function handleToggleDone(id: string, done: boolean) {
    const event = events.find((e) => e.id === id);
    if (!event) return;
    if (done && event.recurrence_rule) {
      // Recurring → complete this occurrence and spawn the next (server-side).
      await completeEvent(id);
    } else {
      await updateEvent(id, { status: done ? 'done' : 'active' });
    }
  }

  async function handleTogglePurchased(
    eventId: string,
    checklistId: string,
    itemId: string,
    purchased: boolean,
  ) {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;
    const checklists = event.checklists.map((cl) =>
      cl.id === checklistId
        ? { ...cl, items: cl.items.map((i) => (i.id === itemId ? { ...i, purchased } : i)) }
        : cl,
    );
    await updateEvent(eventId, { checklists });
  }

  async function handleReschedule(eventId: string, entry: TimelineEntry, day: string) {
    const event = events.find((e) => e.id === eventId);
    if (!event) return;
    const update = rescheduleEntry(event, entry, day);
    if (update) await updateEvent(eventId, update);
  }

  const detailKey =
    selection.mode === 'edit'
      ? `edit-${selection.id}`
      : selection.mode === 'add'
        ? `add-${selection.kind}`
        : selection.mode;

  const viewTab = isViewTab(activeTab);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-brand" title="Organizer">
          <span className="brand-mark">▾</span>
        </div>
        <nav className="side-nav">
          {FIXED_TABS.map((tab) => (
            <button
              key={tab}
              className={tab === activeTab ? 'side-btn active' : 'side-btn'}
              onClick={() => setActiveTab(tab)}
              title={TAB_META[tab].label}
              aria-label={TAB_META[tab].label}
            >
              <span aria-hidden>{TAB_META[tab].icon}</span>
            </button>
          ))}
        </nav>
        <div className="side-bottom">
          <button
            className="side-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            <span aria-hidden>{theme === 'dark' ? '☀️' : '🌙'}</span>
          </button>
          <button className="side-btn" onClick={logout} title="Log out" aria-label="Log out">
            <span aria-hidden>⎋</span>
          </button>
          <span className="side-avatar" aria-hidden>
            🧑
          </span>
        </div>
      </aside>

      <main className="main">
        <header className="pagehead">
          <div className="pagehead-titles">
            <h1 className="display">{tabLabel(activeTab)}</h1>
            <p className="pagehead-sub">Plan &amp; track everything</p>
          </div>
          <div className="pagehead-tools">
            <label className="searchbox">
              <span className="searchbox-icon" aria-hidden>
                🔍
              </span>
              <input
                type="search"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search events"
              />
            </label>
            <button className="btn btn-primary ripple" onClick={() => setSelection({ mode: 'pick' })}>
              + New Event
            </button>
          </div>
        </header>

        <div className="tabbar">
          <FilterTabs activeTab={activeTab} counts={counts} onSelectTab={setActiveTab} />
        </div>

        <div className={viewTab ? 'workspace view' : 'workspace'}>
          <section className="card card-list">
            <div className="card-head">
              <h2 className="display">{tabLabel(activeTab)}</h2>
              <div className="card-head-right">
                {!viewTab && (
                  <label className="switch" title="Show or hide completed events">
                    <input
                      type="checkbox"
                      checked={showDone}
                      onChange={(e) => setShowDone(e.target.checked)}
                    />
                    <span className="switch-track">
                      <span className="switch-thumb" />
                    </span>
                    <span className="switch-label">Show completed</span>
                  </label>
                )}
                <span className="card-head-count">{counts[activeTab] ?? 0}</span>
              </div>
            </div>
            <div className="card-body">
              {loading && <p className="muted">Loading…</p>}
              {error && <p className="error">{error}</p>}
              {!loading && !error && activeTab === 'timeline' && (
                <TimelineView
                  events={sourceItems}
                  query={query}
                  selectedId={selection.mode === 'edit' ? selection.id : null}
                  onOpenEvent={(id) => setSelection({ mode: 'edit', id })}
                  onReschedule={handleReschedule}
                />
              )}
              {!loading && !error && activeTab === 'reminders' && (
                <RemindersView events={events} onOpenEvent={(id) => setSelection({ mode: 'edit', id })} />
              )}
              {!loading && !error && activeTab === 'shopping' && (
                <ShoppingView
                  events={events}
                  onOpenEvent={(id) => setSelection({ mode: 'edit', id })}
                  onTogglePurchased={handleTogglePurchased}
                />
              )}
              {!loading && !error && !viewTab && (
                <EventList
                  items={visibleItems}
                  selectedId={selection.mode === 'edit' ? selection.id : null}
                  onSelect={(id) => setSelection({ mode: 'edit', id })}
                  onToggleDone={handleToggleDone}
                />
              )}
            </div>
          </section>

          <section className="card card-detail">
            <div className="card-body">
              {selection.mode === 'none' ? (
                <div className="placeholder">
                  <p className="display">Nothing selected</p>
                  <p className="muted">Pick an event on the left, or add a new one.</p>
                </div>
              ) : selection.mode === 'pick' ? (
                <KindPicker
                  onPick={(kind) => setSelection({ mode: 'add', kind })}
                  onClose={() => setSelection({ mode: 'none' })}
                />
              ) : (
                <EventDetail
                  key={detailKey}
                  item={selectedItem}
                  addKind={selection.mode === 'add' ? selection.kind : 'list'}
                  knownTags={tags}
                  defaultTags={[]}
                  onSave={handleSave}
                  onDelete={selection.mode === 'edit' ? handleDelete : undefined}
                  onClose={() => setSelection({ mode: 'none' })}
                />
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

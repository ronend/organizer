import { useEffect, useMemo, useState } from 'react';
import { useEvents } from '../hooks/useEvents';
import { useAuth } from '../auth/useAuth';
import type { EventKind, NewEvent } from '../types/organizer';
import { labelize } from '../types/organizer';
import { installRipple } from '../lib/ripple';
import { useTheme } from '../lib/theme';
import { deriveReminders, deriveShopping } from '../lib/derive';
import FilterTabs, {
  itemsForTab,
  tabLabel,
  isViewTab,
  SPECIAL_TABS,
  VIEW_TABS,
  type Tab,
} from './FilterTabs';
import EventList from './EventList';
import EventDetail from './EventDetail';
import KindPicker from './KindPicker';
import RemindersView from './RemindersView';
import ShoppingView from './ShoppingView';

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

  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [selection, setSelection] = useState<Selection>({ mode: 'none' });
  const [showDone, setShowDone] = useState(false);

  useEffect(() => installRipple(), []);

  const sourceItems = useMemo(
    () =>
      showDone
        ? events
        : events.filter((e) => e.status !== 'done' && e.status !== 'cancelled'),
    [events, showDone],
  );

  const visibleItems = useMemo(() => itemsForTab(sourceItems, activeTab), [sourceItems, activeTab]);

  const tags = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => e.tags.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [events]);

  const reminderCount = useMemo(() => deriveReminders(events, { status: 'pending' }).length, [events]);
  const shoppingCount = useMemo(() => deriveShopping(events).length, [events]);

  const selectedItem =
    selection.mode === 'edit' ? events.find((e) => e.id === selection.id) ?? null : null;

  async function handleSave(data: NewEvent) {
    if (selection.mode === 'edit') {
      await updateEvent(selection.id, data);
    } else {
      const created = await addEvent(data);
      setActiveTab(KIND_FOR_TAB[created.kind] ?? 'today');
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

  async function handleDeleteTag(tag: string) {
    const affected = events.filter((e) => e.tags.includes(tag));
    const ok = window.confirm(
      `Delete tag "${labelize(tag)}"? It will be removed from ${affected.length} event${
        affected.length === 1 ? '' : 's'
      }.`,
    );
    if (!ok) return;
    await Promise.all(
      affected.map((e) => updateEvent(e.id, { tags: e.tags.filter((t) => t !== tag) })),
    );
    if (activeTab === tag) setActiveTab('today');
  }

  const isSpecial = (SPECIAL_TABS as readonly string[]).includes(activeTab) ||
    (VIEW_TABS as readonly string[]).includes(activeTab);
  const defaultTags = !isSpecial ? [activeTab] : [];

  const detailKey =
    selection.mode === 'edit'
      ? `edit-${selection.id}`
      : selection.mode === 'add'
        ? `add-${selection.kind}`
        : selection.mode;

  const viewTab = isViewTab(activeTab);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <h1 className="display">Organizer</h1>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary ripple" onClick={() => setSelection({ mode: 'pick' })}>
            + New Event
          </button>
          <button
            className="btn btn-ghost ripple icon-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button className="btn btn-ghost ripple" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <div className="bento">
        <div className="card card-tabs">
          <FilterTabs
            items={sourceItems}
            tags={tags}
            reminderCount={reminderCount}
            shoppingCount={shoppingCount}
            activeTab={activeTab}
            onSelectTab={(tab) => setActiveTab(tab)}
            onSelectItem={(id, tab) => {
              setActiveTab(tab);
              setSelection({ mode: 'edit', id });
            }}
            onDeleteTag={handleDeleteTag}
          />
        </div>

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
              <span className="card-head-count">
                {viewTab
                  ? activeTab === 'reminders'
                    ? reminderCount
                    : shoppingCount
                  : visibleItems.length}
              </span>
            </div>
          </div>
          <div className="card-body">
            {loading && <p className="muted">Loading…</p>}
            {error && <p className="error">{error}</p>}
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
                defaultTags={defaultTags}
                onSave={handleSave}
                onDelete={selection.mode === 'edit' ? handleDelete : undefined}
                onClose={() => setSelection({ mode: 'none' })}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

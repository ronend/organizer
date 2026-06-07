import { useEffect, useMemo, useState } from 'react';
import { useOrganizers } from '../hooks/useOrganizers';
import { useAuth } from '../auth/useAuth';
import type { EntryType, NewOrganizer, Organizer } from '../types/organizer';
import { labelize } from '../types/organizer';
import { installRipple } from '../lib/ripple';
import { useTheme } from '../lib/theme';
import { parseDue, reminderDueStrings } from '../lib/recurrence';
import FilterTabs, { itemsForTab, tabLabel, SPECIAL_TABS, type Tab } from './FilterTabs';
import EntryList from './EntryList';
import EntryDetail from './EntryDetail';
import EntryTypePicker from './EntryTypePicker';

type Selection =
  | { mode: 'none' }
  | { mode: 'pick' }
  | { mode: 'add'; type: EntryType }
  | { mode: 'edit'; id: string };

export default function OrganizerApp() {
  const {
    organizers,
    loading,
    error,
    addOrganizer,
    updateOrganizer,
    removeOrganizer,
    completeRoutine,
  } = useOrganizers();
  const { logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [selection, setSelection] = useState<Selection>({ mode: 'none' });
  const [showDone, setShowDone] = useState(false);

  useEffect(() => installRipple(), []);

  // Apply the show/hide-completed switch once, up front, so tab counts, the
  // hover dropdowns, and the list all reflect it consistently.
  const sourceItems = useMemo(
    () => (showDone ? organizers : organizers.filter((i) => !i.done)),
    [organizers, showDone],
  );

  const visibleItems = useMemo(
    () => itemsForTab(sourceItems, activeTab),
    [sourceItems, activeTab],
  );

  // User tags = every distinct tag currently in use (sorted), shown as tabs.
  const tags = useMemo(() => {
    const set = new Set<string>();
    organizers.forEach((o) => o.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [organizers]);

  const selectedItem =
    selection.mode === 'edit'
      ? organizers.find((o) => o.id === selection.id) ?? null
      : null;

  // Create one reminder sub-task per reminder of a recurring entry's current
  // occurrence (subsequent occurrences are spawned server-side on completion).
  async function createReminders(entry: Organizer) {
    const reminders = entry.reminders ?? [];
    if (!reminders.length) return;
    const occ = parseDue(entry.dueDate, entry.dueTime);
    for (const r of reminders) {
      const { dueDate, dueTime } = reminderDueStrings(occ, r);
      await addOrganizer({
        type: 'task',
        title: r.label,
        description: r.note ?? '',
        tags: entry.tags,
        dueDate,
        dueTime,
        done: false,
        recurrence: null,
        reminders: [],
        parentId: entry.id,
        isPrereq: true,
      });
    }
  }

  async function handleSave(data: NewOrganizer) {
    if (selection.mode === 'edit') {
      const updated = await updateOrganizer(selection.id, data);
      if (updated.type === 'recurring') {
        // Reconcile reminders: drop incomplete existing ones, recreate from templates.
        const stale = organizers.filter(
          (o) => o.parentId === updated.id && o.isPrereq && !o.done,
        );
        await Promise.all(stale.map((o) => removeOrganizer(o.id)));
        await createReminders(updated);
      }
    } else {
      const created = await addOrganizer(data);
      if (created.type === 'recurring') await createReminders(created);
      // Show the new entry: jump to a tab where it appears, then select it.
      setActiveTab(created.type === 'recurring' ? 'recurring' : 'tasks');
      setSelection({ mode: 'edit', id: created.id });
    }
  }

  async function handleDelete() {
    if (selection.mode !== 'edit') return;
    const id = selection.id;
    const item = organizers.find((o) => o.id === id);
    if (item?.type === 'recurring') {
      // Cascade-delete this recurring entry's reminder sub-tasks.
      const children = organizers.filter((o) => o.parentId === id);
      await Promise.all(children.map((c) => removeOrganizer(c.id)));
    }
    await removeOrganizer(id);
    setSelection({ mode: 'none' });
  }

  async function handleToggleDone(id: string, done: boolean) {
    const item = organizers.find((o) => o.id === id);
    // Completing a recurring occurrence is atomic on the backend: it marks this
    // one done and spawns the next occurrence (+ reminders) in one transaction.
    if (done && item && item.type === 'recurring' && item.recurrence) {
      await completeRoutine(id);
    } else {
      void updateOrganizer(id, { done });
    }
  }

  async function handleDeleteTag(tag: string) {
    const affected = organizers.filter((o) => o.tags?.includes(tag));
    const ok = window.confirm(
      `Delete tag "${labelize(tag)}"? It will be removed from ${affected.length} entr${
        affected.length === 1 ? 'y' : 'ies'
      }.`,
    );
    if (!ok) return;
    await Promise.all(
      affected.map((o) =>
        updateOrganizer(o.id, { tags: (o.tags ?? []).filter((t) => t !== tag) }),
      ),
    );
    if (activeTab === tag) setActiveTab('today');
  }

  // When adding from a tag tab, pre-seed that tag on the new entry.
  const defaultTags =
    !SPECIAL_TABS.includes(activeTab as (typeof SPECIAL_TABS)[number]) ? [activeTab] : [];

  const detailKey =
    selection.mode === 'edit'
      ? `edit-${selection.id}`
      : selection.mode === 'add'
        ? `add-${selection.type}`
        : selection.mode;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <h1 className="display">Organizer</h1>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary ripple"
            onClick={() => setSelection({ mode: 'pick' })}
          >
            + New Entry
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
              <label className="switch" title="Show or hide completed entries">
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
              <span className="card-head-count">{visibleItems.length}</span>
            </div>
          </div>
          <div className="card-body">
            {loading && <p className="muted">Loading…</p>}
            {error && <p className="error">{error}</p>}
            {!loading && !error && (
              <EntryList
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
                <p className="muted">Pick an entry on the left, or add a new one.</p>
              </div>
            ) : selection.mode === 'pick' ? (
              <EntryTypePicker
                onPick={(type) => setSelection({ mode: 'add', type })}
                onClose={() => setSelection({ mode: 'none' })}
              />
            ) : (
              <EntryDetail
                key={detailKey}
                item={selectedItem}
                addType={selection.mode === 'add' ? selection.type : 'task'}
                knownTags={tags}
                allEntries={organizers}
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

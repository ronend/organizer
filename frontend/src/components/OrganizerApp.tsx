import { useEffect, useMemo, useState } from 'react';
import { useOrganizers } from '../hooks/useOrganizers';
import { useAuth } from '../auth/useAuth';
import type { Category, NewOrganizer, Organizer } from '../types/organizer';
import { DEFAULT_CATEGORY, labelize } from '../types/organizer';
import { installRipple } from '../lib/ripple';
import { useTheme } from '../lib/theme';
import { parseDue, prereqDueStrings } from '../lib/recurrence';
import CategoryTabs, { itemsForTab, tabLabel, type Tab } from './CategoryTabs';
import ItemList from './ItemList';
import ItemDetail from './ItemDetail';

type Selection =
  | { mode: 'none' }
  | { mode: 'add' }
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

  // Apply the show/hide-done switch once, up front, so tab counts, the hover
  // dropdowns, and the list all reflect it consistently.
  const sourceItems = useMemo(
    () => (showDone ? organizers : organizers.filter((i) => !i.done)),
    [organizers, showDone],
  );

  const visibleItems = useMemo(
    () => itemsForTab(sourceItems, activeTab),
    [sourceItems, activeTab],
  );

  // Tabs = the permanent 'errand' category + any other labels currently in use
  // (errand first, the rest sorted). Empty non-errand labels disappear.
  const categories = useMemo(() => {
    const others = new Set<string>();
    organizers.forEach((o) => {
      if (o.category && o.category !== DEFAULT_CATEGORY) others.add(o.category);
    });
    return [DEFAULT_CATEGORY, ...Array.from(others).sort()];
  }, [organizers]);

  const selectedItem =
    selection.mode === 'edit'
      ? organizers.find((o) => o.id === selection.id) ?? null
      : null;

  // Create one list item per prerequisite of a routine occurrence.
  async function createPrereqs(routine: Organizer) {
    const prereqs = routine.prerequisites ?? [];
    if (!prereqs.length) return;
    const occ = parseDue(routine.dueDate, routine.dueTime);
    for (const p of prereqs) {
      const { dueDate, dueTime } = prereqDueStrings(occ, p);
      await addOrganizer({
        title: p.title,
        category: routine.category,
        type: 'simple',
        description: '',
        dueDate,
        dueTime,
        done: false,
        recurrence: null,
        prerequisites: [],
        parentId: routine.id,
        isPrereq: true,
      });
    }
  }

  async function handleSave(data: NewOrganizer) {
    if (selection.mode === 'edit') {
      const updated = await updateOrganizer(selection.id, data);
      if (updated.type === 'routine') {
        // Reconcile prereqs: drop incomplete existing ones, recreate from templates.
        const stale = organizers.filter(
          (o) => o.parentId === updated.id && o.isPrereq && !o.done,
        );
        await Promise.all(stale.map((o) => removeOrganizer(o.id)));
        await createPrereqs(updated);
      }
    } else {
      const created = await addOrganizer(data);
      if (created.type === 'routine') await createPrereqs(created);
      // Show the new item: jump to its category tab (a new item due tomorrow
      // wouldn't appear under "Today"), and select it.
      setActiveTab(created.category);
      setSelection({ mode: 'edit', id: created.id });
    }
  }

  async function handleDelete() {
    if (selection.mode !== 'edit') return;
    const id = selection.id;
    const item = organizers.find((o) => o.id === id);
    if (item?.type === 'routine') {
      // Cascade-delete this routine's prerequisite items.
      const children = organizers.filter((o) => o.parentId === id);
      await Promise.all(children.map((c) => removeOrganizer(c.id)));
    }
    await removeOrganizer(id);
    setSelection({ mode: 'none' });
  }

  async function handleToggleDone(id: string, done: boolean) {
    const item = organizers.find((o) => o.id === id);
    // Completing a routine occurrence is atomic on the backend: it marks this
    // one done and spawns the next occurrence (+ prereqs) in one transaction.
    if (done && item && item.type === 'routine' && item.recurrence) {
      await completeRoutine(id);
    } else {
      void updateOrganizer(id, { done });
    }
  }

  async function handleDeleteCategory(cat: string) {
    if (cat === DEFAULT_CATEGORY || cat === 'today') return;
    const affected = organizers.filter((o) => o.category === cat);
    const ok = window.confirm(
      `Delete label "${labelize(cat)}"? Its ${affected.length} item(s) will move to Errand.`,
    );
    if (!ok) return;
    await Promise.all(
      affected.map((o) => updateOrganizer(o.id, { category: DEFAULT_CATEGORY })),
    );
    if (activeTab === cat) setActiveTab('today');
  }

  const defaultCategory: Category | undefined =
    activeTab === 'today' ? undefined : activeTab;

  const detailKey =
    selection.mode === 'edit' ? `edit-${selection.id}` : selection.mode;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <h1 className="display">Organizer</h1>
        </div>
        <div className="header-actions">
          <button className="btn btn-primary ripple" onClick={() => setSelection({ mode: 'add' })}>
            + Add item
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
          <CategoryTabs
            items={sourceItems}
            categories={categories}
            activeTab={activeTab}
            permanent={DEFAULT_CATEGORY}
            onSelectTab={(tab) => setActiveTab(tab)}
            onSelectItem={(id, tab) => {
              setActiveTab(tab);
              setSelection({ mode: 'edit', id });
            }}
            onDeleteCategory={handleDeleteCategory}
          />
        </div>

        <section className="card card-list">
          <div className="card-head">
            <h2 className="display">{tabLabel(activeTab)}</h2>
            <div className="card-head-right">
              <label className="switch" title="Show or hide completed items">
                <input
                  type="checkbox"
                  checked={showDone}
                  onChange={(e) => setShowDone(e.target.checked)}
                />
                <span className="switch-track">
                  <span className="switch-thumb" />
                </span>
                <span className="switch-label">Show done</span>
              </label>
              <span className="card-head-count">{visibleItems.length}</span>
            </div>
          </div>
          <div className="card-body">
            {loading && <p className="muted">Loading…</p>}
            {error && <p className="error">{error}</p>}
            {!loading && !error && (
              <ItemList
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
                <p className="muted">Pick an item on the left, or add a new one.</p>
              </div>
            ) : (
              <ItemDetail
                key={detailKey}
                item={selectedItem}
                categories={categories}
                defaultCategory={defaultCategory}
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

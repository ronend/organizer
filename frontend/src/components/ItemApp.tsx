import { useEffect, useMemo, useState } from 'react';
import { useItems } from '../hooks/useItems';
import { useAuth } from '../auth/useAuth';
import type { Entity, EntityType, NewEntity } from '../types/organizer';
import { isCompleted } from '../types/organizer';
import { installRipple } from '../lib/ripple';
import { useTheme } from '../lib/theme';
import { deriveReminders, sortedByDate } from '../lib/derive';
import FilterTabs, { FIXED_TABS, TAB_META, itemsForTab, tabLabel, isViewTab, type Tab } from './FilterTabs';
import ItemList from './ItemList';
import ItemForm from './ItemForm';
import TypePicker from './TypePicker';
import RemindersView from './RemindersView';
import StoryTimelineView from './StoryTimelineView';
import Icon from './Icon';

type Selection =
  | { mode: 'none' }
  | { mode: 'pick' }
  | { mode: 'add'; type: EntityType }
  | { mode: 'edit'; id: string };

export default function ItemApp() {
  const { items, loading, error, addItem, updateItem, removeItem } = useItems();
  const { logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();

  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [selection, setSelection] = useState<Selection>({ mode: 'none' });
  const [showDone, setShowDone] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => installRipple(), []);

  const sourceItems = useMemo(
    () => (showDone ? items : items.filter((e) => !isCompleted(e))),
    [items, showDone],
  );

  const q = query.trim().toLowerCase();
  const searched = useMemo(
    () => (q ? sourceItems.filter((e) => e.title.toLowerCase().includes(q)) : sourceItems),
    [sourceItems, q],
  );

  const visibleItems = useMemo(() => sortedByDate(itemsForTab(searched, activeTab)), [searched, activeTab]);

  const reminderCount = useMemo(() => deriveReminders(items, { upcomingOnly: true }).length, [items]);

  const counts = useMemo(() => {
    const c = {} as Record<Tab, number>;
    for (const tab of FIXED_TABS) {
      c[tab] = tab === 'reminders' ? reminderCount : itemsForTab(searched, tab).length;
    }
    return c;
  }, [searched, reminderCount]);

  const selectedItem: Entity | null =
    selection.mode === 'edit' ? items.find((e) => e.id === selection.id) ?? null : null;

  async function handleSave(data: NewEntity) {
    if (selection.mode === 'edit') {
      await updateItem(selection.id, data as Record<string, unknown>);
    } else {
      const created = await addItem(data);
      setActiveTab(created.type);
      setSelection({ mode: 'edit', id: created.id });
    }
  }

  async function handleDelete() {
    if (selection.mode !== 'edit') return;
    await removeItem(selection.id);
    setSelection({ mode: 'none' });
  }

  async function handleToggleComplete(id: string, completed: boolean) {
    await updateItem(id, { completed });
  }

  const detailKey =
    selection.mode === 'edit'
      ? `edit-${selection.id}`
      : selection.mode === 'add'
        ? `add-${selection.type}`
        : selection.mode;

  const viewTab = isViewTab(activeTab);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-brand" title="Organizer">
          <Icon name="logo" size={24} />
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
              <Icon name={TAB_META[tab].icon} size={20} />
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
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
          </button>
          <button className="side-btn" onClick={logout} title="Log out" aria-label="Log out">
            <Icon name="logout" size={20} />
          </button>
          <span className="side-avatar" aria-hidden>
            <Icon name="user" size={18} />
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
              <span className="searchbox-icon">
                <Icon name="search" size={16} />
              </span>
              <input
                type="search"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search items"
              />
            </label>
            <button className="btn btn-primary ripple with-icon" onClick={() => setSelection({ mode: 'pick' })}>
              <Icon name="plus" size={16} />
              New item
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
                  <label className="switch" title="Show or hide completed items">
                    <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
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
              {!loading && !error && activeTab === 'reminders' && (
                <RemindersView items={items} onOpen={(id) => setSelection({ mode: 'edit', id })} />
              )}
              {!loading && !error && !viewTab && (
                <ItemList
                  items={visibleItems}
                  selectedId={selection.mode === 'edit' ? selection.id : null}
                  onSelect={(id) => setSelection({ mode: 'edit', id })}
                  onToggleComplete={handleToggleComplete}
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
              ) : selection.mode === 'pick' ? (
                <TypePicker
                  onPick={(type) => setSelection({ mode: 'add', type })}
                  onClose={() => setSelection({ mode: 'none' })}
                />
              ) : (
                <>
                  <ItemForm
                    key={detailKey}
                    item={selectedItem}
                    addType={selection.mode === 'add' ? selection.type : 'todo'}
                    allItems={items}
                    onSave={handleSave}
                    onDelete={selection.mode === 'edit' ? handleDelete : undefined}
                    onClose={() => setSelection({ mode: 'none' })}
                  />
                  {selectedItem?.type === 'story' && (
                    <StoryTimelineView
                      story={selectedItem}
                      allItems={items}
                      onOpen={(id) => setSelection({ mode: 'edit', id })}
                    />
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

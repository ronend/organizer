import { useMemo, useState } from 'react';
import { useOrganizers } from '../hooks/useOrganizers';
import { useAuth } from '../auth/useAuth';
import type { Category, NewOrganizer } from '../types/organizer';
import CategoryTabs, { itemsForTab, type Tab } from './CategoryTabs';
import ItemList from './ItemList';
import ItemDetail from './ItemDetail';

type Selection =
  | { mode: 'none' }
  | { mode: 'add' }
  | { mode: 'edit'; id: string };

export default function OrganizerApp() {
  const { organizers, loading, error, addOrganizer, updateOrganizer, removeOrganizer } =
    useOrganizers();
  const { logout } = useAuth();

  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [selection, setSelection] = useState<Selection>({ mode: 'none' });

  const visibleItems = useMemo(
    () => itemsForTab(organizers, activeTab),
    [organizers, activeTab],
  );

  const selectedItem =
    selection.mode === 'edit'
      ? organizers.find((o) => o.id === selection.id) ?? null
      : null;

  async function handleSave(data: NewOrganizer) {
    if (selection.mode === 'edit') {
      await updateOrganizer(selection.id, data);
    } else {
      const created = await addOrganizer(data);
      setSelection({ mode: 'edit', id: created.id });
    }
  }

  async function handleDelete() {
    if (selection.mode !== 'edit') return;
    await removeOrganizer(selection.id);
    setSelection({ mode: 'none' });
  }

  function handleToggleDone(id: string, done: boolean) {
    void updateOrganizer(id, { done });
  }

  // Default category for a new item depends on which tab is active.
  const defaultCategory: Category | undefined =
    activeTab === 'today' ? undefined : activeTab;

  // Remount the detail pane whenever the target changes so its form re-seeds.
  const detailKey =
    selection.mode === 'edit' ? `edit-${selection.id}` : selection.mode;

  return (
    <div className="app">
      <header className="app-header">
        <h1>Organizer</h1>
        <div className="header-actions">
          <button className="primary" onClick={() => setSelection({ mode: 'add' })}>
            + Add item
          </button>
          <button className="link" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <CategoryTabs
        items={organizers}
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
        onSelectItem={(id, tab) => {
          setActiveTab(tab);
          setSelection({ mode: 'edit', id });
        }}
      />

      <main className="panes">
        <section className="left-pane">
          {loading && <p>Loading…</p>}
          {error && <p className="error">{error}</p>}
          {!loading && !error && (
            <ItemList
              items={visibleItems}
              selectedId={selection.mode === 'edit' ? selection.id : null}
              onSelect={(id) => setSelection({ mode: 'edit', id })}
              onToggleDone={handleToggleDone}
            />
          )}
        </section>

        <section className="right-pane">
          {selection.mode === 'none' ? (
            <p className="empty placeholder">
              Select an item to view or edit, or add a new one.
            </p>
          ) : (
            <ItemDetail
              key={detailKey}
              item={selectedItem}
              defaultCategory={defaultCategory}
              onSave={handleSave}
              onDelete={selection.mode === 'edit' ? handleDelete : undefined}
              onClose={() => setSelection({ mode: 'none' })}
            />
          )}
        </section>
      </main>
    </div>
  );
}

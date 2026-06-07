import type { Organizer } from '../types/organizer';
import { labelize } from '../types/organizer';
import { compareByDue, isOverdue, isToday } from '../lib/dates';

// Built-in tabs come first; any user tag becomes an additional cross-type tab.
export const SPECIAL_TABS = ['today', 'tasks', 'recurring'] as const;
export type Tab = string; // 'today' | 'tasks' | 'recurring' | a tag label

const SPECIAL_LABELS: Record<string, string> = {
  today: 'Today',
  tasks: 'Tasks',
  recurring: 'Recurring',
};

/** Entries belonging to a tab. */
export function itemsForTab(items: Organizer[], tab: Tab): Organizer[] {
  let filtered: Organizer[];
  if (tab === 'today') filtered = items.filter((i) => isToday(i) || isOverdue(i));
  else if (tab === 'tasks') filtered = items.filter((i) => i.type === 'task');
  else if (tab === 'recurring') filtered = items.filter((i) => i.type === 'recurring');
  else filtered = items.filter((i) => i.tags?.includes(tab));
  return [...filtered].sort(compareByDue);
}

export function tabLabel(tab: Tab): string {
  return SPECIAL_LABELS[tab] ?? labelize(tab);
}

interface Props {
  items: Organizer[];
  tags: string[]; // user tags currently in use (sorted)
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  onSelectItem: (id: string, tab: Tab) => void;
  onDeleteTag: (tag: string) => void;
}

export default function FilterTabs({
  items,
  tags,
  activeTab,
  onSelectTab,
  onSelectItem,
  onDeleteTag,
}: Props) {
  const tabs: Tab[] = [...SPECIAL_TABS, ...tags];
  return (
    <nav className="tabs">
      {tabs.map((tab) => {
        const tabItems = itemsForTab(items, tab);
        const isTag = !SPECIAL_TABS.includes(tab as (typeof SPECIAL_TABS)[number]);
        // Tag tabs always get a dropdown (so Delete is reachable even at 0).
        const showDropdown = tabItems.length > 0 || isTag;
        return (
          <div key={tab} className="tab-wrap">
            <button
              className={tab === activeTab ? 'tab ripple active' : 'tab ripple'}
              onClick={() => onSelectTab(tab)}
            >
              {tabLabel(tab)}
              <span className="tab-count">{tabItems.length}</span>
            </button>
            {showDropdown && (
              <ul className="tab-dropdown">
                {tabItems.map((item) => (
                  <li key={item.id}>
                    <button
                      className="tab-dropdown-item"
                      onClick={() => onSelectItem(item.id, tab)}
                    >
                      <span className={item.done ? 'dd-title done' : 'dd-title'}>
                        {item.title || '(untitled)'}
                      </span>
                    </button>
                  </li>
                ))}
                {tabItems.length === 0 && <li className="dd-empty">No entries</li>}
                {isTag && (
                  <li>
                    <button
                      className="tab-dropdown-item delete"
                      onClick={() => onDeleteTag(tab)}
                    >
                      🗑 Delete tag
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

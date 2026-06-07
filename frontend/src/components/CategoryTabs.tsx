import type { Organizer } from '../types/organizer';
import { CATEGORIES } from '../types/organizer';
import { compareByDue, isOverdue, isToday } from '../lib/dates';

export type Tab = 'today' | (typeof CATEGORIES)[number];

const TABS: Tab[] = ['today', ...CATEGORIES];

const LABELS: Record<Tab, string> = {
  today: 'Today',
  errand: 'Errand',
  project: 'Project',
  health: 'Health',
  finance: 'Finance',
  home: 'Home',
};

/** Items belonging to a tab. */
export function itemsForTab(items: Organizer[], tab: Tab): Organizer[] {
  const filtered =
    tab === 'today'
      ? items.filter((i) => isToday(i) || isOverdue(i))
      : items.filter((i) => i.category === tab);
  return [...filtered].sort(compareByDue);
}

interface Props {
  items: Organizer[];
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  onSelectItem: (id: string, tab: Tab) => void;
}

export default function CategoryTabs({ items, activeTab, onSelectTab, onSelectItem }: Props) {
  return (
    <nav className="tabs">
      {TABS.map((tab) => {
        const tabItems = itemsForTab(items, tab);
        return (
          <div key={tab} className="tab-wrap">
            <button
              className={tab === activeTab ? 'tab ripple active' : 'tab ripple'}
              onClick={() => onSelectTab(tab)}
            >
              {LABELS[tab]}
              <span className="tab-count">{tabItems.length}</span>
            </button>
            {tabItems.length > 0 && (
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
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

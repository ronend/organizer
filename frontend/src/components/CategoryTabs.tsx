import type { Organizer } from '../types/organizer';
import { labelize } from '../types/organizer';
import { compareByDue, isOverdue, isToday } from '../lib/dates';

export type Tab = string; // 'today' or a category label

/** Items belonging to a tab. */
export function itemsForTab(items: Organizer[], tab: Tab): Organizer[] {
  const filtered =
    tab === 'today'
      ? items.filter((i) => isToday(i) || isOverdue(i))
      : items.filter((i) => i.category === tab);
  return [...filtered].sort(compareByDue);
}

export function tabLabel(tab: Tab): string {
  return tab === 'today' ? 'Today' : labelize(tab);
}

interface Props {
  items: Organizer[];
  categories: string[]; // ordered category labels (without 'today')
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  onSelectItem: (id: string, tab: Tab) => void;
}

export default function CategoryTabs({
  items,
  categories,
  activeTab,
  onSelectTab,
  onSelectItem,
}: Props) {
  const tabs: Tab[] = ['today', ...categories];
  return (
    <nav className="tabs">
      {tabs.map((tab) => {
        const tabItems = itemsForTab(items, tab);
        return (
          <div key={tab} className="tab-wrap">
            <button
              className={tab === activeTab ? 'tab ripple active' : 'tab ripple'}
              onClick={() => onSelectTab(tab)}
            >
              {tabLabel(tab)}
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

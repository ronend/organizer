import type { EventDocument } from '../types/organizer';
import { labelize } from '../types/organizer';
import { compareByStart, isOverdue, isToday } from '../lib/dates';

// Event-card tabs (filter the events list).
export const KIND_TABS = ['container', 'occurrence', 'habit', 'list'] as const;
export const SPECIAL_TABS = ['today', ...KIND_TABS] as const;
// Derived-view tabs (render their own views, not event cards).
export const VIEW_TABS = ['reminders', 'shopping'] as const;

export type Tab = string;

const TAB_LABELS: Record<string, string> = {
  today: 'Today',
  container: 'Trips / Projects',
  occurrence: 'Appointments',
  habit: 'Habits',
  list: 'Lists',
  reminders: 'Reminders',
  shopping: 'Shopping',
};

export function isViewTab(tab: Tab): boolean {
  return (VIEW_TABS as readonly string[]).includes(tab);
}

/** Events belonging to a (non-view) tab. */
export function itemsForTab(items: EventDocument[], tab: Tab): EventDocument[] {
  let filtered: EventDocument[];
  if (tab === 'today') filtered = items.filter((i) => isToday(i) || isOverdue(i));
  else if ((KIND_TABS as readonly string[]).includes(tab)) filtered = items.filter((i) => i.kind === tab);
  else if (isViewTab(tab)) filtered = [];
  else filtered = items.filter((i) => i.tags.includes(tab));
  return [...filtered].sort(compareByStart);
}

export function tabLabel(tab: Tab): string {
  return TAB_LABELS[tab] ?? labelize(tab);
}

interface Props {
  items: EventDocument[];
  tags: string[];
  reminderCount: number;
  shoppingCount: number;
  activeTab: Tab;
  onSelectTab: (tab: Tab) => void;
  onSelectItem: (id: string, tab: Tab) => void;
  onDeleteTag: (tag: string) => void;
}

export default function FilterTabs({
  items,
  tags,
  reminderCount,
  shoppingCount,
  activeTab,
  onSelectTab,
  onSelectItem,
  onDeleteTag,
}: Props) {
  const viewCounts: Record<string, number> = { reminders: reminderCount, shopping: shoppingCount };
  const tabs: Tab[] = [...SPECIAL_TABS, ...VIEW_TABS, ...tags];

  return (
    <nav className="tabs">
      {tabs.map((tab) => {
        const view = isViewTab(tab);
        const tabItems = view ? [] : itemsForTab(items, tab);
        const isTag = !(SPECIAL_TABS as readonly string[]).includes(tab) && !view;
        const count = view ? viewCounts[tab] ?? 0 : tabItems.length;
        const showDropdown = !view && (tabItems.length > 0 || isTag);
        return (
          <div key={tab} className="tab-wrap">
            <button
              className={tab === activeTab ? 'tab ripple active' : 'tab ripple'}
              onClick={() => onSelectTab(tab)}
            >
              {tabLabel(tab)}
              <span className="tab-count">{count}</span>
            </button>
            {showDropdown && (
              <ul className="tab-dropdown">
                {tabItems.map((item) => (
                  <li key={item.id}>
                    <button className="tab-dropdown-item" onClick={() => onSelectItem(item.id, tab)}>
                      <span
                        className={
                          item.status === 'done' || item.status === 'cancelled'
                            ? 'dd-title done'
                            : 'dd-title'
                        }
                      >
                        {item.title || '(untitled)'}
                      </span>
                    </button>
                  </li>
                ))}
                {tabItems.length === 0 && <li className="dd-empty">No events</li>}
                {isTag && (
                  <li>
                    <button className="tab-dropdown-item delete" onClick={() => onDeleteTag(tab)}>
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

import type { EventDocument } from '../types/organizer';
import { compareByStart, isOverdue, isToday } from '../lib/dates';
import Icon, { type IconName } from './Icon';

// Event-card tabs (filter the events list).
export const KIND_TABS = ['container', 'occurrence', 'habit', 'list'] as const;
// Tabs whose contents are event cards.
export const LIST_TABS = ['today', ...KIND_TABS] as const;
// Tabs that render their own view instead of the event-card list.
export const VIEW_TABS = ['timeline', 'reminders', 'shopping'] as const;
// The full, fixed set — order is the display order. Tags are NOT tabs.
export const FIXED_TABS = [
  'timeline',
  'today',
  'container',
  'occurrence',
  'habit',
  'list',
  'reminders',
  'shopping',
] as const;

export type Tab = (typeof FIXED_TABS)[number];

export const TAB_META: Record<Tab, { label: string; icon: IconName }> = {
  timeline: { label: 'Timeline', icon: 'timeline' },
  today: { label: 'Today', icon: 'today' },
  container: { label: 'Trips / Projects', icon: 'briefcase' },
  occurrence: { label: 'Appointments', icon: 'calendar' },
  habit: { label: 'Habits', icon: 'repeat' },
  list: { label: 'Lists', icon: 'list-checks' },
  reminders: { label: 'Reminders', icon: 'bell' },
  shopping: { label: 'Shopping', icon: 'cart' },
};

export function isViewTab(tab: Tab): boolean {
  return (VIEW_TABS as readonly string[]).includes(tab);
}

/** Events belonging to a (list) tab. View tabs render their own data. */
export function itemsForTab(items: EventDocument[], tab: Tab): EventDocument[] {
  let filtered: EventDocument[];
  if (tab === 'today') filtered = items.filter((i) => isToday(i) || isOverdue(i));
  else if ((KIND_TABS as readonly string[]).includes(tab)) filtered = items.filter((i) => i.kind === tab);
  else filtered = [];
  return [...filtered].sort(compareByStart);
}

export function tabLabel(tab: Tab): string {
  return TAB_META[tab]?.label ?? tab;
}

interface Props {
  activeTab: Tab;
  counts: Record<Tab, number>;
  onSelectTab: (tab: Tab) => void;
}

export default function FilterTabs({ activeTab, counts, onSelectTab }: Props) {
  return (
    <nav className="tabs" role="tablist">
      {FIXED_TABS.map((tab) => (
        <button
          key={tab}
          role="tab"
          aria-selected={tab === activeTab}
          className={tab === activeTab ? 'tab ripple active' : 'tab ripple'}
          onClick={() => onSelectTab(tab)}
        >
          <span className="tab-icon">
            <Icon name={TAB_META[tab].icon} size={16} />
          </span>
          {TAB_META[tab].label}
          <span className="tab-count">{counts[tab] ?? 0}</span>
        </button>
      ))}
    </nav>
  );
}

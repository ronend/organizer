import type { Entity, EntityType } from '../types/organizer';
import Icon, { TYPE_ICON, type IconName } from './Icon';

// One tab per entity type, plus a unified "all" agenda and the reminders view.
export const TYPE_TABS: EntityType[] = [
  'todo',
  'appointment',
  'reservation',
  'event',
  'routine',
  'habit',
  'story',
];
export const VIEW_TABS = ['reminders'] as const;
export const FIXED_TABS = ['all', ...TYPE_TABS, ...VIEW_TABS] as const;

export type Tab = (typeof FIXED_TABS)[number];

export const TAB_META: Record<Tab, { label: string; icon: IconName }> = {
  all: { label: 'All items', icon: 'timeline' },
  todo: { label: 'Todos', icon: TYPE_ICON.todo },
  appointment: { label: 'Appointments', icon: TYPE_ICON.appointment },
  reservation: { label: 'Reservations', icon: TYPE_ICON.reservation },
  event: { label: 'Events', icon: TYPE_ICON.event },
  routine: { label: 'Routines', icon: TYPE_ICON.routine },
  habit: { label: 'Habits', icon: TYPE_ICON.habit },
  story: { label: 'Stories', icon: TYPE_ICON.story },
  reminders: { label: 'Reminders', icon: 'bell' },
};

export function isViewTab(tab: Tab): boolean {
  return (VIEW_TABS as readonly string[]).includes(tab);
}

export function isTypeTab(tab: Tab): tab is EntityType {
  return (TYPE_TABS as readonly string[]).includes(tab);
}

/** Entities belonging to a tab. "all" shows everything; view tabs render their
 * own data (empty here). */
export function itemsForTab(items: Entity[], tab: Tab): Entity[] {
  if (tab === 'all') return items;
  if (isTypeTab(tab)) return items.filter((e) => e.type === tab);
  return [];
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

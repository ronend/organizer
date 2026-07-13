import type { CSSProperties, ReactNode } from 'react';
import type { EventKind, ItemKind } from '../types/organizer';

// A small, modern line-icon set (Lucide/Feather style). Every glyph is drawn on
// a 24×24 grid, strokes `currentColor`, and scales crisply — so icons inherit
// text color and theme automatically. Filled accents (dots) opt out of stroke.

export type IconName =
  | 'timeline'
  | 'today'
  | 'briefcase'
  | 'calendar'
  | 'repeat'
  | 'list-checks'
  | 'bell'
  | 'cart'
  | 'logo'
  | 'sun'
  | 'moon'
  | 'logout'
  | 'user'
  | 'plus'
  | 'search'
  | 'grip'
  | 'check-circle'
  | 'ticket'
  | 'file-text'
  | 'chevron-down'
  | 'chevron-right'
  | 'check'
  | 'x'
  | 'list'
  | 'arrow-up'
  | 'arrow-down';

const dot = (cx: number, cy: number, r = 1.3) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
);

const ICONS: Record<IconName, ReactNode> = {
  timeline: (
    <>
      {dot(4, 6, 1.6)}
      {dot(4, 12, 1.6)}
      {dot(4, 18, 1.6)}
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
    </>
  ),
  today: (
    <>
      <circle cx="12" cy="12" r="9" />
      {dot(12, 12, 2.4)}
    </>
  ),
  briefcase: (
    <>
      <rect x="2.5" y="7" width="19" height="13" rx="2.2" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="2.5" y1="12.5" x2="21.5" y2="12.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2.2" />
      <line x1="8" y1="2.5" x2="8" y2="6.5" />
      <line x1="16" y1="2.5" x2="16" y2="6.5" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
    </>
  ),
  repeat: (
    <>
      <polyline points="17 2 21 6 17 10" />
      <path d="M3 12V9a3 3 0 0 1 3-3h15" />
      <polyline points="7 22 3 18 7 14" />
      <path d="M21 12v3a3 3 0 0 1-3 3H3" />
    </>
  ),
  'list-checks': (
    <>
      <polyline points="3.5 7 5 8.5 8 5.5" />
      <polyline points="3.5 16 5 17.5 8 14.5" />
      <line x1="11" y1="7.5" x2="20" y2="7.5" />
      <line x1="11" y1="16.5" x2="20" y2="16.5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  cart: (
    <>
      {dot(9, 20, 1.4)}
      {dot(18, 20, 1.4)}
      <path d="M2 3h2.2l2.3 12.2a1.6 1.6 0 0 0 1.6 1.3h9a1.6 1.6 0 0 0 1.6-1.3L21 7H5.5" />
    </>
  ),
  logo: (
    <>
      <polygon points="12 2 21 7 12 12 3 7 12 2" />
      <polyline points="3 12 12 17 21 12" />
      <polyline points="3 17 12 22 21 17" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.2" y1="4.2" x2="5.6" y2="5.6" />
      <line x1="18.4" y1="18.4" x2="19.8" y2="19.8" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.2" y1="19.8" x2="5.6" y2="18.4" />
      <line x1="18.4" y1="5.6" x2="19.8" y2="4.2" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />,
  logout: (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </>
  ),
  user: (
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  plus: (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7.5" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </>
  ),
  grip: (
    <>
      {dot(9, 6)}
      {dot(9, 12)}
      {dot(9, 18)}
      {dot(15, 6)}
      {dot(15, 12)}
      {dot(15, 18)}
    </>
  ),
  'check-circle': (
    <>
      <path d="M21.5 11.1V12a9.5 9.5 0 1 1-5.6-8.7" />
      <polyline points="21 5 12 14 9.5 11.5" />
    </>
  ),
  ticket: (
    <>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" />
      <line x1="12" y1="7" x2="12" y2="9" />
      <line x1="12" y1="15" x2="12" y2="17" />
    </>
  ),
  'file-text': (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <polyline points="14 3 14 8 19 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </>
  ),
  'chevron-down': <polyline points="6 9 12 15 18 9" />,
  'chevron-right': <polyline points="9 6 15 12 9 18" />,
  check: <polyline points="20 6 9 17 4 12" />,
  x: (
    <>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </>
  ),
  list: (
    <>
      <line x1="8" y1="6" x2="20" y2="6" />
      <line x1="8" y1="12" x2="20" y2="12" />
      <line x1="8" y1="18" x2="20" y2="18" />
      {dot(4, 6, 1.1)}
      {dot(4, 12, 1.1)}
      {dot(4, 18, 1.1)}
    </>
  ),
  'arrow-up': (
    <>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </>
  ),
  'arrow-down': (
    <>
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="6 13 12 19 18 13" />
    </>
  ),
};

/** Icon name to use for each event kind. */
export const KIND_ICON: Record<EventKind, IconName> = {
  container: 'briefcase',
  occurrence: 'calendar',
  habit: 'repeat',
  list: 'list-checks',
};

/** Icon name to use for each embedded item kind. */
export const ITEM_ICON: Record<ItemKind, IconName> = {
  task: 'check-circle',
  reservation: 'ticket',
  entry: 'file-text',
  checklist_item: 'check',
};

interface Props {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

export default function Icon({ name, size = 20, strokeWidth = 1.75, className, style }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
      focusable={false}
    >
      {ICONS[name]}
    </svg>
  );
}

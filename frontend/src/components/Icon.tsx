/** Line icons, 24×24 grid, 1.8 px stroke, currentColor. */
const P: Record<string, JSX.Element> = {
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  repeat: <path d="M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4v1M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4v-1" />,
  document: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c1-3.2 3.5-5 6.5-5s5.5 1.8 6.5 5M15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 15.4c1.7.7 2.9 2.2 3.5 4.6" />
    </>
  ),
  car: (
    <>
      <path d="M4 16.5V12l2-5.2A2 2 0 0 1 7.9 5.5h8.2a2 2 0 0 1 1.9 1.3L20 12v4.5" />
      <path d="M3 12h18v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M6.5 18v2M17.5 18v2" />
      <circle cx="7.5" cy="15" r=".6" fill="currentColor" />
      <circle cx="16.5" cy="15" r=".6" fill="currentColor" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 12.5 10 17.5 19 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M9 20.5h6M12 16.5v4" />
    </>
  ),
  phone: (
    <path d="M6.6 3.5h2.6l1.5 4.2-2 1.4a12 12 0 0 0 6.2 6.2l1.4-2 4.2 1.5v2.6a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" />
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4.5" rx="1" />
      <path d="M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4" />
    </>
  ),
  shield: <path d="M12 3 5 6v5.5c0 4.4 3 8 7 9.5 4-1.5 7-5.1 7-9.5V6z" />,
  wrench: (
    <path d="M14.7 6.3a4 4 0 0 0 5 5L21 10a5.5 5.5 0 0 1-7.3 5.2L7 21.9a2 2 0 0 1-2.9-2.9l6.7-6.7A5.5 5.5 0 0 1 16 5l-1.3 1.3z" />
  ),
  stamp: (
    <>
      <path d="M9.5 13.5V11a2.5 2.5 0 0 0-1-2A4 4 0 1 1 15.5 9a2.5 2.5 0 0 0-1 2v2.5" />
      <path d="M4 13.5h16v4H4zM6 20.5h12" />
    </>
  ),
  stethoscope: (
    <>
      <path d="M6 3.5H5v5a5 5 0 0 0 10 0v-5h-1" />
      <path d="M10 13.5V16a4.5 4.5 0 0 0 9 0v-2" />
      <circle cx="19" cy="11.5" r="2.2" />
    </>
  ),
  tooth: (
    <path d="M12 5.5C10.5 4 8.8 3.5 7.2 4 4.6 4.8 4 7.6 4.6 10c.5 2 1.2 3.4 1.6 5.5.4 2.2.7 4.5 2 4.5 1.6 0 1.5-4.6 3.8-4.6s2.2 4.6 3.8 4.6c1.3 0 1.6-2.3 2-4.5.4-2.1 1.1-3.5 1.6-5.5.6-2.4 0-5.2-2.6-6-1.6-.5-3.3 0-4.8 1.5z" />
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  syringe: <path d="M18 2.5l3.5 3.5M19.75 4.25 16 8M15 5l4 4M17 7l-9.5 9.5H4.5v-3L14 4M10 7.5l2 2M7.5 10l2 2M4.5 16.5l-2 2" />,
  flask: (
    <>
      <path d="M9.5 3.5h5M10.5 3.5v6l-5.6 9.3A1.5 1.5 0 0 0 6.2 21h11.6a1.5 1.5 0 0 0 1.3-2.2l-5.6-9.3v-6" />
      <path d="M7.4 15h9.2" />
    </>
  ),
  pill: (
    <>
      <rect x="2.6" y="8" width="18.8" height="8" rx="4" transform="rotate(-45 12 12)" />
      <path d="M8.8 8.8l6.4 6.4" />
    </>
  ),
  bone: (
    <path d="M17 10c.8.8 2.2.8 3 0a2.1 2.1 0 0 0-1.5-3.5A2.1 2.1 0 0 0 15 5c-.8.8-.8 2.2 0 3L8 15c-.8-.8-2.2-.8-3 0a2.1 2.1 0 0 0 1.5 3.5A2.1 2.1 0 0 0 10 20c.8-.8.8-2.2 0-3z" />
  ),
  idcard: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <circle cx="8.5" cy="11" r="2.2" />
      <path d="M5 16.5c.6-1.6 2-2.5 3.5-2.5s2.9.9 3.5 2.5M14.5 10h4M14.5 13.5h3" />
    </>
  ),
  plane: (
    <path d="M10.5 13.5 3 11l1.5-1.5 8 .5 4-4.5c1-1 2.6-1.4 3.2-.8.6.6.2 2.2-.8 3.2l-4.5 4 .5 8L13.5 21l-2.5-7.5-3.5 3.2.2 2.3-1.2 1.2-1.4-3.4L1.7 15.4l1.2-1.2 2.3.2z" />
  ),
  bed: <path d="M3 18.5V6M3 14h18v4.5M21 14v-2.5a3 3 0 0 0-3-3h-7V14M7 11.5a1.8 1.8 0 1 0 0-.01" />,
  ticket: (
    <path d="M3.5 7.5a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1V10a2 2 0 0 0 0 4v2.5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V14a2 2 0 0 0 0-4zM14 6.5v2M14 11v2M14 15.5v2" />
  ),
  trail: <path d="M2.5 19.5 9 8l3.5 6 2.5-4 6.5 9.5zM7 12.5l2 1.5 1.5-1" />,
  train: (
    <>
      <rect x="5" y="3" width="14" height="14" rx="3" />
      <path d="M5 11h14M8.5 21l2-4M15.5 21l-2-4" />
      <circle cx="9" cy="14" r=".7" fill="currentColor" />
      <circle cx="15" cy="14" r=".7" fill="currentColor" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.8 12 21 12 21z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  link: (
    <path d="M10 14a4 4 0 0 0 5.7 0l3.3-3.3a4 4 0 0 0-5.7-5.7L12 6.3M14 10a4 4 0 0 0-5.7 0L5 13.3A4 4 0 0 0 10.7 19L12 17.7" />
  ),
  suitcase: (
    <>
      <rect x="3.5" y="7" width="17" height="13" rx="2.5" />
      <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M8 7v13M16 7v13" />
    </>
  ),
  bell: <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v5.5M12 16.2v.3" />
    </>
  ),
  chevron: <path d="M9.5 6l6 6-6 6" />,
  'chevron-left': <path d="M14.5 6l-6 6 6 6" />,
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  grip: (
    <>
      {[8, 12, 16].map((y) => (
        <g key={y}>
          <circle cx="9.5" cy={y} r="1.3" fill="currentColor" stroke="none" />
          <circle cx="14.5" cy={y} r="1.3" fill="currentColor" stroke="none" />
        </g>
      ))}
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />,
  contacts: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <circle cx="12" cy="10" r="2.8" />
      <path d="M7.5 17c.8-2 2.5-3 4.5-3s3.7 1 4.5 3" />
    </>
  ),
  corner: <path d="M6 4v8a4 4 0 0 0 4 4h9M15 12l4 4-4 4" />,
  bold: <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />,
  italic: <path d="M10 5h8M6 19h8M14 5l-4 14" />,
  list: (
    <>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" />
      <circle cx="4.5" cy="6.5" r=".9" fill="currentColor" />
      <circle cx="4.5" cy="12" r=".9" fill="currentColor" />
      <circle cx="4.5" cy="17.5" r=".9" fill="currentColor" />
    </>
  ),
  'list-ordered': <path d="M10 6.5h10M10 12h10M10 17.5h10M4 5l1.5-1v5M3.5 10.5a1.3 1.3 0 0 1 2.4.6c0 .8-2.4 2-2.4 2.9h2.6M3.5 16h2.2l-1.2 1.4a1.3 1.3 0 1 1-1 2.3" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  logout: <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M9.5 16.5 5 12l4.5-4.5M5 12h10" />,
};

export type IconName = keyof typeof P | string;

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {P[name] ?? P.document}
    </svg>
  );
}

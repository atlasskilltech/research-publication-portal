/**
 * Icon — lightweight inline SVG icon set (no icon-library dependency).
 * Stroke-based, 24x24, inherits currentColor.
 */
const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></>,
  papers: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6M10 17h6" /></>,
  submissions: <><path d="M4 5h16v14H4z" /><path d="M4 9h16" /><path d="M8 13h8M8 16h5" /></>,
  submit: <><path d="M12 19V7" /><path d="M6 12l6-6 6 6" /><path d="M4 21h16" /></>,
  import: <><path d="M12 4v10" /><path d="M8 10l4 4 4-4" /><path d="M4 20h16" /></>,
  volumes: <><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2z" /><path d="M20 5a2 2 0 0 0-2-2h-5v18h5a2 2 0 0 0 2-2z" /></>,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><path d="M10 12h4" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5.5a3 3 0 0 1 0 5.5" /><path d="M18 20a6 6 0 0 0-3-5" /></>,
  activity: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M10.5 21a1.8 1.8 0 0 0 3 0" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  chevron: <><path d="M6 9l6 6 6-6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></>,
  logout: <><path d="M15 12H3" /><path d="M9 8l-4 4 4 4" /><path d="M13 4h6v16h-6" /></>,
  check: <><path d="M5 12l5 5 9-11" /></>,
  checks: <><path d="M3 12l4 4 8-10" /><path d="M11 16l2 2 8-10" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  alert: <><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17h.01" /></>,
  inbox: <><path d="M4 13l2.5-8h11L20 13" /><path d="M4 13v6h16v-6" /><path d="M4 13h5a3 3 0 0 0 6 0h5" /></>,
  external: <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  bell: <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /></>,
  filter: <><path d="M3 5h18l-7 8v6l-4-2v-4z" /></>,
  upload: <><path d="M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9a3.5 3.5 0 0 1 .5 6.96" /><path d="M12 20v-7" /><path d="M9 15l3-3 3 3" /></>,
  download: <><path d="M12 4v12" /><path d="M8 12l4 4 4-4" /><path d="M5 20h14" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></>,
  grip: <><circle cx="9" cy="6" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="6" r="1.1" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="9" cy="18" r="1.1" fill="currentColor" stroke="none" /><circle cx="15" cy="18" r="1.1" fill="currentColor" stroke="none" /></>,
  calendar: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18" /><path d="M8 2v4M16 2v4" /></>,
  userplus: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 11 0" /><path d="M18 8v6M15 11h6" /></>,
  shield: <><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  wand: <><path d="M15 4V2M15 10V8M12 6h-2M20 6h-2" /><path d="M13 8l-9 9 2 2 9-9z" /></>,
};

export default function Icon({ name, size = 20, className = "", strokeWidth = 1.8, ...rest }) {
  const path = PATHS[name];
  if (!path) return null;
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
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {path}
    </svg>
  );
}

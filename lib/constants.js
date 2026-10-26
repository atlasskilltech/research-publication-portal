/**
 * Domain constants for the Research Publication Portal.
 * Source of truth = reference/figma-design screenshots + planning docs.
 * Phase 1 is UI-only; these drive navigation, labels and styling.
 */

export const BRAND = {
  name: "Research Publication Portal",
  short: "2025–26 Portal",
  eyebrow: "RESEARCH PUB",
  university: "ATLAS SkillTech University",
};

/* ---- Schools (ID prefix → school) ---- */
export const SCHOOLS = {
  ISDI: { code: "ISDI", name: "School of Design & Innovation", color: "isdi" },
  ISME: { code: "ISME", name: "BBA", color: "isme" },
  uGDX: { code: "uGDX", name: "B.Tech", color: "ugdx" },
  LAW: { code: "LAW", name: "LLB", color: "law" },
};

export const SCHOOL_CHIP = {
  ISDI: "bg-isdi text-white",
  ISME: "bg-isme text-white",
  uGDX: "bg-ugdx text-white",
  LAW: "bg-law text-white",
};

/* ---- Pipeline phases ---- */
export const PHASES = [
  { key: "P1", code: "P1", label: "SPOC Shortlist", short: "Shortlist", dates: "2025-07-10 → 2025-07-10", caption: "Shortlist to 500 papers by Grade" },
  { key: "P2", code: "P2", label: "Desk Review", short: "Desk", dates: "2025-07-11 → 2025-07-31", caption: "Shortlist to 200 papers" },
  { key: "P3", code: "P3", label: "Blind Peer Review R1", short: "Peer R1", dates: "2025-08-01 → 2025-08-28", caption: "First round of blind reviews" },
  { key: "P4", code: "P4", label: "Blind Peer Review R2", short: "Peer R2", dates: "2025-08-01 → 2025-08-28", caption: "Shortlist to 80 papers" },
  { key: "P5", code: "P5", label: "Formatting, Editing & Volumes", short: "Volumes", dates: "2025-08-31 → 2025-09-26", caption: "8 Volumes × 10 papers, handover" },
];

export const PHASE_LABEL = {
  P1: "P1 Shortlist",
  P2: "P2 Desk",
  P3: "P3 Peer R1",
  P4: "P4 Peer R2",
  P5: "P5 Volumes",
};

/* ---- Statuses (badge styling) ---- */
export const STATUS_META = {
  accepted: { label: "accepted", cls: "bg-ok-soft text-ok border-ok/30" },
  pending: { label: "pending", cls: "bg-soft-2 text-muted border-line" },
  rejected: { label: "rejected", cls: "bg-danger-soft text-danger border-danger/30" },
  none: { label: "none", cls: "bg-soft-2 text-muted border-line" },
  pass: { label: "PASS", cls: "bg-ok-soft text-ok border-ok/30" },
  fail: { label: "FAIL", cls: "bg-danger-soft text-danger border-danger/30" },
  revision: { label: "revision", cls: "bg-warn-soft text-warn border-warn/30" },
};

/* ---- Roles ---- */
export const ROLES = {
  administrator: { key: "administrator", label: "Administrator", chipText: "ADMINISTRATOR", nav: "admin", chip: "bg-brand text-white", caption: "Every paper, every person" },
  spoc: { key: "spoc", label: "SPOC", chipText: "SPOC", nav: "spoc", chip: "bg-brand text-white", caption: "Shortlist + grade assigned papers" },
  desk: { key: "desk", label: "Desk Reviewer", chipText: "DESK REVIEWER", nav: "reviewer", chip: "bg-brand text-white", caption: "Desk-check assigned papers" },
  peer: { key: "peer", label: "Peer Reviewer", chipText: "PEER REVIEWER", nav: "reviewer", chip: "bg-accent text-white", caption: "Review assigned papers (R1 / R2)" },
  editor: { key: "editor", label: "Editor", chipText: "EDITOR", nav: "editor", chip: "bg-ok text-white", caption: "Final decision + volume" },
  student: { key: "student", label: "Student", chipText: "STUDENT", nav: "submitter", chip: "bg-brand-light text-white", caption: "Own papers only" },
  faculty: { key: "faculty", label: "Faculty", chipText: "FACULTY", nav: "submitter", chip: "bg-brand-light text-white", caption: "Own papers only" },
};

/* order used by the role switcher + login "Enter as" list */
export const ROLE_ORDER = ["administrator", "spoc", "desk", "peer", "editor", "student", "faculty"];

/* ---- Navigation per nav-group ---- */
export const NAV = {
  submitter: [
    { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
    { label: "My Submissions", href: "/submissions", icon: "submissions" },
    { label: "Submit Paper", href: "/submit", icon: "submit" },
    { label: "Activity", href: "/activity", icon: "activity" },
  ],
  spoc: [
    { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
    { label: "Papers", href: "/papers", icon: "papers" },
    { label: "Import", href: "/import", icon: "import" },
    { label: "Activity", href: "/activity", icon: "activity" },
  ],
  reviewer: [
    { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
    { label: "Papers", href: "/papers", icon: "papers" },
    { label: "Activity", href: "/activity", icon: "activity" },
  ],
  editor: [
    { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
    { label: "Papers", href: "/papers", icon: "papers" },
    { label: "Volumes", href: "/volumes", icon: "volumes" },
    { label: "Archive", href: "/archive", icon: "archive" },
    { label: "Activity", href: "/activity", icon: "activity" },
  ],
  admin: [
    { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
    { label: "Papers", href: "/papers", icon: "papers" },
    { label: "Import", href: "/import", icon: "import" },
    { label: "Volumes", href: "/volumes", icon: "volumes" },
    { label: "Archive", href: "/archive", icon: "archive" },
    { label: "Users", href: "/users", icon: "users" },
    { label: "Activity", href: "/activity", icon: "activity" },
  ],
};

export function navForRole(roleKey) {
  const role = ROLES[roleKey] || ROLES.administrator;
  return NAV[role.nav] || NAV.admin;
}

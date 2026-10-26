/**
 * Mock data for the Phase-3 management screens (Import · Volumes · Archive · Users).
 * UI-only — mirrors the reference screenshots. No backend, no persistence beyond
 * in-memory React state while the screen is open.
 */

/* ---------- Import ---------- */

/* Expected spreadsheet columns, ordered to read down two columns in the UI.
   `req` marks the columns the importer treats as required. */
export const IMPORT_COLUMNS = [
  { name: "paper_id", req: true }, { name: "student_names", req: true },
  { name: "title", req: true }, { name: "programme" },
  { name: "guide" }, { name: "school" },
  { name: "spoc" }, { name: "grade" },
  { name: "themes" }, { name: "drive_link" },
  { name: "desk_reviewer" }, { name: "peer_r1" },
  { name: "peer_r2" }, { name: "editor" },
  { name: "batch" }, { name: "submitted_by" },
];

/* A canned dry-run result shown after a mock "Upload & import". */
export const IMPORT_SAMPLE_RESULT = {
  fileName: "research-papers-2025-26.csv",
  rows: 24,
  inserted: 18,
  updated: 5,
  skipped: 1,
  preview: [
    { paper_id: "ISDI-07", title: "Typography of Regional Scripts", school: "ISDI", action: "insert" },
    { paper_id: "CD2", title: "Visual Grammar of Indian Street Signage", school: "ISDI", action: "update" },
    { paper_id: "ISME-09", title: "Micro-Finance in Rural Clusters", school: "ISME", action: "insert" },
    { paper_id: "LAW-03", title: "Data Privacy and the Gig Economy", school: "LAW", action: "insert" },
    { paper_id: "—", title: "(missing paper_id)", school: "—", action: "skip" },
  ],
};

export const IMPORT_ACTION_META = {
  insert: "bg-ok-soft text-ok border-ok/30",
  update: "bg-brand-50 text-brand border-brand/20",
  skip: "bg-warn-soft text-warn border-warn/30",
};

/* ---------- Volumes ---------- */

export const VOLUME_TARGET = 10; // papers per volume
export const VOLUME_GOAL = 80; // 8 volumes × 10

/* Papers that have cleared R1 + R2 and await a volume. */
export const READY_PAPERS = [
  { id: "ISDI-05", school: "ISDI", title: "Sample paper 24", student: "Student 24" },
  { id: "ISDI-F2", school: "ISDI", title: "Sample paper 25", student: "Student 25" },
  { id: "ISDI-F3", school: "ISDI", title: "Sample paper 26", student: "Student 26" },
  { id: "ISME-02", school: "ISME", title: "Sample paper 27", student: "Student 27" },
  { id: "ISME-F1", school: "ISME", title: "Sample paper 28", student: "Student 28" },
  { id: "UGDX-01", school: "uGDX", title: "Sample paper 29", student: "Student 29" },
  { id: "UGDX-02", school: "uGDX", title: "Sample paper 30", student: "Student 30" },
  { id: "UGDX-03", school: "uGDX", title: "Sample paper 31", student: "Student 31" },
];

/* Active (un-archived) volumes. */
export const ACTIVE_VOLUMES = [
  { no: "03", title: "Sustainable Design Volume", papers: [], locked: false, lockedBy: "Ishi Srivastava", lockedAt: "21/08/2026" },
  { no: "06", title: "", papers: [], locked: false, lockedBy: null, lockedAt: null },
];

/* ---------- Archive ---------- */

export const ARCHIVE_VOLUMES = [
  {
    no: "05", year: "2025-26", title: "Human-Centred Studies Volume", count: 10,
    lockedBy: "Ishi Srivastava", lockedAt: "20/08/2026", sentBy: "Ishi Srivastava", sentAt: "21/08/2026",
    papers: [
      { id: "ISME-01", title: "Bridging the Knowledge Gap: Finance and Law" },
      { id: "CD2", title: "Visual Grammar of Indian Street Signage" },
      { id: "PD3", title: "Ergonomics of Assistive Devices for Rural India" },
      { id: "FD4", title: "Sustainable Textiles from Agricultural Waste" },
      { id: "ISDI-F1", title: "Test paper updated" },
    ],
    more: 5,
  },
  {
    no: "13", year: "2024-25", title: "Emerging Materials Volume", count: 0,
    lockedBy: "Ishi Srivastava", lockedAt: "14/06/2025", sentBy: "Ishi Srivastava", sentAt: "15/06/2025",
    papers: [], more: 0,
  },
  {
    no: "11", year: "2023-24", title: "Digital Futures Volume", count: 0,
    lockedBy: "Ishi Srivastava", lockedAt: "14/06/2024", sentBy: "Ishi Srivastava", sentAt: "15/06/2024",
    papers: [], more: 0,
  },
  {
    no: "12", year: "2023-24", title: "Craft & Culture Volume", count: 0,
    lockedBy: "Ishi Srivastava", lockedAt: "14/06/2024", sentBy: "Ishi Srivastava", sentAt: "15/06/2024",
    papers: [], more: 0,
  },
];

export const ARCHIVE_YEARS = ["2025-26", "2024-25", "2023-24"];

/* ---------- Users (People & roles) ---------- */

/* role tag styling on the people table + role key */
export const ROLE_TAG = {
  SUBMITTER: "bg-white text-muted border-line",
  SPOC: "bg-brand-50 text-brand border-brand/30",
  "DESK REVIEWER": "bg-soft-2 text-ink border-line",
  "PEER REVIEWER": "bg-accent-soft text-accent border-accent/30",
  EDITOR: "bg-ok-soft text-ok border-ok/30",
  ADMIN: "bg-brand text-white border-brand",
};

/* icon per role tag */
export const ROLE_TAG_ICON = {
  SUBMITTER: "users",
  SPOC: "shield",
  "DESK REVIEWER": "search",
  "PEER REVIEWER": "papers",
  EDITOR: "volumes",
  ADMIN: "shield",
};

export const PEOPLE_ACCOUNTS = [
  { name: "Administrator", email: "admin@university.edu", base: "—", roles: [{ role: "ADMIN" }] },
  { name: "Anushi Shah", email: "student@university.edu", base: "Student", roles: [{ role: "SUBMITTER", count: 1 }] },
  { name: "Elizabeth Jerome", email: "spoc@university.edu", base: "Faculty", roles: [{ role: "SPOC", count: 4 }, { role: "SUBMITTER", count: 1 }] },
  { name: "Ishi Srivastava", email: "editor@university.edu", base: "Faculty", roles: [{ role: "EDITOR", count: 6 }] },
  { name: "Kunica", email: "peer@university.edu", base: "Faculty", roles: [{ role: "PEER REVIEWER", count: 1 }, { role: "SUBMITTER", count: 2 }] },
  { name: "Nishith M", email: "desk@university.edu", base: "Faculty", roles: [{ role: "DESK REVIEWER", count: 1 }] },
  { name: "Peer 2", email: "peer2@university.edu", base: "Faculty", roles: [{ role: "PEER REVIEWER", count: 3 }] },
  { name: "Riya Kapoor", email: "newstudent@university.edu", base: "Student", roles: [{ role: "SUBMITTER", count: 1 }] },
  { name: "Riya Sharma", email: "riya.demo@university.edu", base: "Student", roles: [{ role: "SUBMITTER", count: 2 }, { role: "PEER REVIEWER", count: 1 }] },
  { name: "Rohan Mehta", email: "rohan.m@university.edu", base: "Student", roles: [{ role: "SUBMITTER", count: 1 }] },
  { name: "Sanya Patel", email: "sanya.p@university.edu", base: "Student", roles: [{ role: "SUBMITTER", count: 1 }] },
];

/* right-rail role key: label → people count + caption */
export const ROLE_KEY = [
  { role: "SUBMITTER", people: 11, caption: "Own papers only" },
  { role: "SPOC", people: 1, caption: "Shortlist + grade assigned papers" },
  { role: "DESK REVIEWER", people: 1, caption: "Desk-check assigned papers" },
  { role: "PEER REVIEWER", people: 3, caption: "Review assigned papers (R1 / R2)" },
  { role: "EDITOR", people: 1, caption: "Final decision + volume" },
  { role: "ADMIN", people: 1, caption: "Every paper, every person" },
];

/* filter tabs across the top of the people table */
export const PEOPLE_FILTERS = ["SUBMITTER", "SPOC", "DESK REVIEWER", "PEER REVIEWER", "EDITOR"];

export const ACCESS_RULES = [
  "Roles attach to a paper. One person can be Peer Reviewer on one paper and Submitter on another.",
  "A paper is visible only to its submitter, its assigned roles and Admin.",
  "Nobody can review, grade or edit their own paper.",
];

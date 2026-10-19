/**
 * Mock data for the Phase-1 UI foundation (no backend, no database).
 * Numbers & rows mirror the reference screenshots so the shell looks real.
 */

export const MOCK_USERS = {
  administrator: { name: "Administrator", email: "admin@university.edu", role: "administrator" },
  spoc: { name: "Elizabeth Jerome", email: "spoc@university.edu", role: "spoc" },
  desk: { name: "Nishith M", email: "desk@university.edu", role: "desk" },
  peer: { name: "Kunica", email: "peer@university.edu", role: "peer" },
  editor: { name: "Ishi Srivastava", email: "editor@university.edu", role: "editor" },
  student: { name: "Anushi Shah", email: "student@university.edu", role: "student" },
  faculty: { name: "Faculty Member", email: "faculty@university.edu", role: "faculty" },
};

/* KPI sets per role scope (mirrors dashboards in the reference) */
export const MOCK_KPIS = {
  administrator: { total: 19, shortlist: 2, deskPassed: 1, ready: 8, accepted: 10, rejected: 0 },
  editor: { total: 6, shortlist: 1, deskPassed: 1, ready: 2, accepted: 2, rejected: 0 },
  spoc: { total: 4, shortlist: 1, deskPassed: 1, ready: 1, accepted: 1, rejected: 0 },
  desk: { total: 1, shortlist: 1, deskPassed: 1, ready: 0, accepted: 1, rejected: 0 },
  peer: { total: 1, shortlist: 1, deskPassed: 1, ready: 1, accepted: 1, rejected: 0 },
  student: { total: 0, shortlist: 0, deskPassed: 0, ready: 0, accepted: 0, rejected: 0 },
  faculty: { total: 0, shortlist: 0, deskPassed: 0, ready: 0, accepted: 0, rejected: 0 },
};

export const KPI_CARDS = [
  { key: "total", label: "Total Papers", note: "" },
  { key: "shortlist", label: "Phase 1 Shortlist", note: "Target: 500" },
  { key: "deskPassed", label: "Desk-Review Passed", note: "Target: 200" },
  { key: "ready", label: "Ready for Volumes", note: "R1 + R2 accept" },
  { key: "accepted", label: "Accepted", note: "Target: 80" },
  { key: "rejected", label: "Rejected", note: "" },
];

/* phase counts shown on the admin timeline */
export const MOCK_PHASE_COUNTS = { P1: 0, P2: 1, P3: 0, P4: 8, P5: 10 };

/* papers table rows */
export const MOCK_PAPERS = [
  { id: "CD2", title: "Visual Grammar of Indian Street Signage", student: "Rohan Mehta · Communication Design & New Media", school: "ISDI", grade: "A+", phase: "P5", status: "accepted", drive: true },
  { id: "CD99", title: "Motion Language in Indian TV Idents", student: "Riya Kapoor · Communication Design & New Media", school: "ISDI", grade: "A+", phase: "P2", status: "pending", drive: true },
  { id: "ISDI-F1", title: "Test paper updated", student: "Test S · Faculty", school: "ISDI", grade: "A+", phase: "P5", status: "accepted", drive: true },
  { id: "ISME-01", title: "Bridging the Knowledge Gap: Finance and Law", student: "Anushi Shah · ACCA (Batch 2028)", school: "ISME", grade: "O", phase: "P5", status: "accepted", drive: true },
  { id: "ISDI-01", title: "Sample paper 20", student: "Student 20 · First Year B.Des", school: "ISDI", grade: "—", phase: "P5", status: "accepted", drive: false },
  { id: "ISDI-05", title: "Sample paper 24", student: "Student 24 · First Year B.Des", school: "ISDI", grade: "A", phase: "P4", status: "pending", drive: true },
  { id: "FD4", title: "Sustainable Textiles from Agricultural Waste", student: "Sanya Patel · Fashion Design & Technology", school: "ISDI", grade: "O", phase: "P5", status: "accepted", drive: true },
  { id: "PD3", title: "Ergonomics of Assistive Devices for Rural India", student: "Ira Kapoor · Product Design", school: "ISDI", grade: "A", phase: "P5", status: "accepted", drive: true },
  { id: "UGDX-01", title: "Sample paper 29", student: "Student 29 · Robotics", school: "uGDX", grade: "A", phase: "P4", status: "pending", drive: true },
  { id: "IMP-178", title: "Imp Title", student: "Stud A · LLB (FYLLB)", school: "LAW", grade: "A", phase: "P5", status: "accepted", drive: true },
];

/* activity feed entries */
export const MOCK_ACTIVITY = [
  { type: "ROLE", text: "Role assigned: Kunica → Peer Reviewer R1 on CD2 by Administrator", time: "14/10/2026, 10:42:18", paper: "CD2" },
  { type: "ROLE", text: "Assignment blocked: Rohan Mehta submitted CD2 and cannot review it", time: "14/10/2026, 10:44:51", paper: null },
  { type: "INFO", text: "New paper submitted: CD99 · Motion Language in Indian TV Idents", time: "27/08/2026, 08:19:04", paper: "CD99" },
  { type: "INFO", text: "Volume 5 sent for publishing (archived) by Ishi Srivastava", time: "21/08/2026, 15:26:05", paper: null },
  { type: "INFO", text: "Volume 5 locked by Ishi Srivastava", time: "21/08/2026, 10:35:01", paper: null },
  { type: "INFO", text: "Volume 5 auto-filled with 10 papers by Ishi Srivastava", time: "21/08/2026, 10:34:32", paper: null },
  { type: "DECISION", text: "Paper CD2 finalised as accepted", time: "21/08/2026, 10:15:06", paper: "CD2" },
  { type: "DECISION", text: "Paper ISME-01 finalised as accepted", time: "21/08/2026, 10:10:13", paper: "ISME-01" },
  { type: "ASSIGNMENT", text: "Assigned peer review R1 for ISDI-F1", time: "06/07/2026, 21:32:16", paper: "ISDI-F1" },
];

export const ACTIVITY_BADGE = {
  ROLE: "bg-brand-50 text-brand border-brand/20",
  INFO: "bg-soft-2 text-muted border-line",
  DECISION: "bg-ok-soft text-ok border-ok/30",
  ASSIGNMENT: "bg-accent-soft text-accent border-accent/30",
};

/* scope banner text per role (reference wording) */
export const SCOPE_BANNER = {
  spoc: "Showing only papers assigned to you as SPOC. Other papers, and other SPOCs' queues, are not visible to your account. Contact the Administrator if a paper is missing.",
  desk: "Showing only papers assigned to you as Desk Reviewer. Other papers, and other reviewers' queues, are not visible to your account. Contact the Administrator if a paper is missing.",
  peer: "Showing only papers assigned to you as Peer Reviewer. Other papers, and other reviewers' queues, are not visible to your account. Contact the Administrator if a paper is missing.",
  editor: "Showing only papers assigned to you as Editor. Other papers, and other editors' queues, are not visible to your account. Contact the Administrator if a paper is missing.",
};

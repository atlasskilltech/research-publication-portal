/**
 * Mock paper-detail data for Phase-2 UI (no backend).
 * getPaperDetail(id) returns a fully-shaped detail object for any paper in
 * MOCK_PAPERS, merging per-paper overrides over sensible defaults.
 */
import { MOCK_PAPERS } from "@/lib/mock";

/* people available to assign roles (for the Assign-role modal) */
export const PEOPLE = [
  { name: "Elizabeth Jerome", email: "spoc@university.edu" },
  { name: "Nishith M", email: "desk@university.edu" },
  { name: "Kunica", email: "peer@university.edu" },
  { name: "Peer 2", email: "peer2@university.edu" },
  { name: "Ishi Srivastava", email: "editor@university.edu" },
  { name: "Riya Sharma", email: "riya.demo@university.edu" },
  { name: "Sanya Patel", email: "sanya.p@university.edu" },
];

export const ASSIGNABLE_ROLES = [
  { value: "spoc", label: "SPOC" },
  { value: "desk", label: "Desk Reviewer" },
  { value: "peer_r1", label: "Peer Reviewer · R1" },
  { value: "peer_r2", label: "Peer Reviewer · R2" },
  { value: "editor", label: "Editor" },
];

/* rich overrides keyed by paper id (from the reference screens) */
const OVERRIDES = {
  CD2: {
    author: "Rohan Mehta",
    guide: "Peeyush G",
    specialisation: "Communication Design",
    themes: "Culture, Typography",
    spoc: "spoc@university.edu",
    shortlisted: "No",
    finalBadge: "FINAL: ACCEPTED",
    assignments: { desk: "NU · newu-1783353737@u.edu", r1: "Kunica", r2: "— Unassigned —" },
    desk: { similarity: 14.5, ai: 6, checkedBy: "Nishith M", checkedAt: "21/08/2026, 10:04:38", status: "pending" },
    r1: { decision: "accepted", comments: "strong" },
    r2: { decision: "accepted", comments: "solid" },
    editor: { finalStatus: "accepted", volume: "Volume 5", phase: "P5 Volumes" },
    openSlot: "Peer Reviewer R2",
    rolesOnPaper: [
      { role: "Submitter", person: "Rohan Mehta", email: "rohan.m@university.edu", access: "Owner · can open", tag: "Author" },
      { role: "SPOC", person: "Elizabeth Jerome", email: "spoc@university.edu", access: "Can open" },
      { role: "Desk Reviewer", person: "Nishith M", email: "desk@university.edu", access: "Can open" },
      { role: "Peer Reviewer · R1", person: "Kunica", email: "peer@university.edu", access: "Can open" },
      { role: "Peer Reviewer · R2", person: null, email: null, access: "No access granted", open: true },
      { role: "Editor", person: "Ishi Srivastava", email: "editor@university.edu", access: "Can open" },
      { role: "Admin", person: "All administrators", email: "1 account", access: "Always can open", tag: "Fixed" },
    ],
    canOpen: ["Rohan Mehta", "Elizabeth Jerome", "Nishith M", "Kunica", "Ishi Srivastava", "Administrator"],
    cannotOpen: ["Anushi Shah", "Peer 2", "Riya Kapoor", "Riya Sharma", "Sanya Patel"],
    history: [
      { type: "DECISION", text: "Paper CD2 finalised as accepted", time: "21/08/2026, 10:15:06" },
      { type: "DECISION", text: "Blind Peer Review R2 recorded: Accept", time: "20/08/2026, 16:02:10" },
      { type: "DECISION", text: "Blind Peer Review R1 recorded: Accept", time: "18/08/2026, 11:20:44" },
      { type: "ROLE", text: "Role assigned: Kunica → Peer Reviewer R1 by Administrator", time: "14/10/2026, 10:42:18" },
      { type: "INFO", text: "Desk review opened · Turnitin pending", time: "21/08/2026, 10:04:38" },
      { type: "INFO", text: "New paper submitted: CD2", time: "06/07/2026, 21:30:02" },
    ],
  },
  "ISDI-F1": {
    author: "Test S",
    guide: "G1",
    specialisation: "ISDI · Faculty",
    themes: "t2",
    spoc: "—",
    shortlisted: "Yes",
    finalBadge: "FINAL: ACCEPTED",
    assignments: { desk: "Nishith M (You)", r1: "You", r2: "— Unassigned —" },
    desk: { similarity: 12.7, ai: 4.8, checkedBy: "Nishith M", checkedAt: "21/08/2026, 10:06:12", status: "pass" },
    r1: { decision: "accepted", comments: "strong" },
    r2: { decision: "accepted", comments: "clear" },
    editor: { finalStatus: "accepted", volume: "Volume 5", phase: "P5 Volumes" },
    rolesOnPaper: [
      { role: "Submitter", person: "Test S", email: "test.s@university.edu", access: "Owner · can open", tag: "Author" },
      { role: "Desk Reviewer", person: "Nishith M", email: "desk@university.edu", access: "Can open" },
      { role: "Peer Reviewer · R1", person: "Kunica", email: "peer@university.edu", access: "Can open" },
      { role: "Editor", person: "Ishi Srivastava", email: "editor@university.edu", access: "Can open" },
      { role: "Admin", person: "All administrators", email: "1 account", access: "Always can open", tag: "Fixed" },
    ],
    canOpen: ["Test S", "Nishith M", "Kunica", "Ishi Srivastava", "Administrator"],
    cannotOpen: ["Anushi Shah", "Rohan Mehta", "Sanya Patel"],
    history: [
      { type: "DECISION", text: "Paper ISDI-F1 finalised as accepted", time: "06/07/2026, 21:32:16" },
      { type: "INFO", text: "Desk review PASS · similarity 12.7% · AI 4.8%", time: "21/08/2026, 10:06:12" },
      { type: "ASSIGNMENT", text: "Assigned peer review R1 for ISDI-F1", time: "06/07/2026, 21:32:16" },
    ],
  },
};

function defaultDetail(base) {
  return {
    author: (base.student || "").split(" · ")[0] || "Unknown",
    guide: "—",
    specialisation: base.student?.split(" · ")[1] || base.school,
    themes: "—",
    spoc: "—",
    shortlisted: base.phase === "P1" ? "No" : "Yes",
    finalBadge: base.status === "accepted" ? "FINAL: ACCEPTED" : null,
    assignments: { desk: "— Unassigned —", r1: "— Unassigned —", r2: "— Unassigned —" },
    desk: { similarity: null, ai: null, checkedBy: null, checkedAt: null, status: "pending" },
    r1: { decision: base.phase >= "P3" ? "pending" : null, comments: "" },
    r2: { decision: null, comments: "" },
    editor: { finalStatus: base.status, volume: base.phase === "P5" ? "—" : null, phase: `${base.phase} ${base.phase === "P5" ? "Volumes" : ""}`.trim() },
    rolesOnPaper: [
      { role: "Submitter", person: base.student?.split(" · ")[0], email: "submitter@university.edu", access: "Owner · can open", tag: "Author" },
      { role: "Admin", person: "All administrators", email: "1 account", access: "Always can open", tag: "Fixed" },
    ],
    canOpen: [base.student?.split(" · ")[0], "Administrator"],
    cannotOpen: [],
    history: [{ type: "INFO", text: `New paper submitted: ${base.id}`, time: "06/07/2026, 21:30:00" }],
  };
}

export function getPaperDetail(id) {
  const base = MOCK_PAPERS.find((p) => p.id === id);
  if (!base) return null;
  const detail = OVERRIDES[id] || defaultDetail(base);
  return { ...base, ...detail };
}

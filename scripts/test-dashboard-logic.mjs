/**
 * No-DB tests for the real dashboard + activity feed (lib/dashboardLogic.js),
 * plus static checks that the Phase-0 mock pages are retired.
 * Run: node scripts/test-dashboard-logic.mjs
 */
import { readFileSync } from "node:fs";
import { shapeActivityFeed, summarizeAuthor, summarizeReviewer, summarizeEditorial, summarizeUsers, actionLabel, ACTION_LABEL } from "../lib/dashboardLogic.js";
import { OWNER_VISIBLE_ACTIONS } from "../lib/reviewLogic.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const NOW = new Date("2026-11-01T12:00:00Z");

console.log("\n=== Dashboard & activity tests ===\n");

// Paper P1: authored by A, edited by E, reviewed by R1/R2.
const rows = [
  { id: 1, paper_id: "P1", actor: "A", action: "SUBMITTED", detail: { authors: 2 }, created_at: "2026-10-01T00:00:00Z" },
  { id: 2, paper_id: "P1", actor: "ADMIN", action: "ASSIGNED", detail: { assignee: "R1", role: "PEER_REVIEWER" }, created_at: "2026-10-02T00:00:00Z" },
  { id: 3, paper_id: "P1", actor: "R1", action: "REVIEW_SUBMITTED", detail: { round: 0, recommendation: "REJECT" }, created_at: "2026-10-03T00:00:00Z" },
  { id: 4, paper_id: "P1", actor: "E", action: "DECISION_CREATED", detail: { round: 0, decision: "MAJOR_REVISION" }, created_at: "2026-10-04T00:00:00Z" },
  { id: 5, paper_id: "P1", actor: "E", action: "DECISION_COMMUNICATED", detail: { round: 0, decision: "MAJOR_REVISION" }, created_at: "2026-10-05T00:00:00Z" },
  { id: 6, paper_id: "P1", actor: "A", action: "REVISION_SUBMITTED", detail: { round: 1 }, created_at: "2026-10-06T00:00:00Z" },
  { id: 7, paper_id: "P1", actor: "R2", action: "MANUSCRIPT_DOWNLOADED", detail: { version: 1 }, created_at: "2026-10-07T00:00:00Z" },
  { id: 8, paper_id: "P2", actor: "X", action: "SUBMITTED", detail: {}, created_at: "2026-10-08T00:00:00Z" },
];
const names = new Map([["A", "Author Person"], ["E", "Editor Person"], ["R1", "Reviewer One"], ["R2", "Reviewer Two"], ["ADMIN", "Admin Person"], ["X", "Someone"]]);
const base = { submitterByPaper: new Map([["P1", "A"], ["P2", "X"]]), titleByPaper: new Map([["P1", "Paper One"], ["P2", "Paper Two"]]), nameById: names };
const blob = (x) => JSON.stringify(x);

console.log("Activity feed privacy:");
{
  const adminFeed = shapeActivityFeed(rows, { ...base, viewerId: "ADMIN", isAdmin: true, ownPaperIds: new Set(), editedPaperIds: new Set() });
  check("admin sees every event with actor names", adminFeed.length === 8 && adminFeed.find((x) => x.id === 3).actor === "Reviewer One");
  check("feed sorted newest first", adminFeed[0].id === 8);

  const author = shapeActivityFeed(rows, { ...base, viewerId: "A", isAdmin: false, ownPaperIds: new Set(["P1"]), editedPaperIds: new Set() });
  check("author sees only OWNER_VISIBLE_ACTIONS on their paper", author.every((x) => OWNER_VISIBLE_ACTIONS.includes(x.action)) && author.length === 3);
  check("author never sees reviewer names, ids or recommendations", !/Reviewer|R1|R2|REJECT/.test(blob(author)));
  check("author never sees decision drafts", !author.some((x) => x.action === "DECISION_CREATED"));
  check("author sees no actors at all (even their own) on own paper", author.every((x) => x.actor === null));
  check("author doesn't see other people's papers", !author.some((x) => x.paperId === "P2"));

  const editor = shapeActivityFeed(rows, { ...base, viewerId: "E", isAdmin: false, ownPaperIds: new Set(), editedPaperIds: new Set(["P1"]) });
  check("editor sees all events on edited paper", editor.filter((x) => x.paperId === "P1").length === 7);
  check("editor NEVER sees the author's name (SUBMITTED / REVISION_* actor hidden)", !/Author Person/.test(blob(editor)) && editor.find((x) => x.id === 1).actor === null && editor.find((x) => x.id === 6).actor === null);
  check("editor sees reviewer names (editors manage reviewers)", editor.find((x) => x.id === 3).actor === "Reviewer One");
  check("editor's own actions shown as 'You'", editor.find((x) => x.id === 4).actor === "You");
  check("editor doesn't see unrelated papers", !editor.some((x) => x.paperId === "P2"));

  const reviewer = shapeActivityFeed(rows, { ...base, viewerId: "R1", isAdmin: false, ownPaperIds: new Set(), editedPaperIds: new Set() });
  check("reviewer sees only their own actions", reviewer.length === 1 && reviewer[0].id === 3 && reviewer[0].actor === "You");
  check("reviewer sees no author identity or co-reviewers", !/Author Person|Reviewer Two/.test(blob(reviewer)));

  const stranger = shapeActivityFeed(rows, { ...base, viewerId: "Z", isAdmin: false, ownPaperIds: new Set(), editedPaperIds: new Set() });
  check("unrelated user sees nothing", stranger.length === 0);
  check("feed never exposes raw detail (assignee ids, recommendations)", !/"assignee"|recommendation|"detail"/.test(blob(adminFeed)));
  check("duplicate rows (two queries overlap) are de-duplicated", shapeActivityFeed([...rows, ...rows], { ...base, viewerId: "ADMIN", isAdmin: true }).length === 8);
  check("every action has a human label", Object.keys(ACTION_LABEL).length >= 20 && actionLabel("SOMETHING_NEW") === "something new");
}

console.log("\nAuthor dashboard:");
{
  const papers = [
    { id: "P1", title: "One", status: "REVISION", created_at: "2026-09-01" },
    { id: "P2", title: "Two", status: "UNDER_REVIEW", created_at: "2026-10-01" },
    { id: "P3", title: "Three", status: "PUBLISHED", created_at: "2026-08-01" },
  ];
  const revisions = [{ paper_id: "P1", round: 1, revision_type: "MAJOR", status: "REVISION_REQUESTED", due_at: "2026-10-30T00:00:00Z" }];
  const decisions = [
    { paper_id: "P1", decision: "MAJOR_REVISION", released_at: "2026-10-20T00:00:00Z" },
    { paper_id: "P2", decision: "ACCEPT", released_at: null }, // draft — must never show
  ];
  const s = summarizeAuthor({ papers, revisions, decisions }, NOW);
  check("counts by status", s.counts.total === 3 && s.counts.revision === 1 && s.counts.inReview === 1 && s.counts.published === 1);
  check("revision needing action listed with OVERDUE status", s.actionNeeded.length === 1 && s.actionNeeded[0].status === "REVISION_OVERDUE");
  check("only RELEASED decisions shown (drafts never)", s.recentDecisions.length === 1 && s.recentDecisions[0].decision === "MAJOR_REVISION");
  check("recent submissions newest first", s.recent[0].id === "P2");
  check("submitted revision is not 'action needed'", summarizeAuthor({ papers, revisions: [{ ...revisions[0], status: "REVISION_SUBMITTED" }], decisions: [] }, NOW).actionNeeded.length === 0);
  check("empty author dashboard is all zeros", summarizeAuthor({}, NOW).counts.total === 0);
}

console.log("\nReviewer dashboard:");
{
  const assignments = [
    { paper_id: "P1", assignee: "R1", role: "PEER_REVIEWER", due_at: "2026-10-30T00:00:00Z" },
    { paper_id: "P2", assignee: "R1", role: "DESK_REVIEWER", due_at: "2026-11-02T00:00:00Z" },
    { paper_id: "P3", assignee: "R1", role: "EDITOR", due_at: null },
    { paper_id: "P4", assignee: "R1", role: "PEER_REVIEWER", due_at: null },
  ];
  const papers = [
    { id: "P1", title: "One", status: "UNDER_REVIEW", current_round: 0 },
    { id: "P2", title: "Two", status: "UNDER_REVIEW", current_round: 1 },
    { id: "P4", title: "Four", status: "REVISION", current_round: 0 },
  ];
  const reviews = [{ paper_id: "P2", reviewer: "R1", round: 0, status: "SUBMITTED" }]; // previous round only
  const s = summarizeReviewer({ assignments, papers, reviews, viewerId: "R1" }, NOW);
  check("EDITOR assignment not counted as a review", s.counts.assigned === 3);
  check("to-do = open papers without a current-round submitted review", s.counts.toDo === 2);
  check("previous-round review doesn't count for the new round", s.toDo.some((x) => x.paperId === "P2" && x.round === 1));
  check("overdue / due-soon computed", s.counts.overdue === 1 && s.counts.dueSoon === 1);
  check("paper awaiting author revision isn't a to-do", !s.toDo.some((x) => x.paperId === "P4"));
  check("no author fields in reviewer summary", !/submitted_by|author/i.test(blob(s)));
}

console.log("\nEditorial dashboard + people:");
{
  const papers = [
    { id: "A", status: "UNDER_REVIEW", current_round: 0 },
    { id: "B", status: "UNDER_REVIEW", current_round: 0 },
    { id: "C", status: "REVISION", current_round: 0 },
    { id: "D", status: "ACCEPTED", current_round: 1 },
  ];
  const reviews = [{ paper_id: "A", reviewer: "r1", round: 0, status: "SUBMITTED" }];
  const assignments = [
    { paper_id: "A", assignee: "r1", role: "PEER_REVIEWER", due_at: null },
    { paper_id: "B", assignee: "r2", role: "PEER_REVIEWER", due_at: "2026-10-01T00:00:00Z" },
  ];
  const s = summarizeEditorial({ papers, reviews, decisions: [], assignments }, NOW);
  check("categories", s.AWAITING_DECISION === 1 && s.AWAITING_REVIEWS === 1 && s.REVISION === 1 && s.ACCEPTED === 1);
  check("pending + overdue reviewer reports", s.pendingReports === 1 && s.overdueReviews === 1);
  const u = summarizeUsers({ profiles: [{ base_type: "STUDENT" }, { base_type: "FACULTY", is_admin: true }, { base_type: "STUDENT" }], roles: [{ role: "EDITOR" }, { role: "ADMINISTRATOR" }, { role: "PEER_REVIEWER" }, { role: "BOGUS" }] });
  check("real people counts (no hard-coded mock numbers)", u.total === 3 && u.students === 2 && u.faculty === 1 && u.admins === 1 && u.byRole.EDITOR === 1 && !("BOGUS" in u.byRole));
}

console.log("\nMock pages retired / APIs gated:");
{
  const dash = read("../app/(app)/dashboard/page.js");
  const act = read("../app/(app)/activity/page.js");
  check("dashboard no longer imports mock data", !/lib\/mock/.test(dash) && /\/api\/dashboard/.test(dash));
  check("activity no longer imports mock data", !/lib\/mock/.test(act) && /\/api\/activity/.test(act));
  for (const [f, to] of [["papers/page.js", "/submissions"], ["archive/page.js", "/publications"], ["volumes/page.js", "/publications/manage"]]) {
    const src = read(`../app/(app)/${f}`);
    check(`${f} redirects to ${to} (no mock)`, src.includes(`redirect("${to}")`) && !/lib\/mock/.test(src));
  }
  check("papers/[id] redirects to the real submission page", /redirect\(`\/submissions\/\$\{encodeURIComponent\(id\)\}`\)/.test(read("../app/(app)/papers/[id]/page.js")));
  check("import page no longer pretends to work", !/lib\/mock|ImportPanel/.test(read("../app/(app)/import/page.js")));
  const nav = read("../lib/constants.js");
  check("no nav link to a retired mock route", !/href: "\/(papers|import|archive|volumes)"/.test(nav));
  for (const f of ["../app/api/dashboard/route.js", "../app/api/activity/route.js"]) {
    const src = read(f);
    check(`${f.replace("../app/api/", "")}: requires a session (401)`, /getSessionUser\(\)/.test(src) && /status: 401/.test(src));
  }
  const dapi = read("../app/api/dashboard/route.js");
  const selects = (dapi.match(/\.select\("[^"]*"\)/g) || []).join(" ");
  check("dashboard reads released decisions only; no select of summary/confidential_note", /not\("released_at", "is", null\)/.test(dapi) && selects.length > 50 && !/confidential_note|summary/.test(selects));
  check("dashboard never queries author identity", !/paper_authors/.test(dapi));
  check("activity API never queries author identity table", !/paper_authors/.test(read("../app/api/activity/route.js")));
}

console.log(`\n${failures === 0 ? "✓ PASS — dashboard & activity are real and privacy-safe." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

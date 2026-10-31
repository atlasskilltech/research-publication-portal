/**
 * No-DB unit tests for Phase 2 access rules in lib/reviewLogic.js: who may
 * write a review, conflict-of-interest blocking, reviewer anonymity toward
 * authors (assignments + activity), the RLS allowlist staying in sync with the
 * code, and deadline/monitoring summaries.
 * Run: node scripts/test-review-access.mjs
 */
import { readFileSync } from "node:fs";
import {
  isReviewerAssignee, assignmentConflict, assignmentsForViewer, activityForViewer,
  OWNER_VISIBLE_ACTIONS, deadlineState, summarizeReviews,
} from "../lib/reviewLogic.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };

console.log("\n=== Peer-review access-rule unit tests ===\n");

console.log("Reviewer-role gate (who may write a review):");
{
  const as = [
    { assignee: "u1", role: "PEER_REVIEWER" },
    { assignee: "u2", role: "DESK_REVIEWER" },
    { assignee: "u3", role: "SPOC" },
    { assignee: "u4", role: "EDITOR" },
  ];
  check("PEER_REVIEWER assignee may review", isReviewerAssignee(as, "u1") === true);
  check("DESK_REVIEWER assignee may review", isReviewerAssignee(as, "u2") === true);
  check("SPOC assignee may NOT review", isReviewerAssignee(as, "u3") === false);
  check("EDITOR assignee may NOT review", isReviewerAssignee(as, "u4") === false);
  check("unassigned user may NOT review", isReviewerAssignee(as, "zz") === false);
  check("null assignments → false", isReviewerAssignee(null, "u1") === false);
}

console.log("\nConflict of interest:");
{
  const paper = { submittedBy: "owner", authorEmails: ["Co.Author@Atlas.edu", "x@y.z"] };
  check("submitter blocked", assignmentConflict(paper, { id: "owner", email: "o@a.b" }) !== null);
  check("co-author blocked (case-insensitive email)", assignmentConflict(paper, { id: "r1", email: " co.author@atlas.edu " }) !== null);
  check("unrelated reviewer allowed", assignmentConflict(paper, { id: "r2", email: "rev@atlas.edu" }) === null);
  check("blank emails don't false-match", assignmentConflict({ submittedBy: "o", authorEmails: [""] }, { id: "r", email: "" }) === null);
}

console.log("\nReviewer anonymity toward authors:");
{
  const as = [
    { assignee: "rev-1", role: "PEER_REVIEWER", due_at: "2026-11-10T00:00:00Z" },
    { assignee: "rev-2", role: "PEER_REVIEWER", due_at: null },
  ];
  const owner = assignmentsForViewer(as, "owner", "owner-id");
  check("owner sees roles", owner.length === 2 && owner.every((a) => a.role));
  check("owner NEVER sees assignee ids", owner.every((a) => !("assignee" in a)));
  const rev = assignmentsForViewer(as, "reviewer", "rev-1");
  check("reviewer sees only own assignment", rev.length === 1 && rev[0].assignee === "rev-1");
  check("admin sees all, with ids + deadline", assignmentsForViewer(as, "admin", "a").every((a) => a.assignee && "dueAt" in a));

  const act = [
    { action: "SUBMITTED", actor: "owner-id", detail: { authors: 2 }, created_at: "t1" },
    { action: "ASSIGNED", actor: "admin", detail: { assignee: "rev-1", role: "PEER_REVIEWER" }, created_at: "t2" },
    { action: "REVIEW_STARTED", actor: "rev-1", detail: {}, created_at: "t3" },
    { action: "REVIEW_SUBMITTED", actor: "rev-1", detail: { recommendation: "REJECT" }, created_at: "t4" },
    { action: "MANUSCRIPT_DOWNLOADED", actor: "rev-1", detail: {}, created_at: "t5" },
    { action: "UNASSIGNED", actor: "admin", detail: { assignee: "rev-2" }, created_at: "t6" },
  ];
  const ownerAct = activityForViewer(act, "owner");
  check("owner activity limited to allowlist", ownerAct.length === 1 && ownerAct.every((a) => OWNER_VISIBLE_ACTIONS.includes(a.action)));
  check("owner activity has no actor/detail", ownerAct.every((a) => !("actor" in a) && !("detail" in a)));
  check("owner never sees reviewer ids or a recommendation", !/rev-1|rev-2|REJECT/.test(JSON.stringify(ownerAct)));
  check("admin sees full activity", activityForViewer(act, "admin").length === act.length);
  check("reviewer sees no activity", activityForViewer(act, "reviewer").length === 0);

  // The DB policy (0006) must allow owners exactly the same actions as the code.
  const sql = readFileSync(new URL("../supabase/migrations/0006_reviews.sql", import.meta.url), "utf8");
  const m = sql.match(/action in \(([^)]*)\)/);
  const sqlList = m ? m[1].split(",").map((x) => x.trim().replace(/'/g, "")).sort() : [];
  check("0006 RLS activity allowlist matches OWNER_VISIBLE_ACTIONS",
    JSON.stringify(sqlList) === JSON.stringify([...OWNER_VISIBLE_ACTIONS].sort()), sqlList.join(",") || "not found");
  check("0006 reviews RLS has no author/owner branch", /create policy reviews_select[\s\S]*?reviewer = auth\.uid\(\) or public\.current_user_is_admin\(\)\s*\);/.test(sql));
}

console.log("\nDeadlines & monitoring summary:");
{
  const now = new Date("2026-11-01T12:00:00Z");
  check("submitted → done (even if past due)", deadlineState("2026-10-01T00:00:00Z", "SUBMITTED", now) === "done");
  check("no deadline → none", deadlineState(null, "PENDING", now) === "none");
  check("past due & not submitted → overdue", deadlineState("2026-10-31T00:00:00Z", "DRAFT", now) === "overdue");
  check("within 3 days → due_soon", deadlineState("2026-11-03T00:00:00Z", "PENDING", now) === "due_soon");
  check("far away → on_track", deadlineState("2026-12-01T00:00:00Z", "PENDING", now) === "on_track");
  check("garbage date → none", deadlineState("not-a-date", "PENDING", now) === "none");
  const sum = summarizeReviews([
    { reviewStatus: "PENDING", deadline: "overdue" },
    { reviewStatus: "DRAFT", deadline: "due_soon" },
    { reviewStatus: "SUBMITTED", deadline: "done" },
    { reviewStatus: "SUBMITTED", deadline: "done" },
  ]);
  check("summary counts", sum.assigned === 4 && sum.pending === 1 && sum.draft === 1 && sum.submitted === 2 && sum.overdue === 1, JSON.stringify(sum));
  check("empty summary is zeros", JSON.stringify(summarizeReviews([])) === JSON.stringify({ assigned: 0, pending: 0, draft: 0, submitted: 0, overdue: 0 }));
}

console.log(`\n${failures === 0 ? "✓ PASS — access rules hold." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

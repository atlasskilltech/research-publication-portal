/**
 * No-DB unit tests for Phase 3 (lib/revisionLogic.js + static checks of
 * supabase/migrations/0007_revisions.sql): eligibility, state transitions,
 * numbering, ownership, manuscript-version access, response validation,
 * confidential separation, concurrency guards and version preservation.
 *
 * The SQL checks are STATIC (they read the migration text); they do not run
 * the functions against a database. Run: node scripts/test-revision-logic.mjs
 */
import { readFileSync } from "node:fs";
import {
  RS, canTransition, displayStatus, nextRevisionRound, latestRevision, releasedRound,
  isPaperOwner, canManageRevisions, canRequestRevision, canAuthorEdit, validateRevisionRequest,
  permittedVersions, defaultVersion, reviewLabels, validateResponses, responsesForAuthor,
  responsesForReviewer, reviewsForAuthor, revisionForAuthor, revisionForManager, mapRpcError,
} from "../lib/revisionLogic.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const sql = readFileSync(new URL("../supabase/migrations/0007_revisions.sql", import.meta.url), "utf8");
const fnBody = (name) => {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`));
  return m ? m[1] : "";
};

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const NOW = new Date("2026-11-01T12:00:00Z");

console.log("\n=== Phase 3 revision logic unit tests ===\n");

console.log("Migration parse guard:");
check("every 0007 state function body was found (no vacuous SQL checks)",
  ["request_paper_revision", "_rpp_lock_editable", "_rpp_mark_started", "attach_revision_manuscript", "save_revision_draft",
    "submit_paper_revision", "start_revision_rereview", "_rpp_is_manager"].every((f) => fnBody(f).length > 100));

console.log("Status transitions:");
check("manager: none → REQUESTED", canTransition(null, RS.REQUESTED, "manager"));
check("author cannot create a request", !canTransition(null, RS.REQUESTED, "author"));
check("author: REQUESTED → IN_PROGRESS", canTransition(RS.REQUESTED, RS.IN_PROGRESS, "author"));
check("author: IN_PROGRESS → SUBMITTED", canTransition(RS.IN_PROGRESS, RS.SUBMITTED, "author"));
check("manager cannot submit for the author", !canTransition(RS.IN_PROGRESS, RS.SUBMITTED, "manager"));
check("SUBMITTED → SUBMITTED rejected (no double submit)", !canTransition(RS.SUBMITTED, RS.SUBMITTED, "author"));
check("author cannot go back SUBMITTED → IN_PROGRESS", !canTransition(RS.SUBMITTED, RS.IN_PROGRESS, "author"));
check("manager: SUBMITTED → UNDER_REVIEW", canTransition(RS.SUBMITTED, RS.UNDER_REVIEW, "manager"));
check("author cannot release for re-review", !canTransition(RS.SUBMITTED, RS.UNDER_REVIEW, "author"));
check("manager cannot skip REQUESTED → UNDER_REVIEW", !canTransition(RS.REQUESTED, RS.UNDER_REVIEW, "manager"));
check("UNDER_REVIEW is terminal for this phase", !canTransition(RS.UNDER_REVIEW, RS.IN_PROGRESS, "author") && !canTransition(RS.UNDER_REVIEW, RS.REQUESTED, "manager"));
check("OVERDUE is never a stored target", !canTransition(RS.REQUESTED, RS.OVERDUE, "author") && !canTransition(RS.REQUESTED, RS.OVERDUE, "manager"));
check("unknown status → no transitions", !canTransition("HACKED", RS.SUBMITTED, "author"));

console.log("\nOverdue (derived):");
check("past due + REQUESTED → OVERDUE", displayStatus({ status: RS.REQUESTED, due_at: "2026-10-30T00:00:00Z" }, NOW) === RS.OVERDUE);
check("past due + IN_PROGRESS → OVERDUE", displayStatus({ status: RS.IN_PROGRESS, due_at: "2026-10-30T00:00:00Z" }, NOW) === RS.OVERDUE);
check("past due but SUBMITTED → stays SUBMITTED", displayStatus({ status: RS.SUBMITTED, due_at: "2026-10-30T00:00:00Z" }, NOW) === RS.SUBMITTED);
check("future due → stored status", displayStatus({ status: RS.REQUESTED, due_at: "2026-12-01T00:00:00Z" }, NOW) === RS.REQUESTED);
check("no deadline → never overdue", displayStatus({ status: RS.REQUESTED, due_at: null }, NOW) === RS.REQUESTED);

console.log("\nRevision numbering:");
check("original paper → revision 1", nextRevisionRound({ current_round: 0 }) === 1);
check("after revision 2 → revision 3", nextRevisionRound({ current_round: 2 }) === 3);
check("missing/garbage round treated as 0", nextRevisionRound({}) === 1 && nextRevisionRound({ current_round: -4 }) === 1);
check("latestRevision picks highest round", latestRevision([{ round: 1 }, { round: 3 }, { round: 2 }]).round === 3);
check("releasedRound = highest UNDER_REVIEW", releasedRound([{ round: 1, status: RS.UNDER_REVIEW }, { round: 2, status: RS.SUBMITTED }]) === 1);
check("releasedRound = 0 when nothing released", releasedRound([{ round: 1, status: RS.SUBMITTED }]) === 0);
check("SQL request uses current_round + 1", /v_paper\.current_round \+ 1/.test(fnBody("request_paper_revision")));
check("SQL unique (paper_id, round)", /unique \(paper_id, round\)/.test(sql));

console.log("\nOwnership & management rights:");
const paper = { id: "p", submitted_by: "author-1", status: "UNDER_REVIEW", current_round: 0 };
check("submitter is owner", isPaperOwner(paper, "author-1"));
check("co-author/other user is not owner", !isPaperOwner(paper, "author-2"));
check("missing user is not owner", !isPaperOwner(paper, null));
check("admin manages revisions", canManageRevisions({ id: "a", isAdmin: true }, []));
check("paper EDITOR manages revisions", canManageRevisions({ id: "e" }, [{ assignee: "e", role: "EDITOR" }]));
check("PEER_REVIEWER does not manage revisions", !canManageRevisions({ id: "r" }, [{ assignee: "r", role: "PEER_REVIEWER" }]));
check("editor of ANOTHER assignment row doesn't count", !canManageRevisions({ id: "x" }, [{ assignee: "e", role: "EDITOR" }]));
{
  const rev = { round: 1, status: RS.IN_PROGRESS };
  check("owner may edit an IN_PROGRESS revision", canAuthorEdit({ paper, revision: rev, userId: "author-1" }).ok);
  check("non-owner gets 404 (existence hidden)", canAuthorEdit({ paper, revision: rev, userId: "intruder" }).status === 404);
  check("owner cannot edit a SUBMITTED revision (409)", canAuthorEdit({ paper, revision: { round: 1, status: RS.SUBMITTED }, userId: "author-1" }).status === 409);
  check("no revision requested → 404", canAuthorEdit({ paper, revision: null, userId: "author-1" }).status === 404);
}
check("SQL author functions check submitted_by = p_actor", /submitted_by = p_actor/.test(fnBody("_rpp_lock_editable")));
check("SQL manager check: is_admin or paper EDITOR", /is_admin[\s\S]*role = 'EDITOR'/.test(fnBody("_rpp_is_manager")));

console.log("\nRevision eligibility:");
const reviews = [
  { id: U(1), status: "SUBMITTED", round: 0 },
  { id: U(2), status: "DRAFT", round: 0 },
  { id: U(3), status: "SUBMITTED", round: 1 },
];
check("eligible with a submitted current-round review", canRequestRevision({ paper, revisions: [], reviews, reviewIds: [U(1)] }).ok);
check("returns next round number", canRequestRevision({ paper, revisions: [], reviews, reviewIds: [U(1)] }).round === 1);
check("not under review → rejected", !canRequestRevision({ paper: { ...paper, status: "SUBMITTED" }, revisions: [], reviews, reviewIds: [U(1)] }).ok);
check("paper in REVISION → rejected", !canRequestRevision({ paper: { ...paper, status: "REVISION" }, revisions: [], reviews, reviewIds: [U(1)] }).ok);
check("open revision → rejected (409)", canRequestRevision({ paper, revisions: [{ round: 1, status: RS.IN_PROGRESS }], reviews, reviewIds: [U(1)] }).status === 409);
check("no reviews selected → rejected", !canRequestRevision({ paper, revisions: [], reviews, reviewIds: [] }).ok);
check("DRAFT review cannot be shared", !canRequestRevision({ paper, revisions: [], reviews, reviewIds: [U(2)] }).ok);
check("other-round review cannot be shared", !canRequestRevision({ paper, revisions: [], reviews, reviewIds: [U(3)] }).ok);
check("unknown review id cannot be shared", !canRequestRevision({ paper, revisions: [], reviews, reviewIds: [U(9)] }).ok);
check("released revision doesn't block a new request", canRequestRevision({ paper: { ...paper, current_round: 1 }, revisions: [{ round: 1, status: RS.UNDER_REVIEW }], reviews, reviewIds: [U(3)] }).ok);
check("a reviewer recommendation alone never creates a request (no auto path)", !/recommendation/.test(fnBody("request_paper_revision")));

console.log("\nRevision request validation:");
const goodReq = { type: "minor", instructions: "Address R1.", dueAt: "2026-12-01", reviewIds: [U(1)] };
check("valid request accepted (type normalized)", validateRevisionRequest(goodReq, NOW).ok && validateRevisionRequest(goodReq, NOW).value.type === "MINOR");
check("bad type rejected", !validateRevisionRequest({ ...goodReq, type: "ACCEPT" }, NOW).ok);
check("empty instructions rejected", !validateRevisionRequest({ ...goodReq, instructions: "  " }, NOW).ok);
check("past deadline rejected", !validateRevisionRequest({ ...goodReq, dueAt: "2026-10-01" }, NOW).ok);
check("non-uuid review id rejected", !validateRevisionRequest({ ...goodReq, reviewIds: ["1 OR 1=1"] }, NOW).ok);
check("no deadline is allowed", validateRevisionRequest({ ...goodReq, dueAt: "" }, NOW).ok);

console.log("\nReviewer access to manuscript versions:");
const versions = [{ version: 0 }, { version: 1 }, { version: 2 }];
check("owner sees every version", permittedVersions("owner", versions, 0).length === 3);
check("admin sees every version", permittedVersions("admin", versions, 0).length === 3);
check("reviewer before any release: original only", JSON.stringify(permittedVersions("assigned", versions, 0).map((v) => v.version)) === "[0]");
check("reviewer after revision 1 released: v0,v1 (not unreleased v2)", JSON.stringify(permittedVersions("assigned", versions, 1).map((v) => v.version)) === "[0,1]");
check("stranger sees nothing", permittedVersions("none", versions, 2).length === 0);
check("default = latest permitted (reviewer gets v1, not v2)", defaultVersion(permittedVersions("assigned", versions, 1)).version === 1);
check("default with nothing permitted = null", defaultVersion([]) === null);
check("SQL RLS limits assigned users to released versions", /current_user_assigned\(paper_id\) and version <= public\.paper_released_round\(paper_id\)/.test(sql));

console.log("\nPoint-by-point response validation:");
const ids = [U(1), U(4)];
const full = [
  { reviewKey: "R1", comment: "Clarify method", response: "Done in §3", addressed: true },
  { reviewKey: "R2", comment: "More data", response: "Added Table 4" },
];
check("labels are anonymous and ordered", reviewLabels(ids).byId.get(U(4)).label === "Reviewer 2");
check("valid final accepted", validateResponses(full, { final: true, reviewIds: ids }).ok);
check("keys mapped to review ids server-side", validateResponses(full, { final: true, reviewIds: ids }).value[1].review_id === U(4));
check("addressed defaults to false", validateResponses(full, { final: true, reviewIds: ids }).value[1].addressed === false);
check("draft may be empty", validateResponses([], { final: false, reviewIds: ids }).ok);
check("draft may have blank responses", validateResponses([{ reviewKey: "R1", comment: "", response: "" }], { reviewIds: ids }).ok);
check("final with no entries rejected", !validateResponses([], { final: true, reviewIds: ids }).ok);
check("final with a blank response rejected", !validateResponses([{ ...full[0], response: "" }, full[1]], { final: true, reviewIds: ids }).ok);
check("final must cover every shared reviewer", !validateResponses([full[0]], { final: true, reviewIds: ids }).ok);
check("unknown reviewer key rejected", !validateResponses([{ reviewKey: "R7", comment: "x", response: "y" }], { reviewIds: ids }).ok);
check("raw review id as key rejected (no id guessing)", !validateResponses([{ reviewKey: U(1), comment: "x", response: "y" }], { reviewIds: ids }).ok);
check("general entry (no key) allowed", validateResponses([{ reviewKey: "", comment: "Overall", response: "Thanks" }, ...full], { final: true, reviewIds: ids }).ok);
check("over-long response rejected", !validateResponses([{ reviewKey: "R1", comment: "c", response: "x".repeat(10001) }], { reviewIds: ids }).ok);
check("more than 100 entries rejected", !validateResponses(Array.from({ length: 101 }, () => ({ comment: "c", response: "r" })), { reviewIds: ids }).ok);

console.log("\nConfidential separation & anonymity:");
const storedReviews = [
  { id: U(1), reviewer: "rev-A", status: "SUBMITTED", comments_to_author: "Please clarify.", confidential_to_editor: "SECRET-A", recommendation: "MAJOR_REVISION", technical_quality: 2 },
  { id: U(4), reviewer: "rev-B", status: "SUBMITTED", comments_to_author: "More data.", confidential_to_editor: "SECRET-B", recommendation: "REJECT" },
  { id: U(5), reviewer: "rev-C", status: "SUBMITTED", comments_to_author: "Not shared.", confidential_to_editor: "SECRET-C" },
];
{
  const forAuthor = reviewsForAuthor(storedReviews, ids);
  const blob = JSON.stringify(forAuthor);
  check("author sees only shared reviews", forAuthor.length === 2 && !blob.includes("Not shared."));
  check("author never sees confidential comments", !/SECRET/.test(blob));
  check("author never sees reviewer identity or ids", !/rev-A|rev-B|00000000-/.test(blob));
  check("author never sees recommendation/scores", !/MAJOR_REVISION|REJECT|technical_quality/.test(blob));
  check("author sees comments_to_author", forAuthor[0].commentsToAuthor === "Please clarify.");
  check("unsubmitted review never reaches author", reviewsForAuthor([{ ...storedReviews[0], status: "DRAFT" }], [U(1)]).length === 0);

  const stored = validateResponses([...full, { reviewKey: "", comment: "Overall", response: "General note" }], { final: true, reviewIds: ids }).value;
  const authorResp = responsesForAuthor(stored, ids);
  check("author's own responses come back with anonymous keys", authorResp[0].reviewKey === "R1" && !JSON.stringify(authorResp).includes("00000000-"));

  const forA = responsesForReviewer(stored, U(1));
  check("reviewer A sees responses to A + general only", forA.length === 2 && forA.some((e) => e.general) && !JSON.stringify(forA).includes("Added Table 4"));
  check("reviewer response view has no review ids", !JSON.stringify(forA).includes("00000000-"));
  check("reviewer with no shared review sees only general", responsesForReviewer(stored, U(5)).every((e) => e.general));

  const rev = { round: 1, revision_type: "MAJOR", instructions: "Fix", due_at: null, status: RS.IN_PROGRESS, review_ids: ids, responses: stored, requested_by: "admin-1", requested_at: "t" };
  const a = revisionForAuthor(rev, storedReviews, null, NOW);
  check("author revision view omits requester identity", !("requestedBy" in a) && !JSON.stringify(a).includes("admin-1"));
  check("author revision view has no confidential text", !/SECRET/.test(JSON.stringify(a)));
  const m = revisionForManager(rev, new Map([[U(1), "Dr A"]]), null, NOW);
  check("manager view names the reviewer behind each response", m.responses[0].reviewer === "Dr A");
  check("SQL: reviews RLS has no author branch", /create policy reviews_select[\s\S]*?\(\s*reviewer = auth\.uid\(\) or public\.current_user_is_admin\(\) or public\.current_user_is_paper_editor\(paper_id\)\s*\);/.test(sql));
}

console.log("\nConcurrency protection (static SQL checks + guards):");
for (const fn of ["request_paper_revision", "start_revision_rereview", "_rpp_lock_editable"]) {
  check(`${fn} locks its row FOR UPDATE`, /for update/.test(fnBody(fn)));
}
check("submit/draft/attach go through the locking helper", ["submit_paper_revision", "save_revision_draft", "attach_revision_manuscript"].every((f) => /_rpp_lock_editable/.test(fnBody(f))));
check("locked helper rejects already-submitted revisions", /ALREADY_SUBMITTED/.test(fnBody("_rpp_lock_editable")));
check("partial unique index: one open revision per paper", /paper_revisions_one_open[\s\S]*where status in \('REVISION_REQUESTED','REVISION_IN_PROGRESS','REVISION_SUBMITTED'\)/.test(sql));
check("re-review requires SUBMITTED", /NOT_SUBMITTED/.test(fnBody("start_revision_rereview")));
check("state functions not callable by anon/authenticated", ["request_paper_revision", "submit_paper_revision", "save_revision_draft", "attach_revision_manuscript", "start_revision_rereview"].every((f) => new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`).test(sql)));
check("ALREADY_SUBMITTED maps to HTTP 409", mapRpcError({ message: "RPP:ALREADY_SUBMITTED" }).status === 409);
check("unique violation maps to 409", mapRpcError({ code: "23505", message: "duplicate key" }).status === 409);
check("unknown DB errors are not mapped (→ generic 500)", mapRpcError({ message: "connection reset" }) === null);
check("re-review rounds don't overwrite: unique (paper, reviewer, round)", /reviews_paper_reviewer_round_uidx[\s\S]*\(paper_id, reviewer, round\)/.test(sql));

console.log("\nPrevious manuscript version preservation:");
const attach = fnBody("attach_revision_manuscript");
check("attach writes only version = p_round", /version = p_round/.test(attach) && !/version = 0/.test(attach));
check("revision rounds are >= 1 (original v0 unreachable)", /round\s+int\s+not null check \(round >= 1\)/.test(sql));
check("attach is limited to editable (unsubmitted) revisions", /_rpp_lock_editable/.test(attach));
check("one row per (paper, version)", /paper_manuscripts_paper_version_uidx[\s\S]*\(paper_id, version\)/.test(sql));
check("no DELETE of paper_manuscripts anywhere in 0007", !/delete\s+from\s+public\.paper_manuscripts/i.test(sql));
check("submit requires this round's manuscript", /NO_MANUSCRIPT/.test(fnBody("submit_paper_revision")));

console.log(`\n${failures === 0 ? "✓ PASS — revision logic is sound." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

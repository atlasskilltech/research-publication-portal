/**
 * No-DB unit tests for Phase 4 editorial decisions (lib/decisionLogic.js) plus
 * STATIC checks of the MySQL workflow service (lib/services/workflow.mjs),
 * the schema migration (database/migrations/002_workflow.mjs) and the route
 * sources. Sources are read as text — nothing is executed against a database
 * here (scripts/test-mysql-integration.mjs runs them against MySQL).
 * Run: node scripts/test-decision-logic.mjs
 */
import { readFileSync } from "node:fs";
import {
  DECISIONS, DECISION_EFFECT, canDecide, validateDecision, decisionEligibility, canRelease, isEditable,
  nextActionFor, decisionForAuthor, decisionForManager, editorialCategory,
} from "../lib/decisionLogic.js";
import { canRequestRevision, canAuthorEdit, mapRpcError, RS } from "../lib/revisionLogic.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const wf = read("../lib/services/workflow.mjs");
const ddl = read("../database/migrations/002_workflow.mjs");
/** Body of a top-level function in workflow.mjs (from its declaration to the closing "\n}\n"). */
const fnBody = (name) => {
  const i = wf.search(new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${name}\\(`));
  if (i < 0) return "";
  const end = wf.indexOf("\n}\n", i + 1);
  return end < 0 ? "" : wf.slice(i, end + 2);
};
const save = fnBody("saveEditorialDecision");
const release = fnBody("releaseEditorialDecision");
const lockPaperBody = fnBody("lockPaper");
const isManagerBody = fnBody("isManager");

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const NOW = new Date("2026-11-01T12:00:00Z");
const paper = { id: "p", submitted_by: "author", status: "UNDER_REVIEW", current_round: 0 };
const reviews = [
  { id: U(1), round: 0, status: "SUBMITTED" },
  { id: U(2), round: 0, status: "DRAFT" },
  { id: U(3), round: 1, status: "SUBMITTED" },
];

console.log("\n=== Phase 4 editorial decision unit tests ===\n");

console.log("Source parse guard:");
check("save/release function bodies found (no vacuous checks)", save.length > 500 && release.length > 500 && lockPaperBody.length > 0 && isManagerBody.length > 0);

console.log("\nDecision authorization:");
check("admin may decide", canDecide({ id: "a", isAdmin: true }, []));
check("paper EDITOR may decide", canDecide({ id: "e" }, [{ assignee: "e", role: "EDITOR" }]));
check("PEER_REVIEWER may NOT decide", !canDecide({ id: "r" }, [{ assignee: "r", role: "PEER_REVIEWER" }]));
check("DESK_REVIEWER may NOT decide", !canDecide({ id: "r" }, [{ assignee: "r", role: "DESK_REVIEWER" }]));
check("SPOC may NOT decide", !canDecide({ id: "s" }, [{ assignee: "s", role: "SPOC" }]));
check("author may NOT decide", !canDecide({ id: "author" }, []));
check("editor of a different paper may NOT decide", !canDecide({ id: "e2" }, [{ assignee: "e", role: "EDITOR" }]));
check("service save re-checks manager", /isManager\(tx, paperId, actorId\)/.test(save) && /fail\("FORBIDDEN"\)/.test(save));
check("service release re-checks manager", /isManager\(tx, paperId, actorId\)/.test(release) && /fail\("FORBIDDEN"\)/.test(release));
check("manager = administrator or the paper's EDITOR", /isAdmin/.test(isManagerBody) && /role = 'EDITOR'/.test(isManagerBody));
// (Postgres REVOKE … FROM anon/authenticated has no MySQL counterpart: the database is
// never exposed to browsers. Equivalent guard: the service is only imported server-side.)
{
  const { readdirSync, statSync } = await import("node:fs");
  const walk = (dir) => readdirSync(new URL(dir, import.meta.url)).flatMap((f) => {
    const rel = `${dir}${f}`;
    return statSync(new URL(rel, import.meta.url)).isDirectory() ? walk(`${rel}/`) : /\.(js|jsx|mjs)$/.test(f) ? [rel] : [];
  });
  const files = [...walk("../app/"), ...walk("../components/")];
  const leaks = files.filter((f) => { const s = read(f); return /^\s*["']use client["']/.test(s) && /lib\/services|@\/lib\/db|decisionService/.test(s); });
  check("workflow service / db never imported by a 'use client' module", leaks.length === 0, leaks.join(", "));
}
{
  const decRoute = read("../app/api/papers/[id]/decisions/route.js");
  check("decisions reach authors only via decisionForAuthor (confidential note stripped)", /decisionForAuthor/.test(decRoute) && /decisionForManager/.test(decRoute));
  const a = decisionForAuthor({ id: "d", round: 0, decision: "ACCEPT", summary: "s", confidential_note: "secret", released_at: "t", decided_by: "e" });
  check("decisionForAuthor drops confidential_note + decided_by", a && !JSON.stringify(a).includes("secret") && !("decided_by" in a));
}

console.log("\nReviewer recommendations never become decisions:");
check("no code path reads review.recommendation when saving", !/recommendation/.test(save) && !/recommendation/.test(release));
check("decision value comes only from the manager's input", /\{ paperId, actorId, decision, summary, note, reviewIds, dueAt \}/.test(save));

console.log("\nValidation:");
const good = { decision: "accept", summary: "Well done.", reviewIds: [] };
check("ACCEPT with summary, no released reviews → OK", validateDecision(good, NOW).ok && validateDecision(good, NOW).value.decision === "ACCEPT");
check("summary required", !validateDecision({ ...good, summary: "  " }, NOW).ok);
check("summary length capped", !validateDecision({ ...good, summary: "x".repeat(10001) }, NOW).ok);
check("unknown decision rejected", !validateDecision({ ...good, decision: "PUBLISH" }, NOW).ok);
check("revision decision needs released reviews", !validateDecision({ decision: "MINOR_REVISION", summary: "x", reviewIds: [] }, NOW).ok);
check("revision decision with reviews OK", validateDecision({ decision: "MAJOR_REVISION", summary: "x", reviewIds: [U(1)], dueAt: "2026-12-01" }, NOW).ok);
check("revision deadline must be future", !validateDecision({ decision: "MAJOR_REVISION", summary: "x", reviewIds: [U(1)], dueAt: "2026-10-01" }, NOW).ok);
check("deadline ignored for ACCEPT", validateDecision({ ...good, dueAt: "2026-10-01" }, NOW).value?.dueAt === null);
check("non-uuid review ids rejected", !validateDecision({ ...good, reviewIds: ["x';--"] }, NOW).ok);
check("all four decisions supported", JSON.stringify(DECISIONS) === JSON.stringify(["ACCEPT", "MINOR_REVISION", "MAJOR_REVISION", "REJECT"]));

console.log("\nValid state transitions / eligibility:");
const elig = (over = {}) => decisionEligibility({ paper, reviews, decisions: [], revisions: [], reviewIds: [U(1)], decision: "ACCEPT", ...over });
check("UNDER_REVIEW + submitted review → eligible", elig().ok);
for (const st of ["SUBMITTED", "REVISION", "ACCEPTED", "REJECTED", "PUBLISHED"]) {
  check(`paper ${st} → not eligible`, !elig({ paper: { ...paper, status: st } }).ok);
}
check("no submitted review this round → not eligible", !elig({ reviews: [reviews[1]], reviewIds: [] }).ok);
check("open revision → not eligible", !elig({ revisions: [{ round: 1, status: RS.IN_PROGRESS }] }).ok);
check("already communicated this round → 409", elig({ decisions: [{ round: 0, released_at: "t" }] }).status === 409);
check("unreleased draft this round → still eligible (it gets updated)", elig({ decisions: [{ round: 0, released_at: null }] }).ok);
check("DRAFT review cannot be released", !elig({ reviewIds: [U(2)] }).ok);
check("other-round review cannot be released", !elig({ reviewIds: [U(3)] }).ok);
check("round 1 decision after re-review uses round-1 reviews", elig({ paper: { ...paper, current_round: 1 }, decisions: [{ round: 0, released_at: "t" }], reviewIds: [U(3)] }).ok);
check("service save requires UNDER_REVIEW + submitted review", /NOT_UNDER_REVIEW/.test(save) && /NO_SUBMITTED_REVIEWS/.test(save));
check("service release requires UNDER_REVIEW and the current round", /paper\.status !== "UNDER_REVIEW" \|\| dec\.round !== paper\.current_round/.test(release));
check("effects: ACCEPT→ACCEPTED, REJECT→REJECTED, revisions→REVISION",
  DECISION_EFFECT.ACCEPT.paperStatus === "ACCEPTED" && DECISION_EFFECT.REJECT.paperStatus === "REJECTED" &&
  DECISION_EFFECT.MINOR_REVISION.paperStatus === "REVISION" && DECISION_EFFECT.MAJOR_REVISION.revisionType === "MAJOR");
check("service ACCEPT sets ACCEPTED", /dec\.decision === "ACCEPT"\) \{\s+await tx\.exec\(`UPDATE \\`\$\{T\.papers\}\\` SET status = 'ACCEPTED'/.test(release));
check("service REJECT sets REJECTED", /dec\.decision === "REJECT"\) \{\s+await tx\.exec\(`UPDATE \\`\$\{T\.papers\}\\` SET status = 'REJECTED'/.test(release));

console.log("\nDecision history preservation:");
const decDdl = ddl.slice(ddl.indexOf("T.editorialDecisions, `"), ddl.indexOf("`);", ddl.indexOf("T.editorialDecisions, `")));
check("one decision per (paper, round)", /UNIQUE KEY \\`research_editorial_decisions_round_uq\\` \(\\`paper_id\\`, \\`round\\`\)/.test(decDdl));
const decUpdates = wf.match(/UPDATE \\`\$\{T\.editorialDecisions\}\\`[\s\S]*?`/g) || [];
check("every decision UPDATE is guarded by released_at IS NULL (immutability)", decUpdates.length >= 2 && decUpdates.every((u) => /released_at IS NULL/.test(u)), `${decUpdates.length} updates`);
check("a guarded UPDATE that hits a communicated decision raises DECISION_FINAL / DECISION_EXISTS",
  /affectedRows !== 1\) throw fail\("DECISION_FINAL"\)/.test(save) && /affectedRows !== 1\) throw fail\("DECISION_EXISTS"\)/.test(release));
check("save refuses to touch a communicated decision", /if \(existing\.released_at\) throw fail\("DECISION_EXISTS"\)/.test(save));
check("no DELETE of decisions anywhere in the service", !/DELETE\s+FROM\s+\\`\$\{T\.editorialDecisions\}/i.test(wf));
check("isEditable: draft yes, communicated no", isEditable({ released_at: null }) && !isEditable({ released_at: "t" }));
check("draft edits are logged (DECISION_UPDATED with version)", /"DECISION_UPDATED", \{[^}]*version/.test(save));
check("communication logged (DECISION_COMMUNICATED)", /"DECISION_COMMUNICATED"/.test(release));
check("decision maker + timestamp recorded", /decided_by = \?/.test(save) && /released_at = UTC_TIMESTAMP\(3\), released_by = \?/.test(release));

console.log("\nRevision integration (reuses Phase 3, no duplicates):");
check("release calls requestRevisionTx for MINOR/MAJOR (same transaction)", /requestRevisionTx\(tx, \{/.test(release));
check("maps MINOR_REVISION→'MINOR', else 'MAJOR'", /dec\.decision === "MINOR_REVISION" \? "MINOR" : "MAJOR"/.test(release));
check("decision functions never insert paper_revisions directly", !/INSERT INTO \\`\$\{T\.paperRevisions\}/.test(save + release));
check("decision links the created revision (revision_id)", /revision_id = \?/.test(release) && /\[actorId, revisionId, dec\.id\]/.test(release));
check("decision summary becomes the revision instructions", /instructions: dec\.summary, dueAt: dec\.revision_due_at, reviewIds: dec\.review_ids/.test(release));
{
  const wrapper = read("../app/api/papers/[id]/revisions/route.js");
  check("Phase 3 POST /revisions now goes through the decision service", /saveDecision\(/.test(wrapper) && /releaseDecision\(/.test(wrapper));
  check("…and no longer calls request_paper_revision directly", !/rpc\("request_paper_revision"/.test(wrapper));
}

console.log("\nAccept / reject restrictions:");
check("Phase 3: no revision request on an ACCEPTED paper", !canRequestRevision({ paper: { ...paper, status: "ACCEPTED" }, revisions: [], reviews, reviewIds: [U(1)] }).ok);
check("Phase 3: no revision request on a REJECTED paper", !canRequestRevision({ paper: { ...paper, status: "REJECTED" }, revisions: [], reviews, reviewIds: [U(1)] }).ok);
check("no new decision on ACCEPTED/REJECTED", !elig({ paper: { ...paper, status: "ACCEPTED" } }).ok && !elig({ paper: { ...paper, status: "REJECTED" } }).ok);
check("author can't edit a non-open revision after a reject", !canAuthorEdit({ paper: { ...paper, status: "REJECTED" }, revision: { round: 1, status: RS.UNDER_REVIEW }, userId: "author" }).ok);
check("reject next action says no further action", /No further action/.test(nextActionFor("REJECT")));
check("accept next action mentions publication", /publication/.test(nextActionFor("ACCEPT")));
{
  const reviewRoute = read("../app/api/papers/[id]/review/route.js");
  check("reviews only writable while UNDER_REVIEW (closed after accept/reject)", /status !== "UNDER_REVIEW"/.test(reviewRoute));
}

console.log("\nConcurrent decision protection:");
check("paper lock helper uses SELECT … FOR UPDATE", /FROM \\`\$\{T\.papers\}\\` WHERE id = \? FOR UPDATE/.test(lockPaperBody));
check("save locks the paper row FOR UPDATE", /await lockPaper\(tx, paperId\)/.test(save));
check("save locks the existing decision FOR UPDATE", /FROM \\`\$\{T\.editorialDecisions\}\\` WHERE paper_id = \? AND round = \? FOR UPDATE/.test(save));
check("release locks paper + decision FOR UPDATE", /await lockPaper\(tx, paperId\)/.test(release) && /FROM \\`\$\{T\.editorialDecisions\}\\` WHERE id = \? AND paper_id = \? FOR UPDATE/.test(release));
check("each draft save bumps version", /version = version \+ 1/.test(save));
check("release requires the expected version (STALE otherwise)", /dec\.version !== Number\(expectedVersion\)\) throw fail\("STALE"\)/.test(release));
check("canRelease: stale version → 409", canRelease({ paper, decision: { round: 0, version: 3, released_at: null }, expectedVersion: 2 }).status === 409);
check("canRelease: double release → 409", canRelease({ paper, decision: { round: 0, version: 1, released_at: "t" }, expectedVersion: 1 }).status === 409);
check("canRelease: matching version → OK", canRelease({ paper, decision: { round: 0, version: 2, released_at: null }, expectedVersion: 2 }).ok);
check("canRelease: paper moved on → 409", canRelease({ paper: { ...paper, status: "REVISION" }, decision: { round: 0, version: 1, released_at: null }, expectedVersion: 1 }).status === 409);
check("STALE / DECISION_EXISTS / DECISION_FINAL map to 409",
  ["STALE", "DECISION_EXISTS", "DECISION_FINAL"].every((c) => mapRpcError({ message: `RPP:${c}` })?.status === 409));

console.log("\nAuthor-facing privacy:");
{
  const dec = {
    id: "d1", round: 0, decision: "MAJOR_REVISION", summary: "Please revise sections 2–4.",
    confidential_note: "SECRET: borderline, consider reject next round", review_ids: [U(1), U(4)],
    revision_due_at: "2026-12-01T00:00:00Z", revision_id: "rev-1", version: 2,
    decided_by: "editor-uuid", released_at: "2026-11-01T10:00:00Z", released_by: "editor-uuid",
  };
  const revs = [
    { id: U(1), reviewer: "rev-A", status: "SUBMITTED", comments_to_author: "Clarify method.", confidential_to_editor: "CONF-A", recommendation: "REJECT" },
    { id: U(4), reviewer: "rev-B", status: "SUBMITTED", comments_to_author: "More data.", confidential_to_editor: "CONF-B" },
  ];
  const a = decisionForAuthor(dec, revs, { round: 1, status: RS.REQUESTED, due_at: "2026-12-01T00:00:00Z" }, NOW);
  const blob = JSON.stringify(a);
  check("unreleased decision is invisible to the author", decisionForAuthor({ ...dec, released_at: null }, revs, null, NOW) === null);
  check("author view has outcome, date, message", a.decision === "MAJOR_REVISION" && a.decidedAt === dec.released_at && a.message === dec.summary);
  check("author view omits confidential note", !/SECRET/.test(blob) && !("confidentialNote" in a));
  check("author view omits decision maker", !/editor-uuid/.test(blob));
  check("author view omits reviewer confidential comments + identity", !/CONF-|rev-A|rev-B/.test(blob));
  check("author view omits reviewer recommendation", !/"REJECT"/.test(blob));
  check("reviewers labelled anonymously", a.reviews.map((r) => r.label).join() === "Reviewer 1,Reviewer 2");
  check("author view includes next action + revision deadline", !!a.nextAction && a.revisionDueAt === "2026-12-01T00:00:00Z");
  const m = decisionForManager(dec, new Map([["editor-uuid", "Dr Editor"]]));
  check("manager view keeps confidential note + names", m.confidentialNote.startsWith("SECRET") && m.decidedBy === "Dr Editor");
}

console.log("\nNo author identity in editor/reviewer-facing APIs:");
{
  const editorial = read("../app/api/editorial/route.js");
  // The only allowed use: excluding the admin's OWN papers (a filter, never selected or returned).
  const OWN_EXCLUSION = "WHERE submitted_by <> ? ORDER BY updated_at DESC LIMIT 500`, [me.id]";
  check("editorial dashboard never selects paper_authors or submitted_by", !/paper_authors|submitted_by/.test(editorial.replace(OWN_EXCLUSION, "")));
  check("editorial dashboard excludes an admin's own papers", editorial.includes(OWN_EXCLUSION));
  const decisionsRoute = read("../app/api/papers/[id]/decisions/route.js");
  check("decisions API never queries paper_authors", !/paper_authors/.test(decisionsRoute));
  check("decisions API 404s for non-manager non-owner (e.g. reviewers)", /!ctx\.canManage && !ctx\.isOwner/.test(decisionsRoute));
}

console.log("\nEditorial dashboard categories:");
check("UNDER_REVIEW + submitted → AWAITING_DECISION", editorialCategory(paper, [{ status: "SUBMITTED" }], []) === "AWAITING_DECISION");
check("UNDER_REVIEW + none submitted → AWAITING_REVIEWS", editorialCategory(paper, [{ status: "DRAFT" }], []) === "AWAITING_REVIEWS");
check("REVISION → REVISION", editorialCategory({ ...paper, status: "REVISION" }, [], []) === "REVISION");
check("ACCEPTED / REJECTED buckets", editorialCategory({ ...paper, status: "ACCEPTED" }, [], []) === "ACCEPTED" && editorialCategory({ ...paper, status: "REJECTED" }, [], []) === "REJECTED");
check("draft decision still counts as awaiting decision", editorialCategory(paper, [{ status: "SUBMITTED" }], [{ round: 0, released_at: null }]) === "AWAITING_DECISION");

console.log(`\n${failures === 0 ? "✓ PASS — editorial decision logic is sound." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

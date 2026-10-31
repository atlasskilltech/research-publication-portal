/**
 * No-DB unit tests for Phase 4 editorial decisions (lib/decisionLogic.js) plus
 * STATIC checks of supabase/migrations/0008_editorial_decisions.sql and the
 * route sources. The SQL is read as text — the functions are NOT executed
 * against a database here. Run: node scripts/test-decision-logic.mjs
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
const sql = read("../supabase/migrations/0008_editorial_decisions.sql");
const fnBody = (name) => {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`));
  return m ? m[1] : "";
};
const save = fnBody("save_editorial_decision");
const release = fnBody("release_editorial_decision");

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const NOW = new Date("2026-11-01T12:00:00Z");
const paper = { id: "p", submitted_by: "author", status: "UNDER_REVIEW", current_round: 0 };
const reviews = [
  { id: U(1), round: 0, status: "SUBMITTED" },
  { id: U(2), round: 0, status: "DRAFT" },
  { id: U(3), round: 1, status: "SUBMITTED" },
];

console.log("\n=== Phase 4 editorial decision unit tests ===\n");

console.log("Migration parse guard:");
check("save/release function bodies found (no vacuous SQL checks)", save.length > 500 && release.length > 500);

console.log("\nDecision authorization:");
check("admin may decide", canDecide({ id: "a", isAdmin: true }, []));
check("paper EDITOR may decide", canDecide({ id: "e" }, [{ assignee: "e", role: "EDITOR" }]));
check("PEER_REVIEWER may NOT decide", !canDecide({ id: "r" }, [{ assignee: "r", role: "PEER_REVIEWER" }]));
check("DESK_REVIEWER may NOT decide", !canDecide({ id: "r" }, [{ assignee: "r", role: "DESK_REVIEWER" }]));
check("SPOC may NOT decide", !canDecide({ id: "s" }, [{ assignee: "s", role: "SPOC" }]));
check("author may NOT decide", !canDecide({ id: "author" }, []));
check("editor of a different paper may NOT decide", !canDecide({ id: "e2" }, [{ assignee: "e", role: "EDITOR" }]));
check("SQL save re-checks manager", /_rpp_is_manager\(p_paper, p_actor\)/.test(save) && /FORBIDDEN/.test(save));
check("SQL release re-checks manager", /_rpp_is_manager\(p_paper, p_actor\)/.test(release) && /FORBIDDEN/.test(release));
check("functions not callable by anon/authenticated",
  /revoke all on function public\.save_editorial_decision\([^)]*\) from public, anon, authenticated/.test(sql) &&
  /revoke all on function public\.release_editorial_decision\([^)]*\) from public, anon, authenticated/.test(sql));
check("decisions table: no author RLS branch (confidential column)", /create policy editorial_decisions_select[\s\S]*?using \(\s*public\.current_user_is_admin\(\) or public\.current_user_is_paper_editor\(paper_id\)\s*\);/.test(sql));

console.log("\nReviewer recommendations never become decisions:");
check("no code path reads review.recommendation when saving", !/recommendation/.test(save) && !/recommendation/.test(release));
check("decision value comes only from the manager's input", /p_decision/.test(save));

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
check("SQL save requires UNDER_REVIEW + submitted review", /NOT_UNDER_REVIEW/.test(save) && /NO_SUBMITTED_REVIEWS/.test(save));
check("SQL release requires UNDER_REVIEW and the current round", /v_paper\.status <> 'UNDER_REVIEW' or v_dec\.round <> v_paper\.current_round/.test(release));
check("effects: ACCEPT→ACCEPTED, REJECT→REJECTED, revisions→REVISION",
  DECISION_EFFECT.ACCEPT.paperStatus === "ACCEPTED" && DECISION_EFFECT.REJECT.paperStatus === "REJECTED" &&
  DECISION_EFFECT.MINOR_REVISION.paperStatus === "REVISION" && DECISION_EFFECT.MAJOR_REVISION.revisionType === "MAJOR");
check("SQL ACCEPT sets ACCEPTED", /'ACCEPT' then\s+update public\.papers set status = 'ACCEPTED'/.test(release));
check("SQL REJECT sets REJECTED", /'REJECT' then\s+update public\.papers set status = 'REJECTED'/.test(release));

console.log("\nDecision history preservation:");
check("one decision per (paper, round)", /unique \(paper_id, round\)/.test(sql));
check("immutability trigger on update AND delete", /before update or delete on public\.editorial_decisions/.test(sql));
check("trigger rejects changes to communicated decisions", /old\.released_at is not null then\s+raise exception 'RPP:DECISION_FINAL'/.test(fnBody("_rpp_decision_immutable")));
check("save refuses to touch a communicated decision", /released_at is not null then raise exception 'RPP:DECISION_EXISTS'/.test(save));
check("no DELETE of decisions in 0008", !/delete\s+from\s+public\.editorial_decisions/i.test(sql));
check("isEditable: draft yes, communicated no", isEditable({ released_at: null }) && !isEditable({ released_at: "t" }));
check("draft edits are logged (DECISION_UPDATED with version)", /'DECISION_UPDATED'[\s\S]*'version'/.test(save));
check("communication logged (DECISION_COMMUNICATED)", /'DECISION_COMMUNICATED'/.test(release));
check("decision maker + timestamp recorded", /decided_by = p_actor/.test(save) && /released_at = now\(\), released_by = p_actor/.test(release));

console.log("\nRevision integration (reuses Phase 3, no duplicates):");
check("release calls request_paper_revision for MINOR/MAJOR", /public\.request_paper_revision\(/.test(release));
check("maps MINOR_REVISION→'MINOR', else 'MAJOR'", /when 'MINOR_REVISION' then 'MINOR' else 'MAJOR'/.test(release));
check("0008 never inserts paper_revisions directly", !/insert into public\.paper_revisions/i.test(sql));
check("decision links the created revision (revision_id)", /revision_id = v_rev/.test(release));
check("decision summary becomes the revision instructions", /v_dec\.summary, v_dec\.revision_due_at, v_dec\.review_ids/.test(release));
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
check("save locks the paper row FOR UPDATE", /from public\.papers where id = p_paper for update/.test(save));
check("save locks the existing decision FOR UPDATE", /from public\.editorial_decisions[\s\S]*?for update/.test(save));
check("release locks paper + decision FOR UPDATE", (release.match(/for update/g) || []).length >= 2);
check("each draft save bumps version", /version = version \+ 1/.test(save));
check("release requires the expected version (STALE otherwise)", /v_dec\.version <> p_expected_version then raise exception 'RPP:STALE'/.test(release));
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
  const OWN_EXCLUSION = 'paperQ = paperQ.neq("submitted_by", me.id)';
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

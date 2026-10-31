/**
 * No-DB unit test of the peer-review logic (lib/reviewLogic.js): review
 * validation (draft vs final), assignment eligibility, double-blind shaping,
 * and confidential-comment separation. Run: node scripts/test-review-logic.mjs
 */
import {
  statusAfterAssignment,
  validateReview, canAssignRole, paperForReviewer, reviewForAuthor, reviewForEditor, TEXT_LIMITS,
} from "../lib/reviewLogic.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };

const full = {
  recommendation: "MINOR_REVISION",
  technicalQuality: 4, originality: 3, methodology: 4, clarity: 5,
  strengths: "Clear contribution.", weaknesses: "Needs more data.",
  commentsToAuthor: "Please expand section 3.", confidentialToEditor: "Borderline but acceptable.",
};

console.log("\n=== Peer-review logic unit tests ===\n");

console.log("validateReview — draft (lenient):");
check("empty draft is OK", validateReview({}, { final: false }).ok === true);
check("draft keeps separate comment fields", (() => { const v = validateReview(full, { final: false }); return v.ok && v.value.comments_to_author && v.value.confidential_to_editor; })());
check("draft rejects invalid recommendation", validateReview({ recommendation: "MAYBE" }, { final: false }).ok === false);
check("draft rejects out-of-range score", validateReview({ technicalQuality: 9 }, { final: false }).ok === false);

console.log("\nvalidateReview — final (strict):");
check("complete final review accepted", validateReview(full, { final: true }).ok === true);
check("final without recommendation rejected", validateReview({ ...full, recommendation: "" }, { final: true }).ok === false);
check("final missing a score rejected", validateReview({ ...full, methodology: "" }, { final: true }).ok === false);
check("final missing strengths rejected", validateReview({ ...full, strengths: "" }, { final: true }).ok === false);
check("final missing comments-to-author rejected", validateReview({ ...full, commentsToAuthor: "" }, { final: true }).ok === false);
check("over-length comment rejected", validateReview({ ...full, commentsToAuthor: "x".repeat(TEXT_LIMITS.comments_to_author + 1) }, { final: true }).ok === false);

console.log("\nEligibility:");
check("PEER_REVIEWER holder is eligible", canAssignRole("PEER_REVIEWER", ["SPOC", "PEER_REVIEWER"]) === true);
check("non-holder is NOT eligible", canAssignRole("PEER_REVIEWER", ["EDITOR"]) === false);

console.log("\nDouble-blind & confidential separation:");
check("paperForReviewer strips authors", !("authors" in paperForReviewer({ id: "p", title: "t", authors: [{ fullName: "A" }] })));
{
  const r = { recommendation: "ACCEPT", comments_to_author: "to author", confidential_to_editor: "secret" };
  check("reviewForAuthor OMITS confidential_to_editor", !("confidential_to_editor" in reviewForAuthor(r)));
  check("reviewForAuthor keeps comments_to_author", reviewForAuthor(r).comments_to_author === "to author");
  check("reviewForEditor KEEPS confidential_to_editor", reviewForEditor(r).confidential_to_editor === "secret");
}

console.log("\nStatus after assignment:");
check("peer reviewer starts review", statusAfterAssignment("SUBMITTED", "PEER_REVIEWER") === "UNDER_REVIEW");
check("desk reviewer starts review", statusAfterAssignment("SUBMITTED", "DESK_REVIEWER") === "UNDER_REVIEW");
check("SPOC does not start review", statusAfterAssignment("SUBMITTED", "SPOC") === null);
check("EDITOR does not start review", statusAfterAssignment("SUBMITTED", "EDITOR") === null);
check("no change once under review", statusAfterAssignment("UNDER_REVIEW", "PEER_REVIEWER") === null);
check("no change during revision", statusAfterAssignment("REVISION", "PEER_REVIEWER") === null);

console.log(`\n${failures === 0 ? "✓ PASS — peer-review logic is sound." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

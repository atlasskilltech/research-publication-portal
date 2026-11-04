/**
 * No-DB regression tests for the defects fixed in the final completion audit.
 * Pure-function checks plus static checks on routes and migrations (nothing
 * here talks to the database, SMTP or the network).
 * Run: node scripts/test-audit-fixes.mjs
 */
import { readFileSync } from "node:fs";
import { safeNextPath, LINK_MESSAGES } from "../lib/authFlow.js";
import { assignmentBlock, OWNER_VISIBLE_ACTIONS } from "../lib/reviewLogic.js";
import { mimeForStorageKey, requestTooLarge, MAX_BYTES } from "../lib/manuscriptFiles.js";
import { shapeActivityFeed } from "../lib/dashboardLogic.js";
import { revisionForManager, mapRpcError } from "../lib/revisionLogic.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

console.log("\n=== Final audit regression tests ===\n");

// ---------------------------------------------------------------------------
console.log("Post-login redirect (callbackUrl) is same-origin only:");
{
  const ok = [["/submissions/1", "/submissions/1"], ["/publications/manage?x=1", "/publications/manage?x=1"], ["/reviews", "/reviews"]];
  for (const [i, o] of ok) check(`keeps ${i}`, safeNextPath(i) === o, safeNextPath(i));
  const bad = ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/javascript:alert(1)",
    "/login", "/register", "/auth/confirm?token_hash=x", "/create-password", "/reset-password", "/api/papers",
    "/a b", "/x\tz", "", null, undefined, 42, "/" + "a".repeat(600)];
  for (const b of bad) check(`rejects ${JSON.stringify(b)?.slice(0, 40)}`, safeNextPath(b) === "/dashboard");
  const login = read("../app/(auth)/login/page.js");
  check("login page passes the sanitised callbackUrl to the form",
    /<LoginForm next=\{safeNextPath\(sp\.callbackUrl\)\} \/>/.test(login) ||
      (/const next = safeNextPath\(sp\.callbackUrl\);/.test(login) && /<LoginForm next=\{next\} \/>/.test(login) &&
        /<GoogleSignInButton next=\{next\}( prominent)? \/>/.test(login)));
  check("login form no longer hard-codes /dashboard", !/router\.push\("\/dashboard"\)/.test(read("../components/auth/LoginForm.jsx")));
}

// ---------------------------------------------------------------------------
console.log("\nReset-password expiry offers a RESET link (not a setup link):");
{
  check("reset_required message exists", typeof LINK_MESSAGES.reset_required === "string" && /reset/i.test(LINK_MESSAGES.reset_required));
  check("/reset-password redirects to status=reset_required", /status=reset_required/.test(read("../app/reset-password/page.js")));
  check("/create-password still uses setup_required", /status=setup_required/.test(read("../app/create-password/page.js")));
  check("confirm page renders the reset form for reset_required", /failure === "reset_required"/.test(read("../app/auth/confirm/page.js")) && /<ResendSetupForm purpose="reset" \/>/.test(read("../app/auth/confirm/page.js")));
  check("form redirects by mode", /reset \? "reset_required" : "setup_required"/.test(read("../components/auth/CreatePasswordForm.jsx")));
}

// ---------------------------------------------------------------------------
console.log("\nRegistration is rate-limited:");
{
  const reg = read("../app/api/register/route.js");
  const iLimit = reg.indexOf("registerRateLimit(");
  check("register calls registerRateLimit", iLimit > 0);
  check("…before any account lookup or creation", iLimit > 0 && iLimit < reg.indexOf("registerAccount("));
  check("…and answers 429", /status: 429/.test(reg));
  check("register limiter is separate from the resend limiter", /const registerLimiter = createRateLimiter/.test(read("../lib/authServer.js")));
}

// ---------------------------------------------------------------------------
console.log("\nAdministrator who authored a paper is treated as its AUTHOR:");
{
  check("paper context: owner never manages own paper", /canManage: !isOwner && canManageRevisions/.test(read("../lib/paperAccess.js")));
  const detail = read("../app/api/papers/[id]/route.js");
  check("paper detail: owner role checked before admin", /const viewerRole = isOwner \? "owner" : me\.isAdmin \? "admin" : "reviewer";/.test(detail));
  check("admin review monitor hides own papers", /filter\(\(a\) => !ownPaper\(a\.paper_id\)\)/.test(read("../app/api/admin/reviews/route.js")));
  check("dashboard editorial scope excludes own papers for admins", /FROM \\`\$\{T\.papers\}\\` WHERE submitted_by <> \? LIMIT 2000`, \[me\.id\]/.test(read("../app/api/dashboard/route.js")));

  // Activity: admin A1 authored P1; reviewer R1 acted on it.
  const rows = [
    { id: 1, paper_id: "P1", actor: "A1", action: "SUBMITTED", detail: {}, created_at: "2026-10-01T00:00:00Z" },
    { id: 2, paper_id: "P1", actor: "R1", action: "REVIEW_SUBMITTED", detail: { round: 0 }, created_at: "2026-10-02T00:00:00Z" },
    { id: 3, paper_id: "P1", actor: "E", action: "PAPER_PUBLISHED", detail: {}, created_at: "2026-10-03T00:00:00Z" },
    { id: 4, paper_id: "P2", actor: "R1", action: "REVIEW_SUBMITTED", detail: { round: 0 }, created_at: "2026-10-04T00:00:00Z" },
  ];
  const feed = shapeActivityFeed(rows, {
    viewerId: "A1", isAdmin: true, ownPaperIds: new Set(["P1"]), editedPaperIds: new Set(),
    submitterByPaper: new Map([["P1", "A1"], ["P2", "X"]]), titleByPaper: new Map(), nameById: new Map([["R1", "Reviewer One"], ["E", "Editor"]]),
  });
  const own = feed.filter((x) => x.paperId === "P1");
  check("admin-author does not see reviewer activity on own paper", !own.some((x) => x.action === "REVIEW_SUBMITTED"));
  check("admin-author sees no actor names on own paper", own.every((x) => x.actor === null) && !JSON.stringify(own).includes("Reviewer One"));
  check("admin still sees named activity on other papers", feed.some((x) => x.paperId === "P2" && x.actor === "Reviewer One"));
  check("author is told when the paper is published", own.some((x) => x.action === "PAPER_PUBLISHED") && OWNER_VISIBLE_ACTIONS.includes("PAPER_PUBLISHED"));
}

// ---------------------------------------------------------------------------
console.log("\nAssignment guard:");
{
  const p = (status, by = "A") => ({ status, submitted_by: by });
  check("admin cannot assign on a paper they submitted", !!assignmentBlock(p("SUBMITTED", "ADMIN"), "ADMIN", "PEER_REVIEWER"));
  check("admin cannot assign an EDITOR on own paper either", !!assignmentBlock(p("ACCEPTED", "ADMIN"), "ADMIN", "EDITOR"));
  for (const s of ["SUBMITTED", "UNDER_REVIEW", "REVISION"]) check(`reviewer may be assigned while ${s}`, assignmentBlock(p(s), "ADMIN", "PEER_REVIEWER") === null);
  for (const s of ["ACCEPTED", "REJECTED", "PUBLISHED", "ARCHIVED"]) {
    check(`no reviewer on a ${s} paper`, !!assignmentBlock(p(s), "ADMIN", "DESK_REVIEWER"));
    check(`editor still assignable on a ${s} paper`, assignmentBlock(p(s), "ADMIN", "EDITOR") === null);
  }
  check("missing paper is blocked", !!assignmentBlock(null, "ADMIN", "EDITOR"));
  const assign = read("../app/api/papers/[id]/assign/route.js");
  check("assign route applies the guard", /assignmentBlock\(paper, me\.id, role\)/.test(assign));
  check("re-assigning without a date keeps the deadline", /ON DUPLICATE KEY UPDATE assigned_by = VALUES\(assigned_by\)\$\{dueAt \? ", due_at = VALUES\(due_at\)" : ""\}/.test(assign));
  check("unassign is blocked on own paper", /submitted_by === me\.id\) return NextResponse\.json\(\{ error: "You can't manage assignments/.test(assign));
}

// ---------------------------------------------------------------------------
console.log("\nManuscript upload/download hardening:");
{
  check("pdf served as application/pdf", mimeForStorageKey("ab/cd.pdf") === "application/pdf");
  check("docx served as the docx type", /wordprocessingml/.test(mimeForStorageKey("x.docx")));
  check("unknown extension → octet-stream", mimeForStorageKey("x.html") === "application/octet-stream" && mimeForStorageKey(null) === "application/octet-stream");
  const h = (n) => ({ get: (k) => (k === "content-length" ? n : null) });
  check("oversized Content-Length refused early", requestTooLarge(h(String(MAX_BYTES + 5 * 1024 * 1024))));
  check("normal upload allowed", !requestTooLarge(h(String(MAX_BYTES))));
  check("missing Content-Length refused (chunked uploads cannot bypass the early limit)", requestTooLarge(h(null)));
  for (const f of ["../app/api/papers/route.js", "../app/api/papers/[id]/revisions/[round]/manuscript/route.js"]) {
    const s = read(f);
    check(`${f.split("/api/")[1]}: stored type comes from the verified signature`, /const mimeType = ALLOWED\[verdict\.ext\]\.mime;/.test(s) && !/file\.type && file\.type\.trim\(\)/.test(s));
    check(`${f.split("/api/")[1]}: early size check before formData()`, s.indexOf("requestTooLarge(request.headers)") > 0 && s.indexOf("requestTooLarge(request.headers)") < s.indexOf("request.formData()"));
  }
  for (const f of ["../app/api/papers/[id]/manuscript/route.js", "../app/api/public/publications/[id]/manuscript/route.js"]) {
    const s = read(f);
    check(`${f.split("/api/")[1]}: nosniff + server-derived Content-Type`, /"X-Content-Type-Options": "nosniff"/.test(s) && /mimeForStorageKey\(/.test(s));
  }
  check("editors can download every version (incl. unreleased revision)", /permittedVersions\(privileged \|\| ctx\.canManage \? "owner" : "assigned"/.test(read("../app/api/papers/[id]/manuscript/route.js")));
}

// ---------------------------------------------------------------------------
console.log("\nRevisions & decisions:");
{
  const rev = { round: 1, revision_type: "MINOR", instructions: "x", due_at: null, status: "REVISION_SUBMITTED", review_ids: [], responses: [] };
  const ms = { version: 1, original_filename: "Smith_revised.docx", mime_type: "application/pdf", byte_size: 10, created_at: "t" };
  check("editor view hides the revised manuscript's filename by default", revisionForManager(rev, new Map(), ms).manuscript.filename === null);
  check("admin view may include it", revisionForManager(rev, new Map(), ms, new Date(), { withFilename: true }).manuscript.filename === "Smith_revised.docx");
  check("revisions route passes withFilename only for admins", /withFilename: !!me\.isAdmin/.test(read("../app/api/papers/[id]/revisions/route.js")));
  check("legacy revision POST refuses to overwrite a draft decision", /code: "DRAFT_EXISTS"/.test(read("../app/api/papers/[id]/revisions/route.js")));
  const m = mapRpcError({ message: "RPP:NOT_UNDER_REVIEW" });
  check("NOT_UNDER_REVIEW copy is generic (decisions raise it too)", m && m.status === 409 && !/revision can only be requested/i.test(m.body?.error || m.error || ""), JSON.stringify(m));
  const page = read("../app/(app)/submissions/[id]/revision/page.js");
  check("revision workspace refreshes quietly (unsaved responses kept)", /onChanged=\{\(\) => load\(\{ quiet: true \}\)\}/.test(page) && /<RevisionWork key=\{latest\.round\}/.test(page));
}

// ---------------------------------------------------------------------------
console.log("\nAdmin role changes + decision history (MySQL ports of the 0010 / 0011 fixes):");
{
  // 0010 (role RPC hardening) → lib/repos/users.mjs setUserRoles. There is no
  // anon/authenticated database role to REVOKE from in MySQL (the database is never
  // reachable from browsers), so the equivalent guards are: the function is server-only,
  // the route requires an admin SESSION first, and the actor is re-checked as admin
  // under the admin-row lock before any write. Executable proof: scripts/test-mysql-integration.mjs.
  const repo = read("../lib/repos/users.mjs");
  const body = repo.slice(repo.indexOf("export async function setUserRoles"), repo.indexOf("export async function deleteUser"));
  const iLock = body.indexOf("WHERE isAdmin = 1 FOR UPDATE"), iTarget = body.indexOf("WHERE id = ? FOR UPDATE");
  const iActor = body.indexOf('throw new Error("RPP_FORBIDDEN")'), iWrite = body.indexOf("DELETE FROM");
  check("setUserRoles found", body.length > 500);
  check("role changes lock every admin row + the target FOR UPDATE first", iLock > 0 && iTarget > iLock && iTarget < iWrite);
  check("actor is re-checked as admin under the lock, before any write", iActor > iLock && iActor < iWrite);
  const route = read("../app/api/admin/users/[id]/route.js");
  check("route requires an admin session before calling setUserRoles", /if \(!me\.isAdmin\) return \{ error:/.test(route) && route.indexOf("requireAdmin()") < route.indexOf("setUserRoles(tx"));
  check("role repo is never imported by a client component", !/^\s*["']use client["']/.test(repo) && !/lib\/repos\/users/.test(read("../components/manage/UsersAdmin.jsx")));
  check("setUserRoles keeps the existing guards (self / protected / last admin / invalid role)", ["RPP_SELF", "RPP_PROTECTED", "RPP_LAST_ADMIN", "RPP_INVALID_ROLE"].every((c) => body.includes(c)));
  check("isAdmin is synced with the ADMINISTRATOR role in the same transaction", /if \(curr !== next\) await tx\.exec\(`UPDATE \\`\$\{T\.users\}\\` SET isAdmin = \?/.test(body));
  check("API maps RPP_FORBIDDEN to 403", /RPP_FORBIDDEN"\)\) return \{ status: 403/.test(route));

  // 0011 (decision trigger vs user/paper deletes) → no trigger in MySQL: plain FK actions,
  // immutability enforced by `released_at IS NULL` guards in the workflow service.
  const ddl = read("../database/migrations/002_workflow.mjs");
  const dec = ddl.slice(ddl.indexOf("createTable(T.editorialDecisions"), ddl.indexOf(");\n", ddl.indexOf("createTable(T.editorialDecisions")));
  check("deleting a user clears decided_by/released_by (ON DELETE SET NULL)", /research_editorial_decisions_decided_by_fk\\` FOREIGN KEY \(\\`decided_by\\`\) \$\{U\} ON DELETE SET NULL/.test(dec) && /research_editorial_decisions_released_by_fk\\` FOREIGN KEY \(\\`released_by\\`\) \$\{U\} ON DELETE SET NULL/.test(dec));
  check("deleting a paper cascades to its decisions", /research_editorial_decisions_paper_fk\\` FOREIGN KEY \(\\`paper_id\\`\) \$\{P\} ON DELETE CASCADE/.test(dec));
  check("no database triggers that could block those cascades", !/CREATE\s+TRIGGER/i.test(ddl + read("../database/migrations/001_auth.mjs") + read("../database/migrations/003_publication.mjs")));
  const wf = read("../lib/services/workflow.mjs");
  const decUpdates = wf.match(/UPDATE \\`\$\{T\.editorialDecisions\}\\`[\s\S]*?`/g) || [];
  check("content edits of a released decision are refused (every UPDATE guarded by released_at IS NULL)", decUpdates.length >= 2 && decUpdates.every((u) => /released_at IS NULL/.test(u)) && /fail\("DECISION_FINAL"\)/.test(wf));
  check("owner activity allowlist includes PAPER_PUBLISHED", OWNER_VISIBLE_ACTIONS.includes("PAPER_PUBLISHED"));
  // ("0005–0008 untouched" dropped: the Postgres migrations are no longer part of the active workflow.)
  check("removing EDITOR role ends paper-editor assignments", /if \(!roles\.includes\("EDITOR"\)\)[\s\S]*?DELETE FROM \\`\$\{T\.paperAssignments\}\\` WHERE assignee = \? AND role = 'EDITOR'/.test(route));
}

// ---------------------------------------------------------------------------
console.log("\nUI fixes:");
{
  check("sidebar highlights only the most specific link", /const activeHref = items\.map/.test(read("../components/layout/Sidebar.jsx")));
  check("RoleContext no longer bundles mock users", !/lib\/mock/.test(read("../components/layout/RoleContext.jsx")));
  check("publishing a volume asks for confirmation", /setPublishVolume\(v\)/.test(read("../components/publications/VolumesManager.jsx")));
  check("public 404 links back to /publications", /href="\/publications"/.test(read("../app/(public)/publications/not-found.js")));
  check("decision panel shows an error (not 'no reviews') when a fetch fails", /if \(!r1\.ok \|\| !r2\.ok\) setFailed\(true\)/.test(read("../components/decisions/DecisionPanel.jsx")));
  check("revision manager shows an error when a fetch fails", /if \(!revData \|\| failed\)/.test(read("../components/revisions/RevisionManager.jsx")));
  check("Textarea renders field errors", /export default function Textarea\(\{ label, hint, error,/.test(read("../components/ui/Textarea.jsx")));
  check("submitted review shows the submitted recommendation", /recommendation: form\.recommendation \}\)\)/.test(read("../app/(app)/submissions/[id]/page.js")));
  check("downloads no longer use the download attribute (errors stay visible)", ![
    "../app/(app)/submissions/[id]/page.js", "../app/(app)/submissions/[id]/revision/page.js", "../components/revisions/RevisionManager.jsx",
  ].some((f) => /manuscript\?version=[^\n]*\} download/.test(read(f))));
}

console.log(`\n${failures === 0 ? "✓ PASS — audit fixes hold." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

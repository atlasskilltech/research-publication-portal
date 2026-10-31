/**
 * No-DB regression tests for the defects fixed in the final completion audit.
 * Pure-function checks plus static checks on routes and migrations (nothing
 * here talks to Supabase, Resend or the network).
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
  check("login page passes the sanitised callbackUrl to the form", /<LoginForm next=\{safeNextPath\(sp\.callbackUrl\)\} \/>/.test(login));
  check("login form no longer hard-codes /dashboard", !/router\.push\("\/dashboard"\)/.test(read("../components/auth/LoginForm.jsx")));
}

// ---------------------------------------------------------------------------
console.log("\nReset-password expiry offers a RESET link (not a setup link):");
{
  check("reset_required message exists", typeof LINK_MESSAGES.reset_required === "string" && /reset/i.test(LINK_MESSAGES.reset_required));
  check("/reset-password redirects to status=reset_required", /status=reset_required/.test(read("../app/reset-password/page.js")));
  check("/create-password still uses setup_required", /status=setup_required/.test(read("../app/create-password/page.js")));
  check("confirm page renders the reset form for reset_required", /purpose=\{failure === "reset_required" \? "reset" : "setup"\}/.test(read("../app/auth/confirm/page.js")));
  check("form redirects by mode", /reset \? "reset_required" : "setup_required"/.test(read("../components/auth/CreatePasswordForm.jsx")));
}

// ---------------------------------------------------------------------------
console.log("\nRegistration is rate-limited:");
{
  const reg = read("../app/api/register/route.js");
  const iLimit = reg.indexOf("registerRateLimit(");
  check("register calls registerRateLimit", iLimit > 0);
  check("…before any account lookup or creation", iLimit > 0 && iLimit < reg.indexOf("findUserByEmail(email)") && iLimit < reg.indexOf("registerAndInvite("));
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
  check("dashboard editorial scope excludes own papers for admins", /pq\.neq\("submitted_by", me\.id\)/.test(read("../app/api/dashboard/route.js")));

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
  check("re-assigning without a date keeps the deadline", /\.\.\.\(dueAt \? \{ due_at: dueAt \} : \{\}\)/.test(assign));
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
console.log("\nMigrations 0010 / 0011 (written, NOT applied):");
{
  const m10 = read("../supabase/migrations/0010_harden_admin_set_user_roles.sql");
  check("0010 revokes EXECUTE from public, anon AND authenticated", /revoke all on function public\.admin_set_user_roles\(uuid, uuid, text\[\], text\[\]\) from public, anon, authenticated;/.test(m10));
  check("0010 grants EXECUTE to service_role only", /grant execute on function public\.admin_set_user_roles\(uuid, uuid, text\[\], text\[\]\) to service_role;/.test(m10) && !/to (anon|authenticated)/.test(m10));
  const body = m10.slice(m10.indexOf("create or replace function"));
  const iEndUser = body.indexOf("current_setting('role', true)"), iLock = body.indexOf("pg_advisory_xact_lock");
  const iActor = body.indexOf("where id = p_actor and is_admin"), iWrite = body.indexOf("delete from public.user_roles");
  check("0010 refuses end-user (anon/authenticated) requests first, before the lock", iEndUser > 0 && iEndUser < iLock && /coalesce\(auth\.role\(\), ''\) in \('anon', 'authenticated'\)/.test(body));
  check("0010 checks the actor is an admin under the lock, before any write", iLock > 0 && iActor > iLock && iActor < iWrite);
  check("executable SQL escalation test exists (scripts/test-admin-roles-sql.mjs)", /SET LOCAL ROLE/i.test(read("./test-admin-roles-sql.mjs")));
  check("0010 keeps the existing guards (self / protected / last admin)", ["RPP_SELF", "RPP_PROTECTED", "RPP_LAST_ADMIN", "RPP_INVALID_ROLE"].every((c) => m10.includes(c)));
  check("API maps RPP_FORBIDDEN to 403", /RPP_FORBIDDEN"\)\) return \{ status: 403/.test(read("../app/api/admin/users/[id]/route.js")));

  const m11 = read("../supabase/migrations/0011_audit_fixes.sql");
  check("0011 lets ON DELETE SET NULL clear decided_by/released_by", /new\.decided_by is null or new\.decided_by is not distinct from old\.decided_by/.test(m11));
  check("0011 still refuses content edits of a released decision", ["summary", "confidential_note", "decision", "review_ids", "released_at"].every((c) => new RegExp(`new\\.${c}\\s+is not distinct from old\\.${c}`).test(m11)) && /raise exception 'RPP:DECISION_FINAL'/.test(m11));
  check("0011 allows the paper-delete cascade", /not exists \(select 1 from public\.papers where id = old\.paper_id\)/.test(m11));
  check("0011 owner activity allowlist includes PAPER_PUBLISHED", /action in \([^)]*'PAPER_PUBLISHED'[^)]*\)/.test(m11));
  check("existing migrations 0005–0008 untouched by this fix", !/PAPER_PUBLISHED/.test(read("../supabase/migrations/0008_editorial_decisions.sql").split("create policy paper_activity_select")[1] || ""));
  check("removing EDITOR role ends paper-editor assignments", /if \(!roles\.includes\("EDITOR"\)\)[\s\S]*?\.eq\("role", "EDITOR"\)/.test(read("../app/api/admin/users/[id]/route.js")));
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

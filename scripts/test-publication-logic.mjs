/**
 * No-DB unit tests for Phase 5 publication management (lib/publicationLogic.js)
 * plus STATIC checks of supabase/migrations/0009_publication_management.sql and
 * the route/catalogue sources. SQL is read as text — nothing is executed against
 * a database. Route handlers are checked statically (they need the Next.js
 * runtime + Supabase to execute). Run: node scripts/test-publication-logic.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import {
  canManageVolumes, canManagePublication, canOpenPublicationDashboard, canTransitionContainer,
  canTransitionPublication, canPublishIssue, publicationEligibility, canPublishPaper, issueBelongsToVolume,
  validateVolume, validateIssue, validatePublicationMeta, defaultPublicationMeta, isPubliclyVisible,
  publicPublication, publicVolume, publicIssue, matchesSearch, uniqueViolationMessage, dbErrorToHttp,
} from "../lib/publicationLogic.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const sql = read("../supabase/migrations/0009_publication_management.sql");
const fnBody = (name) => {
  const m = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`));
  return m ? m[1] : "";
};
const FN = ["set_volume_status", "set_issue_status", "schedule_publication", "update_publication", "publish_paper"];

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const ACCEPTED = { id: "p", status: "ACCEPTED", submitted_by: "author" };
const ACCEPT_DEC = [{ decision: "ACCEPT", released_at: "2026-10-01T00:00:00Z" }];

console.log("\n=== Phase 5 publication management unit tests ===\n");

console.log("Migration parse guard:");
check("all 0009 state function bodies found", FN.every((f) => fnBody(f).length > 200), FN.map((f) => `${f}:${fnBody(f).length}`).join(" "));

console.log("\nVolume creation & validation:");
const vol = { volumeNumber: "3", year: "2026", title: "Research Vol 3", description: "" };
check("valid volume accepted (numbers coerced)", validateVolume(vol).ok && validateVolume(vol).value.volume_number === 3);
check("missing title rejected", !validateVolume({ ...vol, title: " " }).ok);
check("volume number 0 rejected", !validateVolume({ ...vol, volumeNumber: 0 }).ok);
check("non-integer volume number rejected", !validateVolume({ ...vol, volumeNumber: "2.5" }).ok);
check("year out of range rejected", !validateVolume({ ...vol, year: 1800 }).ok);
check("over-long description rejected", !validateVolume({ ...vol, description: "x".repeat(5001) }).ok);
check("SQL: volume number / year range checks", /volume_number int\s+not null check \(volume_number between 1 and 9999\)/.test(sql) && /year\s+int\s+not null check \(year between 1900 and 2200\)/.test(sql));

console.log("\nIssue creation & volume association:");
const iss = { volumeId: U(1), issueNumber: 2, title: "Spring", publicationDate: "2026-04-01" };
check("valid issue accepted", validateIssue(iss).ok);
check("issue requires a volume", !validateIssue({ ...iss, volumeId: "" }).ok);
check("issue number 0 rejected", !validateIssue({ ...iss, issueNumber: 0 }).ok);
check("impossible date rejected", !validateIssue({ ...iss, publicationDate: "2026-02-30" }).ok);
check("date optional", validateIssue({ ...iss, publicationDate: "" }).ok);
check("issueBelongsToVolume true for its own volume", issueBelongsToVolume({ id: "i", volume_id: U(1) }, U(1)));
check("issueBelongsToVolume false for another volume", !issueBelongsToVolume({ id: "i", volume_id: U(1) }, U(2)));
check("SQL: issue FK to volume", /volume_id\s+uuid\s+not null references public\.volumes \(id\)/.test(sql));
check("SQL: publication (issue, volume) composite FK enforces issue ∈ volume", /foreign key \(issue_id, volume_id\)\s+references public\.issues \(id, volume_id\)/.test(sql));
check("SQL: schedule/update check ISSUE_VOLUME_MISMATCH", /ISSUE_VOLUME_MISMATCH/.test(fnBody("schedule_publication")) && /ISSUE_VOLUME_MISMATCH/.test(fnBody("update_publication")));

console.log("\nDuplicate prevention:");
check("SQL: unique (year, volume_number)", /unique \(year, volume_number\)/.test(sql));
check("SQL: unique (volume_id, issue_number)", /unique \(volume_id, issue_number\)/.test(sql));
check("SQL: one publication per paper (unique paper_id)", /paper_id\s+uuid\s+not null unique references public\.papers/.test(sql));
check("SQL: unique DOI (case-insensitive)", /publications_doi_uidx on public\.publications \(lower\(doi\)\) where doi is not null/.test(sql));
check("duplicate volume → friendly 409", dbErrorToHttp({ code: "23505", message: 'duplicate key value violates unique constraint "volumes_year_volume_number_key"' })?.status === 409
  && /volume with this number/.test(uniqueViolationMessage({ code: "23505", message: "volumes_year_volume_number_key" })));
check("duplicate issue → friendly 409", /already has an issue/.test(uniqueViolationMessage({ code: "23505", message: "issues_volume_id_issue_number_key" })));
check("duplicate publication → friendly 409", /already has a publication/.test(uniqueViolationMessage({ code: "23505", message: "publications_paper_id_key" })));
check("non-unique errors are not treated as duplicates", uniqueViolationMessage({ code: "42501" }) === null);
check("SQL schedule rejects an existing record (ALREADY_SCHEDULED)", /ALREADY_SCHEDULED/.test(fnBody("schedule_publication")));
check("eligibility rejects a paper that already has a record", !publicationEligibility({ paper: ACCEPTED, decisions: ACCEPT_DEC, revisions: [], existing: { id: "x" } }).ok);

console.log("\nOnly accepted papers can be scheduled:");
check("ACCEPTED + communicated ACCEPT → eligible", publicationEligibility({ paper: ACCEPTED, decisions: ACCEPT_DEC, revisions: [] }).ok);
check("ACCEPTED but decision not communicated → not eligible", !publicationEligibility({ paper: ACCEPTED, decisions: [{ decision: "ACCEPT", released_at: null }], revisions: [] }).ok);
check("ACCEPTED status without any ACCEPT decision → not eligible", !publicationEligibility({ paper: ACCEPTED, decisions: [{ decision: "MINOR_REVISION", released_at: "t" }], revisions: [] }).ok);
for (const st of ["SUBMITTED", "UNDER_REVIEW"]) check(`${st} → not eligible`, !publicationEligibility({ paper: { ...ACCEPTED, status: st }, decisions: ACCEPT_DEC, revisions: [] }).ok);
check("SQL schedule requires status ACCEPTED", /v_paper\.status <> 'ACCEPTED' then raise exception 'RPP:NOT_ACCEPTED'/.test(fnBody("schedule_publication")));
check("SQL schedule requires a COMMUNICATED ACCEPT decision", /decision = 'ACCEPT' and released_at is not null/.test(fnBody("schedule_publication")));

console.log("\nRejected / revision-pending papers can't be published:");
check("REJECTED → not eligible", publicationEligibility({ paper: { ...ACCEPTED, status: "REJECTED" }, decisions: ACCEPT_DEC, revisions: [] }).status === 409);
check("REVISION → not eligible", !publicationEligibility({ paper: { ...ACCEPTED, status: "REVISION" }, decisions: ACCEPT_DEC, revisions: [] }).ok);
check("open revision → not eligible even if status says ACCEPTED", !publicationEligibility({ paper: ACCEPTED, decisions: ACCEPT_DEC, revisions: [{ status: "REVISION_IN_PROGRESS" }] }).ok);
check("canPublishPaper: REJECTED paper blocked", !canPublishPaper({ publication: { status: "SCHEDULED" }, paper: { status: "REJECTED" }, issue: { status: "PUBLISHED" } }).ok);
check("canPublishPaper: REVISION paper blocked", !canPublishPaper({ publication: { status: "SCHEDULED" }, paper: { status: "REVISION" }, issue: { status: "PUBLISHED" } }).ok);
for (const f of ["schedule_publication", "publish_paper"]) {
  check(`SQL ${f} raises PAPER_REJECTED and REVISION_PENDING`, /PAPER_REJECTED/.test(fnBody(f)) && /REVISION_PENDING/.test(fnBody(f)));
}
check("SQL bulk issue publish only publishes papers still ACCEPTED", /pb\.status = 'SCHEDULED' and p\.status = 'ACCEPTED'/.test(fnBody("set_issue_status")));

console.log("\nPublication metadata validation:");
const meta = {
  volumeId: U(1), issueId: U(2), title: "Final title", abstract: "Abs",
  authors: [{ name: "A. Author", affiliation: "ATLAS" }], keywords: "ml, nlp, ml",
  pageStart: "10", pageEnd: "18", doi: "10.1234/rpp.2026.1", publicationDate: "2026-05-01",
};
const mv = validatePublicationMeta(meta);
check("valid metadata accepted", mv.ok);
check("keywords split + de-duplicated", mv.ok && JSON.stringify(mv.value.keywords) === '["ml","nlp"]');
check("manuscriptPublic defaults to false", mv.ok && mv.value.manuscriptPublic === false);
check("title required", !validatePublicationMeta({ ...meta, title: "" }).ok);
check("at least one author", !validatePublicationMeta({ ...meta, authors: [] }).ok);
check("author without a name rejected", !validatePublicationMeta({ ...meta, authors: [{ name: "", affiliation: "X" }] }).ok);
check("more than 50 authors rejected", !validatePublicationMeta({ ...meta, authors: Array.from({ length: 51 }, (_, i) => ({ name: `A${i}` })) }).ok);
check("authors keep only name + affiliation (email dropped)", mv.ok && JSON.stringify(validatePublicationMeta({ ...meta, authors: [{ name: "A", affiliation: "B", email: "a@x.edu" }] }).value.authors) === '[{"name":"A","affiliation":"B"}]');
check("last page before first page rejected", !validatePublicationMeta({ ...meta, pageStart: 20, pageEnd: 10 }).ok);
check("last page without first page rejected", !validatePublicationMeta({ ...meta, pageStart: "", pageEnd: 10 }).ok);
check("bad DOI rejected", !validatePublicationMeta({ ...meta, doi: "doi:abc" }).ok);
check("DOI optional", validatePublicationMeta({ ...meta, doi: "" }).ok);
check("invalid date rejected", !validatePublicationMeta({ ...meta, publicationDate: "05/01/2026" }).ok);
check("non-uuid volume/issue rejected", !validatePublicationMeta({ ...meta, issueId: "1;drop" }).ok);
check("more than 20 keywords rejected", !validatePublicationMeta({ ...meta, keywords: Array.from({ length: 21 }, (_, i) => `k${i}`) }).ok);
check("SQL: page range + DOI format + published completeness checks", /publications_page_range check/.test(sql) && /doi ~ '\^10/.test(sql) && /publications_published_complete check/.test(sql));
{
  const d = defaultPublicationMeta({ title: "T", abstract: "A", keywords: ["k"] },
    [{ full_name: "Second", affiliation: "Y", email: "s@x.edu", author_order: 2 }, { full_name: "First", affiliation: "X", email: "f@x.edu", author_order: 1 }],
    [{ id: "m0", version: 0 }, { id: "m2", version: 2 }, { id: "m1", version: 1 }]);
  check("defaults snapshot authors in order, without emails", JSON.stringify(d.authors) === '[{"name":"First","affiliation":"X"},{"name":"Second","affiliation":"Y"}]');
  check("defaults reference the latest manuscript version", d.manuscriptId === "m2");
}

console.log("\nStatus transitions:");
check("volume/issue DRAFT → SCHEDULED", canTransitionContainer("DRAFT", "SCHEDULED"));
check("SCHEDULED → DRAFT allowed", canTransitionContainer("SCHEDULED", "DRAFT"));
check("DRAFT → PUBLISHED allowed", canTransitionContainer("DRAFT", "PUBLISHED"));
check("PUBLISHED is final", !canTransitionContainer("PUBLISHED", "DRAFT") && !canTransitionContainer("PUBLISHED", "SCHEDULED"));
check("no-op / unknown transitions rejected", !canTransitionContainer("DRAFT", "DRAFT") && !canTransitionContainer("DRAFT", "LIVE"));
check("publication: none → SCHEDULED", canTransitionPublication(null, "SCHEDULED"));
check("publication: SCHEDULED → PUBLISHED", canTransitionPublication("SCHEDULED", "PUBLISHED"));
check("publication: can't skip to PUBLISHED or go back", !canTransitionPublication(null, "PUBLISHED") && !canTransitionPublication("PUBLISHED", "SCHEDULED"));
check("issue can't publish in an unpublished volume", canPublishIssue({ status: "SCHEDULED" }, { status: "DRAFT" }).status === 409);
check("issue publishes in a published volume", canPublishIssue({ status: "SCHEDULED" }, { status: "PUBLISHED" }).ok);
check("paper can't publish before its issue", !canPublishPaper({ publication: { status: "SCHEDULED" }, paper: ACCEPTED, issue: { status: "SCHEDULED" } }).ok);
check("paper publishes once issue is published", canPublishPaper({ publication: { status: "SCHEDULED" }, paper: ACCEPTED, issue: { status: "PUBLISHED" } }).ok);
check("double publish rejected", !canPublishPaper({ publication: { status: "PUBLISHED" }, paper: ACCEPTED, issue: { status: "PUBLISHED" } }).ok);
check("SQL: volume/issue PUBLISHED is final (ALREADY_PUBLISHED)", /ALREADY_PUBLISHED/.test(fnBody("set_volume_status")) && /ALREADY_PUBLISHED/.test(fnBody("set_issue_status")));
check("SQL: issue publish requires published volume", /VOLUME_NOT_PUBLISHED/.test(fnBody("set_issue_status")));
check("SQL: paper publish requires published issue", /ISSUE_NOT_PUBLISHED/.test(fnBody("publish_paper")));
check("SQL: published records can't be edited", /ALREADY_PUBLISHED/.test(fnBody("update_publication")));
check("SQL: publish sets papers.status = PUBLISHED", /update public\.papers set status = 'PUBLISHED'/.test(fnBody("publish_paper")));
check("SQL: optimistic version check on update + publish", /RPP:STALE/.test(fnBody("update_publication")) && /RPP:STALE/.test(fnBody("publish_paper")));
check("SQL: functions lock rows FOR UPDATE", FN.every((f) => /for update/.test(fnBody(f))));

console.log("\nHistory preservation:");
check("0009 never updates/deletes reviews, decisions, revisions or manuscripts",
  !/(update|delete from)\s+public\.(reviews|editorial_decisions|paper_revisions|paper_manuscripts|paper_authors)\b/i.test(sql));
check("0009 does not alter existing tables' policies (reviews/decisions/activity)", !/create policy (reviews_select|editorial_decisions_select|paper_activity_select)/.test(sql));
check("publications FK to papers is ON DELETE RESTRICT", /references public\.papers \(id\) on delete restrict/.test(sql));
check("0005–0008 migrations still present", ["0005_submissions.sql", "0006_reviews.sql", "0007_revisions.sql", "0008_editorial_decisions.sql"].every((f) => readdirSync(new URL("../supabase/migrations/", import.meta.url)).includes(f)));

console.log("\nRole-based authorization:");
const admin = { id: "a", isAdmin: true, roles: [] };
const editor = { id: "e", isAdmin: false, roles: ["EDITOR"] };
const asg = [{ assignee: "e", role: "EDITOR" }, { assignee: "s", role: "SPOC" }, { assignee: "r", role: "PEER_REVIEWER" }, { assignee: "d", role: "DESK_REVIEWER" }];
check("ADMINISTRATOR manages volumes", canManageVolumes(admin));
check("EDITOR does NOT manage volumes", !canManageVolumes(editor));
check("ADMINISTRATOR manages any publication", canManagePublication(admin, []));
check("EDITOR manages publication of a paper they edit", canManagePublication(editor, asg));
check("EDITOR of OTHER papers cannot manage this one", !canManagePublication(editor, [{ assignee: "e2", role: "EDITOR" }]));
for (const [id, role] of [["s", "SPOC"], ["r", "PEER_REVIEWER"], ["d", "DESK_REVIEWER"]]) {
  check(`${role} cannot manage publications`, !canManagePublication({ id, isAdmin: false, roles: [role] }, asg));
  check(`${role} cannot open the publication dashboard`, !canOpenPublicationDashboard({ id, isAdmin: false, roles: [role] }));
}
check("author (no roles) cannot manage or open dashboard", !canManagePublication({ id: "author", roles: [] }, asg) && !canOpenPublicationDashboard({ id: "author", roles: [] }));
check("anonymous cannot open dashboard", !canOpenPublicationDashboard(null));
check("SQL: volume/issue functions are admin-only", /_rpp_is_admin\(p_actor\)/.test(fnBody("set_volume_status")) && /_rpp_is_admin\(p_actor\)/.test(fnBody("set_issue_status")));
check("SQL: publication functions use the paper manager check", ["schedule_publication", "update_publication", "publish_paper"].every((f) => /_rpp_is_manager\(/.test(fnBody(f))));
check("SQL: functions not executable by anon/authenticated", FN.every((f) => new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`).test(sql)));
check("SQL: no client write policies on new tables", !/create policy \w+ on public\.(volumes|issues|publications) for (insert|update|delete|all)/.test(sql));

console.log("\nUnauthorized direct API access is rejected (static route checks):");
{
  const dir = new URL("../app/api/publications/", import.meta.url);
  const files = [];
  const walk = (u) => readdirSync(u).forEach((n) => { const c = new URL(n + (statSync(new URL(n, u)).isDirectory() ? "/" : ""), u); statSync(c).isDirectory() ? walk(c) : n === "route.js" && files.push(c); });
  walk(dir);
  check("found all 8 management route files", files.length === 8, String(files.length));
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const name = f.pathname.split("/api/")[1];
    const mutates = /export async function (POST|PATCH|PUT|DELETE)/.test(src);
    check(`${name}: requires a session (401)`, /getSessionUser\(\)/.test(src) && /status: 401/.test(src));
    if (/volumes|issues/.test(name)) check(`${name}: admin-only (canManageVolumes → 403)`, /canManageVolumes\(me\)/.test(src) && /status: 403/.test(src));
    else if (mutates) check(`${name}: per-paper manager check (canManage → 403)`, /canManage/.test(src) && /status: 403/.test(src));
    else check(`${name}: dashboard gate (canOpenPublicationDashboard → 403)`, /canOpenPublicationDashboard\(me\)/.test(src) && /status: 403/.test(src));
  }
}

console.log("\nPublic API exposes only published records:");
const v = { id: "v1", status: "PUBLISHED", volume_number: 1, year: 2026, title: "V1", created_by: "admin-uuid" };
const i = { id: "i1", volume_id: "v1", status: "PUBLISHED", issue_number: 1, title: "I1", created_by: "admin-uuid" };
const pub = {
  id: "pub1", paper_id: "PAPER-UUID", volume_id: "v1", issue_id: "i1", status: "PUBLISHED", title: "Title",
  abstract: "Abs", authors: [{ name: "A", affiliation: "B", email: "leak@x.edu" }], keywords: ["k"], page_start: 1, page_end: 9,
  doi: "10.1/x", publication_date: "2026-05-01", manuscript_id: "MS-UUID", manuscript_public: false,
  scheduled_by: "EDITOR-UUID", published_by: "EDITOR-UUID", version: 3, storage_key: "abc.pdf",
};
check("fully published chain → visible", isPubliclyVisible(pub, i, v));
check("SCHEDULED publication → hidden", publicPublication({ ...pub, status: "SCHEDULED" }, i, v) === null);
check("published paper in unpublished issue → hidden", publicPublication(pub, { ...i, status: "SCHEDULED" }, v) === null);
check("published paper in unpublished volume → hidden", publicPublication(pub, i, { ...v, status: "DRAFT" }) === null);
check("mismatched issue/volume chain → hidden", publicPublication(pub, { ...i, volume_id: "other" }, v) === null);
check("draft volume / issue not shaped publicly", publicVolume({ ...v, status: "DRAFT" }) === null && publicIssue({ ...i, status: "SCHEDULED" }, v) === null);
{
  const out = publicPublication(pub, i, v);
  const blob = JSON.stringify(out) + JSON.stringify(publicVolume(v)) + JSON.stringify(publicIssue(i, v));
  check("no paper id, user ids, manuscript id or storage key in public output", !/PAPER-UUID|EDITOR-UUID|admin-uuid|MS-UUID|abc\.pdf/.test(blob));
  check("no author emails in public output", !/leak@x\.edu|email/.test(blob));
  check("no version / internal fields", !("version" in out) && !("paper_id" in out) && !("manuscript_id" in out));
  check("public keys are exactly the whitelist", JSON.stringify(Object.keys(out).sort()) === JSON.stringify(["abstract", "authors", "doi", "id", "issue", "keywords", "manuscriptAvailable", "pages", "publicationDate", "title", "volume", "year"]));
  check("manuscript only offered when explicitly public", out.manuscriptAvailable === false && publicPublication({ ...pub, manuscript_public: true }, i, v).manuscriptAvailable === true);
  check("search matches title / author / keyword", matchesSearch(out, "titl") && matchesSearch(out, "a") && matchesSearch(out, "K") && !matchesSearch(out, "zzz"));
}
{
  const cat = read("../lib/publicCatalog.js");
  check("catalogue filters volumes, issues and publications by PUBLISHED", (cat.match(/\.eq\("status", "PUBLISHED"\)/g) || []).length >= 5);
  check("catalogue returns data only via whitelisting shapers", /publicPublication\(/.test(cat) && /publicVolume\(/.test(cat) && /publicIssue\(/.test(cat));
  check("catalogue never touches reviews, decisions, activity, authors or profiles", !/from\("(reviews|editorial_decisions|paper_activity|paper_authors|profiles|paper_assignments|paper_revisions)"\)/.test(cat));
  for (const f of ["../app/api/public/publications/route.js", "../app/api/public/publications/[id]/route.js", "../app/api/public/volumes/route.js", "../app/api/public/volumes/[volumeId]/route.js", "../app/api/public/issues/[issueId]/route.js", "../app/api/public/publications/[id]/manuscript/route.js"]) {
    const src = read(f);
    check(`${f.replace("../app/api/", "")}: read-only, via publicCatalog only`, /from "@\/lib\/publicCatalog"/.test(src) && !/createAdminClient/.test(src) && !/export async function (POST|PATCH|PUT|DELETE)/.test(src));
  }
  check("public manuscript download requires explicit manuscript_public", /manuscript_public/.test(cat) && /isPubliclyVisible\(p, issue, volume\)/.test(cat));
}

console.log("\nConfidential data never leaks (database column grants):");
check("anon/authenticated lose all default privileges on new tables", /revoke all on public\.volumes, public\.issues, public\.publications from anon, authenticated/.test(sql));
{
  const g = sql.match(/grant select \(([^)]*)\)\s+on public\.publications to anon, authenticated/);
  const cols = g ? g[1].split(",").map((c) => c.trim()) : [];
  check("publications column grant found", cols.length > 5);
  check("internal columns NOT granted (paper_id, manuscript_id, scheduled_by, published_by, version)",
    !["paper_id", "manuscript_id", "scheduled_by", "published_by", "version"].some((c) => cols.includes(c)), cols.join(","));
  const gv = sql.match(/grant select \(([^)]*)\)\s+on public\.volumes to anon, authenticated/);
  const gi = sql.match(/grant select \(([^)]*)\)\s+on public\.issues to anon, authenticated/);
  check("created_by not granted on volumes/issues", gv && gi && !/created_by/.test(gv[1]) && !/created_by/.test(gi[1]));
}
check("public RLS requires the full published chain", /status = 'PUBLISHED'\s+and exists \(select 1 from public\.issues i join public\.volumes v on v\.id = i\.volume_id\s+where i\.id = issue_id and i\.status = 'PUBLISHED' and v\.status = 'PUBLISHED'\)/.test(sql));

console.log(`\n${failures === 0 ? "✓ PASS — publication logic is sound." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

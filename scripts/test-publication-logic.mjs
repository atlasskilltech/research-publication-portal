/**
 * No-DB unit tests for Phase 5 publication management (lib/publicationLogic.js)
 * plus STATIC checks of the MySQL workflow service (lib/services/workflow.mjs),
 * the schema (database/migrations/003_publication.mjs) and the route/catalogue
 * sources. Sources are read as text — nothing is executed against a database
 * here (scripts/test-mysql-integration.mjs runs the workflow against MySQL).
 * Run: node scripts/test-publication-logic.mjs
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
const wf = read("../lib/services/workflow.mjs");
const ddl = read("../database/migrations/003_publication.mjs");
/** Body of a top-level function in workflow.mjs (declaration → closing "\n}\n"). */
const fnBody = (name) => {
  const i = wf.search(new RegExp("(?:^|\\n)(?:export )?(?:async )?function " + name + "\\("));
  if (i < 0) return "";
  const end = wf.indexOf("\n}\n", i + 1);
  return end < 0 ? "" : wf.slice(i, end + 2);
};
/** DDL body of one table in 003_publication.mjs. */
const tableDdl = (key) => { const i = ddl.indexOf("createTable(T." + key + ", "); return i < 0 ? "" : ddl.slice(i, ddl.indexOf(");\n", i)); };
/** DDL fragment with backtick-quoted identifiers written as ~name~. */
const q = (t) => t.replaceAll("~", "\\" + "`").replace(/%(\w+)%/g, (_, k) => "$" + "{T." + k + "}");
const FN = ["setVolumeStatus", "setIssueStatus", "schedulePublication", "updatePublication", "publishPaper"];

const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const ACCEPTED = { id: "p", status: "ACCEPTED", submitted_by: "author" };
const ACCEPT_DEC = [{ decision: "ACCEPT", released_at: "2026-10-01T00:00:00Z" }];

console.log("\n=== Phase 5 publication management unit tests ===\n");

console.log("Source parse guard:");
check("all publication state function bodies found", FN.every((f) => fnBody(f).length > 200) && ["volumes", "issues", "publications"].every((t) => tableDdl(t).length > 200), FN.map((f) => `${f}:${fnBody(f).length}`).join(" "));

console.log("\nVolume creation & validation:");
const vol = { volumeNumber: "3", year: "2026", title: "Research Vol 3", description: "" };
check("valid volume accepted (numbers coerced)", validateVolume(vol).ok && validateVolume(vol).value.volume_number === 3);
check("missing title rejected", !validateVolume({ ...vol, title: " " }).ok);
check("volume number 0 rejected", !validateVolume({ ...vol, volumeNumber: 0 }).ok);
check("non-integer volume number rejected", !validateVolume({ ...vol, volumeNumber: "2.5" }).ok);
check("year out of range rejected", !validateVolume({ ...vol, year: 1800 }).ok);
check("over-long description rejected", !validateVolume({ ...vol, description: "x".repeat(5001) }).ok);
check("schema: volume number / year range checks", tableDdl("volumes").includes(q("CHECK (~volume_number~ BETWEEN 1 AND 9999)")) && tableDdl("volumes").includes(q("CHECK (~year~ BETWEEN 1900 AND 2200)")));

console.log("\nIssue creation & volume association:");
const iss = { volumeId: U(1), issueNumber: 2, title: "Spring", publicationDate: "2026-04-01" };
check("valid issue accepted", validateIssue(iss).ok);
check("issue requires a volume", !validateIssue({ ...iss, volumeId: "" }).ok);
check("issue number 0 rejected", !validateIssue({ ...iss, issueNumber: 0 }).ok);
check("impossible date rejected", !validateIssue({ ...iss, publicationDate: "2026-02-30" }).ok);
check("date optional", validateIssue({ ...iss, publicationDate: "" }).ok);
check("issueBelongsToVolume true for its own volume", issueBelongsToVolume({ id: "i", volume_id: U(1) }, U(1)));
check("issueBelongsToVolume false for another volume", !issueBelongsToVolume({ id: "i", volume_id: U(1) }, U(2)));
check("schema: issue FK to volume", tableDdl("issues").includes(q("FOREIGN KEY (~volume_id~) REFERENCES ~%volumes%~ (~id~) ON DELETE RESTRICT")));
check("schema: publication (issue, volume) composite FK enforces issue ∈ volume", tableDdl("publications").includes(q("FOREIGN KEY (~issue_id~, ~volume_id~) REFERENCES ~%issues%~ (~id~, ~volume_id~)")) && tableDdl("issues").includes(q("UNIQUE KEY ~research_issues_id_volume_uq~ (~id~, ~volume_id~)")));
check("service: schedule/update check ISSUE_VOLUME_MISMATCH", /checkIssueAndManuscript\(/.test(fnBody("schedulePublication")) && /checkIssueAndManuscript\(/.test(fnBody("updatePublication")) && /fail\("ISSUE_VOLUME_MISMATCH"\)/.test(fnBody("checkIssueAndManuscript")));

console.log("\nDuplicate prevention:");
check("schema: unique (year, volume_number)", tableDdl("volumes").includes(q("UNIQUE KEY ~research_volumes_year_number_uq~ (~year~, ~volume_number~)")));
check("schema: unique (volume_id, issue_number)", tableDdl("issues").includes(q("UNIQUE KEY ~research_issues_volume_number_uq~ (~volume_id~, ~issue_number~)")));
check("schema: one publication per paper (unique paper_id)", tableDdl("publications").includes(q("UNIQUE KEY ~research_publications_paper_uq~ (~paper_id~)")));
check("schema: unique DOI (case-insensitive collation; NULLs allowed)", tableDdl("publications").includes(q("UNIQUE KEY ~research_publications_doi_uq~ (~doi~)")) && tableDdl("publications").includes(q("~doi~               VARCHAR(255) NULL")) && /COLLATE=utf8mb4_unicode_ci/.test(read("../database/migrate-helpers.mjs")));
check("duplicate volume → friendly 409", dbErrorToHttp({ code: "ER_DUP_ENTRY", errno: 1062, key: "research_volumes_year_number_uq" })?.status === 409
  && /volume with this number/.test(uniqueViolationMessage({ code: "ER_DUP_ENTRY", key: "research_volumes_year_number_uq" })));
check("duplicate issue → friendly 409", /already has an issue/.test(uniqueViolationMessage({ code: "ER_DUP_ENTRY", key: "research_issues_volume_number_uq" })));
check("duplicate publication → friendly 409", /already has a publication/.test(uniqueViolationMessage({ code: "ER_DUP_ENTRY", key: "research_publications_paper_uq" })));
check("duplicate DOI → friendly 409", /already uses this DOI/.test(uniqueViolationMessage({ code: "ER_DUP_ENTRY", key: "research_publications_doi_uq" })));
check("non-unique errors are not treated as duplicates", uniqueViolationMessage({ code: "ER_NO_REFERENCED_ROW_2" }) === null && uniqueViolationMessage({ code: "23505" }) === null);
check("service schedule rejects an existing record (ALREADY_SCHEDULED)", /fail\("ALREADY_SCHEDULED"\)/.test(fnBody("schedulePublication")));
check("eligibility rejects a paper that already has a record", !publicationEligibility({ paper: ACCEPTED, decisions: ACCEPT_DEC, revisions: [], existing: { id: "x" } }).ok);

console.log("\nOnly accepted papers can be scheduled:");
check("ACCEPTED + communicated ACCEPT → eligible", publicationEligibility({ paper: ACCEPTED, decisions: ACCEPT_DEC, revisions: [] }).ok);
check("ACCEPTED but decision not communicated → not eligible", !publicationEligibility({ paper: ACCEPTED, decisions: [{ decision: "ACCEPT", released_at: null }], revisions: [] }).ok);
check("ACCEPTED status without any ACCEPT decision → not eligible", !publicationEligibility({ paper: ACCEPTED, decisions: [{ decision: "MINOR_REVISION", released_at: "t" }], revisions: [] }).ok);
for (const st of ["SUBMITTED", "UNDER_REVIEW"]) check(`${st} → not eligible`, !publicationEligibility({ paper: { ...ACCEPTED, status: st }, decisions: ACCEPT_DEC, revisions: [] }).ok);
check("service schedule requires status ACCEPTED", /paper\.status !== "ACCEPTED"\) throw fail\("NOT_ACCEPTED"\)/.test(fnBody("schedulePublication")));
check("service schedule requires a COMMUNICATED ACCEPT decision", /decision = 'ACCEPT' AND released_at IS NOT NULL/.test(fnBody("schedulePublication")));

console.log("\nRejected / revision-pending papers can't be published:");
check("REJECTED → not eligible", publicationEligibility({ paper: { ...ACCEPTED, status: "REJECTED" }, decisions: ACCEPT_DEC, revisions: [] }).status === 409);
check("REVISION → not eligible", !publicationEligibility({ paper: { ...ACCEPTED, status: "REVISION" }, decisions: ACCEPT_DEC, revisions: [] }).ok);
check("open revision → not eligible even if status says ACCEPTED", !publicationEligibility({ paper: ACCEPTED, decisions: ACCEPT_DEC, revisions: [{ status: "REVISION_IN_PROGRESS" }] }).ok);
check("canPublishPaper: REJECTED paper blocked", !canPublishPaper({ publication: { status: "SCHEDULED" }, paper: { status: "REJECTED" }, issue: { status: "PUBLISHED" } }).ok);
check("canPublishPaper: REVISION paper blocked", !canPublishPaper({ publication: { status: "SCHEDULED" }, paper: { status: "REVISION" }, issue: { status: "PUBLISHED" } }).ok);
for (const f of ["schedulePublication", "publishPaper"]) {
  check(`service ${f} raises PAPER_REJECTED and REVISION_PENDING`, /PAPER_REJECTED/.test(fnBody(f)) && /REVISION_PENDING/.test(fnBody(f)));
}
check("service bulk issue publish only publishes papers still ACCEPTED", /pb\.status = 'SCHEDULED' AND p\.status = 'ACCEPTED'/.test(fnBody("setIssueStatus")));

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
// DOI format is validated by validatePublicationMeta (above); MySQL CHECK has no portable regex.
check("schema: page range + published completeness checks", tableDdl("publications").includes("research_publications_pages_ck") && tableDdl("publications").includes(q("(~page_start~ IS NOT NULL AND ~page_end~ >= ~page_start~)")) && tableDdl("publications").includes(q("~status~ = 'SCHEDULED' OR (~published_at~ IS NOT NULL AND ~publication_date~ IS NOT NULL)")));
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
check("service: volume/issue PUBLISHED is final (ALREADY_PUBLISHED)", /fail\("ALREADY_PUBLISHED"\)/.test(fnBody("setVolumeStatus")) && /fail\("ALREADY_PUBLISHED"\)/.test(fnBody("setIssueStatus")));
check("service: issue publish requires published volume", /fail\("VOLUME_NOT_PUBLISHED"\)/.test(fnBody("setIssueStatus")));
check("service: paper publish requires published issue", /fail\("ISSUE_NOT_PUBLISHED"\)/.test(fnBody("publishPaper")));
check("service: published records can't be edited", /fail\("ALREADY_PUBLISHED"\)/.test(fnBody("updatePublication")));
check("service: publish sets papers.status = PUBLISHED", /SET status = 'PUBLISHED' WHERE id = \?/.test(fnBody("publishPaper")));
check("service: optimistic version check on update + publish", /fail\("STALE"\)/.test(fnBody("updatePublication")) && /fail\("STALE"\)/.test(fnBody("publishPaper")));
check("service: functions lock rows FOR UPDATE", FN.every((f) => /FOR UPDATE/.test(fnBody(f)) || /lockPaper\(tx/.test(fnBody(f))));
check("service: every state change runs in one db.transaction", FN.every((f) => /db\.transaction\(/.test(fnBody(f))));

console.log("\nHistory preservation:");
{
  const pubFns = FN.map(fnBody).join("\n");
  check("publication functions never update/delete reviews, decisions, revisions, manuscripts or authors",
    !/(UPDATE|DELETE FROM)\s+\\`\$\{T\.(reviews|editorialDecisions|paperRevisions|paperManuscripts|paperAuthors)\}/.test(pubFns));
}
// (Policy-alteration check dropped: there are no SQL policies in MySQL; access is shaped in the routes.)
check("publications FK to papers is ON DELETE RESTRICT", tableDdl("publications").includes(q("FOREIGN KEY (~paper_id~) REFERENCES ~%papers%~ (~id~) ON DELETE RESTRICT")));
check("migrations 001–003 present (in order)", ["001_auth.mjs", "002_workflow.mjs", "003_publication.mjs"].every((f) => readdirSync(new URL("../database/migrations/", import.meta.url)).includes(f)));

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
check("service: volume/issue functions are admin-only", /isAdmin\(tx, actorId\)\)\) throw fail\("FORBIDDEN"\)/.test(fnBody("setVolumeStatus")) && /isAdmin\(tx, actorId\)\)\) throw fail\("FORBIDDEN"\)/.test(fnBody("setIssueStatus")));
check("service: publication functions use the paper manager check", ["schedulePublication", "updatePublication", "publishPaper"].every((f) => /isManager\(tx, /.test(fnBody(f))));
// (REVOKE … FROM anon/authenticated and "no client write policies" have no MySQL counterpart: the
// database is never reachable from browsers. Equivalent guard: no client module imports the db/service.)
{
  const files = [];
  const walk = (u) => readdirSync(u).forEach((n) => { const c = new URL(n + (statSync(new URL(n, u)).isDirectory() ? "/" : ""), u); statSync(c).isDirectory() ? walk(c) : /\.(js|jsx|mjs)$/.test(n) && files.push(c); });
  walk(new URL("../app/", import.meta.url)); walk(new URL("../components/", import.meta.url));
  const leaks = files.filter((u) => { const src = readFileSync(u, "utf8"); return /^\s*["']use client["']/.test(src) && /lib\/services|@\/lib\/db|publicCatalog/.test(src); });
  check("no 'use client' module imports the database, services or catalogue", leaks.length === 0, leaks.map((u) => u.pathname).join(","));
}

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
  check("catalogue filters volumes, issues and publications by PUBLISHED", (cat.match(/status = 'PUBLISHED'/g) || []).length >= 5);
  check("catalogue returns data only via whitelisting shapers", /publicPublication\(/.test(cat) && /publicVolume\(/.test(cat) && /publicIssue\(/.test(cat));
  check("catalogue never touches reviews, decisions, activity, authors, users or assignments", !/T\.(reviews|editorialDecisions|paperActivity|paperAuthors|users|paperAssignments|paperRevisions|papers)\b/.test(cat));
  for (const f of ["../app/api/public/publications/route.js", "../app/api/public/publications/[id]/route.js", "../app/api/public/volumes/route.js", "../app/api/public/volumes/[volumeId]/route.js", "../app/api/public/issues/[issueId]/route.js", "../app/api/public/publications/[id]/manuscript/route.js"]) {
    const src = read(f);
    check(`${f.replace("../app/api/", "")}: read-only, via publicCatalog only`, /from "@\/lib\/publicCatalog"/.test(src) && !/createAdminClient/.test(src) && !/export async function (POST|PATCH|PUT|DELETE)/.test(src));
  }
  check("public manuscript download requires explicit manuscript_public", /manuscript_public/.test(cat) && /isPubliclyVisible\(p, issue, volume\)/.test(cat));
}

console.log("\nConfidential data never leaks (catalogue column lists replace the old column GRANTs):");
{
  const cat = read("../lib/publicCatalog.js");
  const list = (name) => { const m = cat.match(new RegExp("const " + name + " = [`\"]([^`\"]*)[`\"]")); return m ? m[1].split(",").map((c) => c.trim().replace(/^[pvi]\./, "")) : []; };
  const pubCols = list("PUB_COLS"), volCols = list("VOL_COLS"), issCols = list("ISS_COLS");
  check("catalogue column lists found", pubCols.length > 5 && volCols.length > 3 && issCols.length > 3);
  check("internal columns never selected (paper_id, scheduled_by, published_by, version)",
    !["paper_id", "scheduled_by", "published_by", "version"].some((c) => pubCols.includes(c)), pubCols.join(","));
  check("manuscript_id (needed for the download check) is stripped by the shaper", !("manuscript_id" in (publicPublication(pub, i, v) || {})));
  check("created_by never selected on volumes/issues", !volCols.includes("created_by") && !issCols.includes("created_by"));
  check("public queries require the full published chain (publication + issue + volume)",
    /JOIN \\`\$\{T\.issues\}\\` i ON i\.id = p\.issue_id AND i\.volume_id = p\.volume_id AND i\.status = 'PUBLISHED'/.test(cat)
    && /JOIN \\`\$\{T\.volumes\}\\` v ON v\.id = i\.volume_id AND v\.status = 'PUBLISHED'/.test(cat) && /WHERE p\.status = 'PUBLISHED'/.test(cat));
}

console.log(`\n${failures === 0 ? "✓ PASS — publication logic is sound." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

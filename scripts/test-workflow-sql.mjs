/**
 * Full editorial workflow against the REAL migrations 0001–0011, applied in the
 * PRODUCTION order (0001–0004, 0010 already live; then 0005–0009, 0011), in an
 * in-memory PostgreSQL (PGlite) with a minimal Supabase-like environment
 * (anon / authenticated / service_role, auth.users, auth.uid(), auth.role(),
 * Supabase default privileges). Nothing touches Supabase or the network.
 *
 * It drives the same writes the API routes make (service role) and checks what
 * each persona can read under RLS (authenticated), end to end:
 *   submit → assign → double-blind peer review → MAJOR revision decision →
 *   author revision → re-review → ACCEPT → volume/issue → publish → public.
 * Plus: function lock-down, decision immutability, user deletion, and
 * re-running every migration (idempotency + 0010 hardening preserved).
 *
 * PGlite is NOT a project dependency. To run:
 *   npm i --no-save @electric-sql/pglite@0.5.8
 * Without PGlite it prints SKIPPED and exits 0 (never a pass it did not run).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

async function loadPGlite() {
  try {
    if (process.env.PGLITE_DIR) {
      const req = createRequire(path.join(process.env.PGLITE_DIR, "package.json"));
      const mod = await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href);
      return mod.PGlite || mod.default?.PGlite;
    }
    return (await import("@electric-sql/pglite")).PGlite;
  } catch {
    return null;
  }
}
const PGlite = await loadPGlite();
if (!PGlite) {
  console.log("\nSKIPPED — PGlite not installed; the workflow SQL tests were NOT run.");
  console.log("Install it without saving: npm i --no-save @electric-sql/pglite@0.5.8\n");
  process.exit(0);
}

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const section = (t) => console.log(`\n${t}`);
const mig = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");

// Production order: 0010 is live before 0005–0009 / 0011 are applied.
const ORDER = [
  "0001_profiles.sql", "0002_rls.sql", "0003_application_no.sql", "0004_user_roles.sql",
  "0010_harden_admin_set_user_roles.sql",
  "0005_submissions.sql", "0006_reviews.sql", "0007_revisions.sql",
  "0008_editorial_decisions.sql", "0009_publication_management.sql", "0011_audit_fixes.sql",
];
const PENDING = ORDER.slice(5);

const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb,
    email_confirmed_at timestamptz
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claim.role', true),
                           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), '')::text $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = {
  A: id(1),  // administrator
  E: id(2),  // editor
  R1: id(3), // peer reviewer
  R2: id(4), // peer reviewer
  D: id(5),  // desk reviewer
  S: id(6),  // SPOC
  AU: id(7), // author
  X: id(8),  // unrelated user
};

const db = new PGlite();
await db.exec(BOOTSTRAP);

async function as(role, sub, sql, params = []) {
  await db.exec("begin");
  try {
    await db.exec(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)",
      [JSON.stringify(sub ? { sub, role, aud: role } : { role })]);
    const r = await db.query(sql, params);
    await db.exec("commit");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await db.exec("rollback");
    return { ok: false, rows: [], error: String(e.message || e) };
  }
}
const svc = (sql, p) => as("service_role", null, sql, p);
const user = (who, sql, p) => as("authenticated", who, sql, p);
const anon = (sql, p) => as("anon", null, sql, p);
const one = async (sql, p) => { const r = await svc(sql, p); if (!r.ok) throw new Error(r.error + " :: " + sql); return r.rows[0]; };
const okRpc = async (label, sql, p) => { const r = await svc(sql, p); check(label, r.ok, r.ok ? "" : r.error); return r.rows[0]; };
const errRpc = async (label, sql, p, code) => { const r = await svc(sql, p); check(label, !r.ok && r.error.includes(code), r.ok ? "unexpectedly succeeded" : r.error); };

// ---------------------------------------------------------------------------
section("Migrations (production order)");
for (const f of ORDER) {
  try { await db.exec(mig(f)); check(`applies ${f}`, true); }
  catch (e) { check(`applies ${f}`, false, e.message); }
}

// Users (handle_new_user creates profiles)
const meta = (name, bt) => JSON.stringify({ name, base_type: bt });
for (const [k, v] of Object.entries(U)) {
  await db.query("insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values ($1,$2,$3,now())",
    [v, `${k.toLowerCase()}@example.edu`, meta(`User ${k}`, k === "AU" ? "STUDENT" : "FACULTY")]);
}
await db.exec(`update public.profiles set is_admin = true where id = '${U.A}';
  insert into public.user_roles (user_id, role) values ('${U.A}', 'ADMINISTRATOR');`);

section("Role management (service role via admin_set_user_roles)");
const setRoles = (target, roles) => svc("select public.admin_set_user_roles($1,$2,$3,$4) r", [U.A, target, roles, []]);
for (const [who, roles] of [["E", ["EDITOR"]], ["R1", ["PEER_REVIEWER"]], ["R2", ["PEER_REVIEWER"]], ["D", ["DESK_REVIEWER"]], ["S", ["SPOC"]]]) {
  const r = await setRoles(U[who], roles);
  check(`grant ${roles} to ${who}`, r.ok, r.error || "");
}
check("signed-in user cannot call admin_set_user_roles", !(await user(U.X, "select public.admin_set_user_roles($1,$2,$3,$4)", [U.A, U.X, ["ADMINISTRATOR"], []])).ok);
check("anon cannot call admin_set_user_roles", !(await anon("select public.admin_set_user_roles($1,$2,$3,$4)", [U.A, U.X, ["ADMINISTRATOR"], []])).ok);

// ---------------------------------------------------------------------------
section("Submission (writes exactly as POST /api/papers)");
const paper = (await one(`insert into public.papers (title, abstract, keywords, school_code, submitted_by, status)
  values ('Graph methods', 'Abstract', '{graphs}', 'SOT', $1, 'SUBMITTED') returning id`, [U.AU])).id;
await one(`insert into public.paper_authors (paper_id, full_name, email, affiliation, is_corresponding, author_order)
  values ($1,'User AU','au@example.edu','Atlas',true,1), ($1,'Co Author','co@example.edu','Atlas',false,2) returning id`, [paper]);
const ms0 = (await one(`insert into public.paper_manuscripts (paper_id, storage_key, original_filename, mime_type, byte_size, sha256, uploaded_by)
  values ($1,'k0','paper.pdf','application/pdf',1000,'aa',$2) returning id`, [paper, U.AU])).id;
await one(`insert into public.paper_activity (paper_id, actor, action, detail) values ($1,$2,'SUBMITTED','{}') returning id`, [paper, U.AU]);
check("paper created with version-0 manuscript", !!paper && !!ms0);

const cnt = async (who, sql, p) => { const r = await (who === "anon" ? anon(sql, p) : user(who, sql, p)); return r.ok ? Number(r.rows[0].n) : `ERR ${r.error}`; };
check("author sees own paper", (await cnt(U.AU, "select count(*) n from public.papers where id=$1", [paper])) === 1);
check("author sees own author list", (await cnt(U.AU, "select count(*) n from public.paper_authors where paper_id=$1", [paper])) === 2);
check("unassigned reviewer sees nothing", (await cnt(U.R1, "select count(*) n from public.papers", [])) === 0);
check("unrelated user sees nothing", (await cnt(U.X, "select count(*) n from public.papers", [])) === 0);
check("anon sees nothing", (await cnt("anon", "select count(*) n from public.papers", [])) === 0);
check("signed-in user cannot insert a paper directly",
  !(await user(U.X, "insert into public.papers (title, submitted_by) values ('x', $1)", [U.X])).ok ||
  (await cnt(U.X, "select count(*) n from public.papers", [])) === 0);

section("Assignment + double-blind review (round 0)");
for (const [who, role] of [["R1", "PEER_REVIEWER"], ["R2", "PEER_REVIEWER"], ["E", "EDITOR"]]) {
  await one(`insert into public.paper_assignments (paper_id, assignee, role, assigned_by) values ($1,$2,$3,$4) returning id`, [paper, U[who], role, U.A]);
}
await one(`update public.papers set status='UNDER_REVIEW' where id=$1 and status='SUBMITTED' returning id`, [paper]);
check("reviewer sees the assigned paper", (await cnt(U.R1, "select count(*) n from public.papers where id=$1", [paper])) === 1);
check("reviewer CANNOT see authors (double-blind at DB)", (await cnt(U.R1, "select count(*) n from public.paper_authors where paper_id=$1", [paper])) === 0);
check("reviewer sees the original manuscript", (await cnt(U.R1, "select count(*) n from public.paper_manuscripts where paper_id=$1", [paper])) === 1);
check("reviewer cannot see co-reviewer's assignment", (await cnt(U.R1, "select count(*) n from public.paper_assignments where paper_id=$1", [paper])) === 1);
check("editor cannot see authors either", (await cnt(U.E, "select count(*) n from public.paper_authors where paper_id=$1", [paper])) === 0);

const review = async (who, round, rec) => (await one(`insert into public.reviews (paper_id, reviewer, round, status, recommendation,
  technical_quality, originality, methodology, clarity, comments_to_author, confidential_to_editor, submitted_at)
  values ($1,$2,$3,'SUBMITTED',$4,4,4,4,4,'Please expand section 3','CONFIDENTIAL-NOTE',now()) returning id`, [paper, who, round, rec])).id;
const rv1 = await review(U.R1, 0, "MAJOR_REVISION");
const rv2 = await review(U.R2, 0, "MINOR_REVISION");
check("incomplete SUBMITTED review rejected by constraint",
  !(await svc(`insert into public.reviews (paper_id, reviewer, round, status) values ($1,$2,0,'SUBMITTED')`, [paper, U.D])).ok);
check("duplicate review for same round rejected",
  !(await svc(`insert into public.reviews (paper_id, reviewer, round) values ($1,$2,0)`, [paper, U.R1])).ok);
check("author CANNOT read reviews (confidential safe)", (await cnt(U.AU, "select count(*) n from public.reviews", [])) === 0);
check("reviewer reads only own review", (await cnt(U.R1, "select count(*) n from public.reviews", [])) === 1);
check("paper editor reads all reviews", (await cnt(U.E, "select count(*) n from public.reviews where paper_id=$1", [paper])) === 2);

section("Editorial decision → MAJOR revision");
check("signed-in user cannot call save_editorial_decision",
  !(await user(U.E, "select public.save_editorial_decision($1,$2,'ACCEPT','x',null,'{}',null)", [paper, U.E])).ok);
await errRpc("non-manager (reviewer) cannot decide",
  "select public.save_editorial_decision($1,$2,'ACCEPT','x',null,'{}',null)", [paper, U.R1], "RPP:FORBIDDEN");
await errRpc("revision decision requires released reviews",
  "select public.save_editorial_decision($1,$2,'MAJOR_REVISION','x',null,'{}',null)", [paper, U.E], "RPP:NO_REVIEWS");
const d0 = await okRpc("editor saves MAJOR_REVISION draft",
  "select public.save_editorial_decision($1,$2,'MAJOR_REVISION','Address reviewer 1.','internal only',$3,now()+interval '14 days') r",
  [paper, U.E, [rv1]]);
const d0v = d0?.r;
await errRpc("stale version cannot be released",
  "select public.release_editorial_decision($1,$2,$3,$4)", [paper, U.E, d0v?.id, 99], "RPP:STALE");
await okRpc("editor communicates the decision",
  "select public.release_editorial_decision($1,$2,$3,$4) r", [paper, U.E, d0v?.id, d0v?.version]);
check("paper is in REVISION", (await one("select status from public.papers where id=$1", [paper])).status === "REVISION");
check("revision round 1 requested", (await one("select status from public.paper_revisions where paper_id=$1 and round=1", [paper]))?.status === "REVISION_REQUESTED");
check("author cannot read editorial_decisions (confidential note)", (await cnt(U.AU, "select count(*) n from public.editorial_decisions", [])) === 0);
check("communicated decision is immutable",
  !(await svc("update public.editorial_decisions set summary='changed' where id=$1", [d0v?.id])).ok);
const authorActs = (await user(U.AU, "select action from public.paper_activity where paper_id=$1", [paper])).rows.map((r) => r.action);
check("author activity shows allowlisted events only",
  authorActs.includes("REVISION_REQUESTED") && authorActs.includes("DECISION_COMMUNICATED")
  && !authorActs.includes("DECISION_CREATED") && !authorActs.includes("ASSIGNED"), authorActs.join(","));

section("Author revision + re-review");
await errRpc("other user cannot attach a revision",
  "select public.attach_revision_manuscript($1,1,$2,'kx','x.pdf','application/pdf',1,'x')", [paper, U.X], "RPP:FORBIDDEN");
await okRpc("author attaches revised manuscript v1",
  "select public.attach_revision_manuscript($1,1,$2,'k1','v1.pdf','application/pdf',1200,'bb')", [paper, U.AU]);
await errRpc("submit needs responses",
  "select public.submit_paper_revision($1,1,$2,'[]'::jsonb)", [paper, U.AU], "RPP:NO_RESPONSES");
const responses = JSON.stringify([{ review_id: rv1, comment: "expand 3", response: "done", addressed: true }]);
await okRpc("author saves draft responses", "select public.save_revision_draft($1,1,$2,$3::jsonb)", [paper, U.AU, responses]);
await okRpc("author submits the revision", "select public.submit_paper_revision($1,1,$2,$3::jsonb)", [paper, U.AU, responses]);
await errRpc("second submit rejected", "select public.submit_paper_revision($1,1,$2,$3::jsonb)", [paper, U.AU, responses], "RPP:ALREADY_SUBMITTED");
check("reviewer cannot yet see unreleased v1", (await cnt(U.R1, "select count(*) n from public.paper_manuscripts where paper_id=$1", [paper])) === 1);
check("version history kept (v0 + v1)", Number((await one("select count(*) n from public.paper_manuscripts where paper_id=$1", [paper])).n) === 2);
await okRpc("editor releases revision for re-review", "select public.start_revision_rereview($1,1,$2,null)", [paper, U.E]);
check("paper back UNDER_REVIEW at round 1",
  (await one("select status||':'||current_round s from public.papers where id=$1", [paper])).s === "UNDER_REVIEW:1");
check("reviewer now sees v1", (await cnt(U.R1, "select count(*) n from public.paper_manuscripts where paper_id=$1", [paper])) === 2);

section("Final decision → ACCEPT");
await errRpc("decision needs a submitted review in the current round",
  "select public.save_editorial_decision($1,$2,'ACCEPT','Accepted.',null,'{}',null)", [paper, U.E], "RPP:NO_SUBMITTED_REVIEWS");
await review(U.R1, 1, "ACCEPT");
const d1 = (await okRpc("editor saves ACCEPT", "select public.save_editorial_decision($1,$2,'ACCEPT','Accepted.',null,'{}',null) r", [paper, U.E]))?.r;
await okRpc("editor communicates ACCEPT", "select public.release_editorial_decision($1,$2,$3,$4)", [paper, U.E, d1?.id, d1?.version]);
check("paper ACCEPTED", (await one("select status from public.papers where id=$1", [paper])).status === "ACCEPTED");

section("Volume / issue / publication");
const vol = (await one(`insert into public.volumes (volume_number, year, title, created_by) values (1, 2026, 'Volume 1', $1) returning id`, [U.A])).id;
const iss = (await one(`insert into public.issues (volume_id, issue_number, title, created_by) values ($1, 1, 'Issue 1', $2) returning id`, [vol, U.A])).id;
const ms1 = (await one("select id from public.paper_manuscripts where paper_id=$1 and version=1", [paper])).id;
const pub = (await okRpc("editor schedules the accepted paper",
  `select public.schedule_publication($1,$2,$3,$4,'Graph methods','Abstract',$5::jsonb,'{graphs}',1,10,'10.1234/rpp.1',null,$6,true) r`,
  [paper, U.E, vol, iss, JSON.stringify([{ name: "User AU", affiliation: "Atlas" }]), ms1]))?.r;
await errRpc("duplicate scheduling rejected",
  `select public.schedule_publication($1,$2,$3,$4,'t','a','[{"name":"x"}]'::jsonb,'{}',null,null,null,null,null,false)`,
  [paper, U.E, vol, iss], "RPP:ALREADY_SCHEDULED");
await errRpc("publish blocked until issue is published",
  "select public.publish_paper($1,$2,1)", [pub, U.E], "RPP:ISSUE_NOT_PUBLISHED");
await errRpc("editor cannot publish a volume (admin only)",
  "select public.set_volume_status($1,$2,'PUBLISHED')", [vol, U.E], "RPP:FORBIDDEN");
await errRpc("issue publish needs published volume",
  "select public.set_issue_status($1,$2,'PUBLISHED',true)", [iss, U.A], "RPP:VOLUME_NOT_PUBLISHED");
check("anon cannot see draft volume", (await cnt("anon", "select count(*) n from public.volumes", [])) === 0);
await okRpc("admin publishes volume", "select public.set_volume_status($1,$2,'PUBLISHED')", [vol, U.A]);
const n = (await okRpc("admin publishes issue (+ its scheduled papers)", "select public.set_issue_status($1,$2,'PUBLISHED',true) r", [iss, U.A]))?.r;
check("one paper published via the issue", n === 1, String(n));
check("paper PUBLISHED", (await one("select status from public.papers where id=$1", [paper])).status === "PUBLISHED");

section("Public visibility");
const pubRow = await anon("select id, title, authors, doi, manuscript_public from public.publications where status='PUBLISHED'");
check("anon reads the published record (safe columns)", pubRow.ok && pubRow.rows.length === 1, pubRow.error || "");
check("anon cannot read internal paper_id", !(await anon("select paper_id from public.publications")).ok);
check("anon cannot read manuscript_id", !(await anon("select manuscript_id from public.publications")).ok);
check("anon still sees no papers / authors / manuscripts",
  (await cnt("anon", "select count(*) n from public.papers", [])) === 0 &&
  (await cnt("anon", "select count(*) n from public.paper_authors", [])) === 0 &&
  (await cnt("anon", "select count(*) n from public.paper_manuscripts", [])) === 0);
const acts2 = (await user(U.AU, "select action from public.paper_activity where paper_id=$1", [paper])).rows.map((r) => r.action);
check("author is told the paper was published", acts2.includes("PAPER_PUBLISHED"));

section("Rejection path + deletions");
const p2 = (await one(`insert into public.papers (title, submitted_by, status) values ('Weak paper', $1, 'UNDER_REVIEW') returning id`, [U.AU])).id;
await one(`insert into public.paper_assignments (paper_id, assignee, role, assigned_by) values ($1,$2,'EDITOR',$3), ($1,$4,'PEER_REVIEWER',$3) returning id`, [p2, U.E, U.A, U.R2]);
await one(`insert into public.reviews (paper_id, reviewer, round, status, recommendation, technical_quality, originality, methodology, clarity, submitted_at)
  values ($1,$2,0,'SUBMITTED','REJECT',1,1,1,1,now()) returning id`, [p2, U.R2]);
const d2 = (await okRpc("editor saves REJECT", "select public.save_editorial_decision($1,$2,'REJECT','Out of scope.',null,'{}',null) r", [p2, U.E]))?.r;
await okRpc("editor communicates REJECT", "select public.release_editorial_decision($1,$2,$3,$4)", [p2, U.E, d2?.id, d2?.version]);
await errRpc("rejected paper cannot be scheduled",
  `select public.schedule_publication($1,$2,$3,$4,'t','a','[{"name":"x"}]'::jsonb,'{}',null,null,null,null,null,false)`,
  [p2, U.A, vol, iss], "RPP:PAPER_REJECTED");
const delPaper = await svc("delete from public.papers where id=$1", [p2]);
check("rejected paper with a communicated decision can be deleted (0011)", delPaper.ok, delPaper.error || "");
// Supabase Auth deletes users with its own privileged role, so run as the DB owner.
const ownerExec = async (sql, p) => { try { await db.query(sql, p); return { ok: true }; } catch (e) { return { ok: false, error: String(e.message) }; } };
const delEditor = await ownerExec("delete from auth.users where id=$1", [U.E]);
check("editor who communicated decisions can be deleted (0011)", delEditor.ok, delEditor.error || "");
check("decision history survives with decider cleared",
  Number((await one("select count(*) n from public.editorial_decisions where paper_id=$1 and decided_by is null", [paper])).n) === 2);
check("published paper cannot be deleted (publication restricts)", !(await svc("delete from public.papers where id=$1", [paper])).ok);
const delAdmin = await ownerExec("delete from auth.users where id=$1", [U.A]);
check("last administrator cannot be deleted", !delAdmin.ok && delAdmin.error.includes("RPP_LAST_ADMIN"), delAdmin.error || "deleted!");

section("Re-running migrations");
for (const f of PENDING) {
  try { await db.exec(mig(f)); check(`re-run ${f} is safe`, true); } catch (e) { check(`re-run ${f} is safe`, false, e.message); }
}
// Re-running 0004 (e.g. the apply script WITHOUT a filter) would restore the
// pre-0010 function. Verify 0010 must therefore never be followed by 0004.
await db.exec(mig("0004_user_roles.sql"));
const hardened = (await db.query(`select pg_get_functiondef('public.admin_set_user_roles(uuid,uuid,text[],text[])'::regprocedure) like '%RPP_FORBIDDEN%' h`)).rows[0].h;
check("WARNING-CHECK: re-running 0004 drops the 0010 hardening (documents the hazard)", hardened === false,
  hardened ? "0004 no longer overrides 0010" : "confirmed: 0004 must never be re-applied");
await db.exec(mig("0010_harden_admin_set_user_roles.sql"));

console.log(failures ? `\n✗ FAIL — ${failures} check(s) failed.\n` : "\n✓ PASS — full workflow holds on migrations 0001–0011 (production order).\n");
process.exit(failures ? 1 : 0);

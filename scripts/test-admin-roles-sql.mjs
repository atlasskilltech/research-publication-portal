/**
 * Executable SQL regression test for the admin_set_user_roles privilege-
 * escalation fix (migration 0010). Runs the REAL migrations 0001–0004 (+0010)
 * in an in-memory PostgreSQL (PGlite — Postgres compiled to WebAssembly) with a
 * minimal Supabase-like setup:
 *   - roles anon / authenticated / service_role (service_role BYPASSRLS)
 *   - auth.users, auth.uid(), auth.role() reading request.jwt.claims
 *   - Supabase's default privileges: everything created in `public` is granted
 *     to anon, authenticated and service_role (this is what made 0004 unsafe)
 * API calls are simulated exactly the way PostgREST runs them:
 *   BEGIN; SET LOCAL ROLE <role>; set_config('request.jwt.claims', <jwt>, true); <call>; COMMIT
 *
 * Nothing here connects to Supabase or any network service.
 *
 * PGlite is NOT a project dependency. To run:
 *   npm i --no-save @electric-sql/pglite@0.5.8   (or)
 *   PGLITE_DIR=/path/containing/node_modules node scripts/test-admin-roles-sql.mjs
 * Without PGlite the script prints SKIPPED and exits 0 — it never reports a pass
 * it did not run.
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
    const mod = await import("@electric-sql/pglite");
    return mod.PGlite;
  } catch {
    return null;
  }
}

const PGlite = await loadPGlite();
if (!PGlite) {
  console.log("\nSKIPPED — PGlite not installed; the SQL escalation tests were NOT run.");
  console.log("Install it without saving: npm i --no-save @electric-sql/pglite@0.5.8\n");
  process.exit(0);
}

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const mig = (f) => readFileSync(new URL(`../supabase/migrations/${f}`, import.meta.url), "utf8");
const FN = "public.admin_set_user_roles(uuid,uuid,text[],text[])";

const A = "00000000-0000-4000-8000-00000000000a"; // administrator (protected)
const P = "00000000-0000-4000-8000-00000000000b"; // second administrator (protected original admin)
const S = "00000000-0000-4000-8000-00000000000c"; // ordinary student (attacker)
const T = "00000000-0000-4000-8000-00000000000d"; // ordinary faculty (target of legit changes)
const PROTECTED = ["p@example.edu"];

// Minimal Supabase-like environment. auth.uid()/auth.role() mirror Supabase's
// definitions (legacy request.jwt.claim.* first, then request.jwt.claims).
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

async function freshDb({ with0010 = false } = {}) {
  const db = new PGlite();
  await db.exec(BOOTSTRAP);
  for (const f of ["0001_profiles.sql", "0002_rls.sql", "0003_application_no.sql", "0004_user_roles.sql"]) await db.exec(mig(f));
  await db.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('${A}', 'a@example.edu', '{"name":"Admin A","base_type":"FACULTY"}'),
      ('${P}', 'p@example.edu', '{"name":"Admin P","base_type":"FACULTY"}'),
      ('${S}', 's@example.edu', '{"name":"Student S","base_type":"STUDENT"}'),
      ('${T}', 't@example.edu', '{"name":"Faculty T","base_type":"FACULTY"}');
    update public.profiles set is_admin = true where id in ('${A}', '${P}');
    insert into public.user_roles (user_id, role) values ('${A}', 'ADMINISTRATOR'), ('${P}', 'ADMINISTRATOR');
    -- S holds a role granted by A, so S can read A's id from user_roles.assigned_by.
    insert into public.user_roles (user_id, role, assigned_by) values ('${S}', 'PEER_REVIEWER', '${A}');
  `);
  if (with0010) await db.exec(mig("0010_harden_admin_set_user_roles.sql"));
  return db;
}

const CALLER_ROLES = new Set(["anon", "authenticated", "service_role"]);
/** Run `sql` the way PostgREST would for a request with this role + JWT claims. */
async function asCaller(db, role, claims, sql, params = []) {
  if (role && !CALLER_ROLES.has(role)) throw new Error("bad test role");
  await db.exec("begin");
  try {
    if (role) {
      await db.exec(`set local role ${role}`);
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || {})]);
    }
    const r = await db.query(sql, params);
    await db.exec("commit");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await db.exec("rollback");
    return { ok: false, error: String(e.message || e), code: e.code };
  }
}
const RPC = "select public.admin_set_user_roles($1::uuid, $2::uuid, $3::text[], $4::text[]) as r";
const jwt = (sub, role = "authenticated") => ({ sub, role, aud: role });
const SERVICE = { role: "service_role" }; // service-role/secret key: no sub
const isAdmin = async (db, id) => (await db.query("select is_admin from public.profiles where id = $1", [id])).rows[0]?.is_admin;
const rolesOf = async (db, id) => (await db.query("select role from public.user_roles where user_id = $1 order by role", [id])).rows.map((r) => r.role);

console.log("\n=== admin_set_user_roles — executable SQL escalation tests (PGlite) ===\n");

// ---------------------------------------------------------------------------
console.log("Before 0010 (reproduces the vulnerability — proves the harness is faithful):");
{
  const db = await freshDb();
  const r1 = await db.query(`select has_function_privilege('authenticated', '${FN}', 'execute') a, has_function_privilege('anon', '${FN}', 'execute') b`);
  check("0004 leaves EXECUTE granted to authenticated and anon", r1.rows[0].a === true && r1.rows[0].b === true);
  const ex = await asCaller(db, "authenticated", jwt(S), RPC, [A, S, ["ADMINISTRATOR"], PROTECTED]);
  // The 0002 trigger resets is_admin for 'authenticated' callers, but the role
  // rows are still written: the student grants themselves ADMINISTRATOR + EDITOR.
  const ex3 = await asCaller(db, "authenticated", jwt(S), RPC, [A, S, ["ADMINISTRATOR", "EDITOR", "PEER_REVIEWER"], PROTECTED]);
  check("signed-in student's direct RPC call SUCCEEDS (spoofing admin A as p_actor)", ex.ok && ex3.ok, ex.error || ex3.error || "");
  check("…and writes ADMINISTRATOR + EDITOR role rows for themselves", JSON.stringify(await rolesOf(db, S)) === JSON.stringify(["ADMINISTRATOR", "EDITOR", "PEER_REVIEWER"]));
  check("…(is_admin itself held back only by the 0002 trigger)", (await isAdmin(db, S)) === false);
  const db2 = await freshDb();
  const ex2 = await asCaller(db2, "anon", { role: "anon" }, RPC, [T, S, ["ADMINISTRATOR"], []]);
  check("ANONYMOUS caller (anon key only, random p_actor) makes a user a full admin (is_admin = true)", ex2.ok && (await isAdmin(db2, S)) === true, ex2.error || "");
  const ex4 = await asCaller(db2, "anon", { role: "anon" }, RPC, [T, A, [], []]);
  check("ANONYMOUS caller demotes a non-protected admin", ex4.ok && (await isAdmin(db2, A)) === false, ex4.error || "");
  await db.close(); await db2.close();
}

// ---------------------------------------------------------------------------
console.log("\nAfter 0010 — direct API (PostgREST) calls by end users:");
{
  const db = await freshDb({ with0010: true });
  const g = (await db.query(`select has_function_privilege('anon', '${FN}', 'execute') anon,
                                    has_function_privilege('authenticated', '${FN}', 'execute') auth,
                                    has_function_privilege('service_role', '${FN}', 'execute') svc`)).rows[0];
  check("anon cannot execute", g.anon === false);
  check("authenticated cannot execute", g.auth === false);
  check("service_role can execute", g.svc === true);
  const acl = (await db.query(`select coalesce(string_agg(case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end, ',' order by 1), '') g
                                 from pg_proc p, aclexplode(p.proacl) x where p.oid = '${FN}'::regprocedure and x.privilege_type = 'EXECUTE'`)).rows[0].g.split(",");
  check("no EXECUTE for PUBLIC; only owner + service_role", !acl.includes("PUBLIC") && acl.includes("service_role") && !acl.includes("anon") && !acl.includes("authenticated"), acl.join(","));

  const attacks = [
    ["student, p_actor = admin A (spoof)", "authenticated", jwt(S), [A, S, ["ADMINISTRATOR"], PROTECTED]],
    ["student, p_actor = self", "authenticated", jwt(S), [S, S, ["ADMINISTRATOR"], PROTECTED]],
    ["student promotes someone else", "authenticated", jwt(S), [A, T, ["ADMINISTRATOR"], PROTECTED]],
    ["student demotes admin P", "authenticated", jwt(S), [A, P, [], []]],
    ["anon, p_actor = admin A", "anon", { role: "anon" }, [A, S, ["ADMINISTRATOR"], []]],
    ["admin's OWN user token (must use the server API)", "authenticated", jwt(A), [A, T, ["ADMINISTRATOR"], PROTECTED]],
  ];
  for (const [label, role, claims, args] of attacks) {
    const r = await asCaller(db, role, claims, RPC, args);
    check(`refused: ${label}`, !r.ok && /permission denied/i.test(r.error), r.ok ? "CALL SUCCEEDED" : r.code);
  }
  check("nobody was promoted", (await isAdmin(db, S)) === false && (await isAdmin(db, T)) === false);
  check("admin P still admin", (await isAdmin(db, P)) === true);
  await db.close();
}

// ---------------------------------------------------------------------------
console.log("\nAfter 0010 — defence in depth if EXECUTE is ever re-granted by mistake:");
{
  const db = await freshDb({ with0010: true });
  await db.exec(`grant execute on function ${FN} to anon, authenticated`); // simulate a future regression
  const r1 = await asCaller(db, "authenticated", jwt(S), RPC, [A, S, ["ADMINISTRATOR"], PROTECTED]);
  check("student spoofing admin A's id is still refused", !r1.ok && /RPP_FORBIDDEN/.test(r1.error), r1.ok ? "CALL SUCCEEDED" : r1.error);
  const r2 = await asCaller(db, "anon", { role: "anon" }, RPC, [A, S, ["ADMINISTRATOR"], []]);
  check("anon spoofing admin A's id is still refused", !r2.ok && /RPP_FORBIDDEN/.test(r2.error), r2.ok ? "CALL SUCCEEDED" : r2.error);
  const r3 = await asCaller(db, "authenticated", jwt(A), RPC, [A, T, ["PEER_REVIEWER"], PROTECTED]);
  check("even a real admin's end-user token is refused (server API only)", !r3.ok && /RPP_FORBIDDEN/.test(r3.error), r3.ok ? "CALL SUCCEEDED" : r3.error);
  check("still nobody promoted", (await isAdmin(db, S)) === false && (await rolesOf(db, T)).length === 0);
  await db.close();
}

// ---------------------------------------------------------------------------
console.log("\nAfter 0010 — service role (the server API) must still require a genuine admin actor:");
{
  const db = await freshDb({ with0010: true });
  for (const [label, actor] of [["non-admin actor", S], ["unknown actor id", "00000000-0000-4000-8000-0000000000ff"], ["null actor", null]]) {
    const r = await asCaller(db, "service_role", SERVICE, RPC, [actor, T, ["ADMINISTRATOR"], PROTECTED]);
    check(`refused: ${label}`, !r.ok && /RPP_FORBIDDEN/.test(r.error), r.ok ? "CALL SUCCEEDED" : r.error);
  }
  check("target unchanged", (await isAdmin(db, T)) === false && (await rolesOf(db, T)).length === 0);

  console.log("\n  Legitimate administrator role management (exactly as app/api/admin/users/[id] calls it):");
  const ok1 = await asCaller(db, "service_role", SERVICE, RPC, [A, T, ["PEER_REVIEWER", "EDITOR"], PROTECTED]);
  check("admin grants reviewer + editor", ok1.ok && JSON.stringify(ok1.rows[0].r.roles) === JSON.stringify(["EDITOR", "PEER_REVIEWER"]) && ok1.rows[0].r.is_admin === false, ok1.error || "");
  const ok2 = await asCaller(db, "service_role", SERVICE, RPC, [A, T, ["ADMINISTRATOR", "EDITOR"], PROTECTED]);
  check("admin promotes to ADMINISTRATOR (is_admin kept in lockstep)", ok2.ok && (await isAdmin(db, T)) === true && JSON.stringify(await rolesOf(db, T)) === JSON.stringify(["ADMINISTRATOR", "EDITOR"]), ok2.error || "");
  const ok3 = await asCaller(db, "service_role", SERVICE, RPC, [A, T, [], PROTECTED]);
  check("admin revokes everything (is_admin false, no roles)", ok3.ok && (await isAdmin(db, T)) === false && (await rolesOf(db, T)).length === 0, ok3.error || "");
  const demoted = await asCaller(db, "service_role", SERVICE, RPC, [T, S, ["ADMINISTRATOR"], PROTECTED]);
  check("a just-demoted admin can no longer act", !demoted.ok && /RPP_FORBIDDEN/.test(demoted.error), demoted.error || "CALL SUCCEEDED");
  const self = await asCaller(db, "service_role", SERVICE, RPC, [A, A, [], PROTECTED]);
  check("RPP_SELF still enforced", !self.ok && /RPP_SELF/.test(self.error), self.error || "");
  const prot = await asCaller(db, "service_role", SERVICE, RPC, [A, P, [], PROTECTED]);
  check("RPP_PROTECTED still enforced", !prot.ok && /RPP_PROTECTED/.test(prot.error) && (await isAdmin(db, P)) === true, prot.error || "");
  const bad = await asCaller(db, "service_role", SERVICE, RPC, [A, T, ["SUPERUSER"], PROTECTED]);
  check("RPP_INVALID_ROLE still enforced", !bad.ok && /RPP_INVALID_ROLE/.test(bad.error), bad.error || "");
  const nf = await asCaller(db, "service_role", SERVICE, RPC, [A, "00000000-0000-4000-8000-0000000000ee", ["SPOC"], PROTECTED]);
  check("RPP_NOT_FOUND still enforced", !nf.ok && /RPP_NOT_FOUND/.test(nf.error), nf.error || "");
  const sql = await asCaller(db, null, null, RPC, [A, T, ["SPOC"], PROTECTED]); // direct SQL session (no JWT)
  check("direct SQL session with a genuine admin actor still works", sql.ok && JSON.stringify(await rolesOf(db, T)) === JSON.stringify(["SPOC"]), sql.error || "");
  const sqlBad = await asCaller(db, null, null, RPC, [S, T, ["ADMINISTRATOR"], PROTECTED]);
  check("direct SQL session with a non-admin actor is refused", !sqlBad.ok && /RPP_FORBIDDEN/.test(sqlBad.error), sqlBad.error || "CALL SUCCEEDED");
  await db.close();
}

// ---------------------------------------------------------------------------
console.log("\nOther escalation paths stay closed (tables written directly through the API):");
{
  const db = await freshDb({ with0010: true });
  const ins = await asCaller(db, "authenticated", jwt(S), "insert into public.user_roles (user_id, role) values ($1, 'ADMINISTRATOR')", [S]);
  check("student cannot insert an ADMINISTRATOR role row", !ins.ok && /row-level security/i.test(ins.error), ins.ok ? "INSERT SUCCEEDED" : ins.code);
  await asCaller(db, "authenticated", jwt(S), "update public.profiles set is_admin = true where id = $1", [S]);
  check("student cannot set their own is_admin", (await isAdmin(db, S)) === false);
  const read = await asCaller(db, "authenticated", jwt(S), "select assigned_by from public.user_roles where user_id = $1", [S]);
  check("(context) a student CAN learn an admin's id via user_roles.assigned_by — why p_actor must not be trusted", read.ok && read.rows[0]?.assigned_by === A);
  const definers = (await db.query(`
    select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'execute') order by 1`)).rows.map((r) => r.f);
  check("only remaining SECURITY DEFINER fn callable by users is current_user_is_admin() (read-only, own row)",
    JSON.stringify(definers) === JSON.stringify(["current_user_is_admin()"]), definers.join(", "));
  await db.close();
}

// ---------------------------------------------------------------------------
console.log("\nMigration properties:");
{
  const db = await freshDb({ with0010: true });
  const f = (await db.query(`select prosecdef, proconfig from pg_proc where oid = '${FN}'::regprocedure`)).rows[0];
  check("SECURITY DEFINER", f.prosecdef === true);
  check("pinned search_path = public, pg_temp", JSON.stringify(f.proconfig) === JSON.stringify(["search_path=public, pg_temp"]), JSON.stringify(f.proconfig));
  let again = null;
  try { await db.exec(mig("0010_harden_admin_set_user_roles.sql")); again = "ok"; } catch (e) { again = e.message; }
  check("0010 is idempotent (re-applies cleanly)", again === "ok", again);
  const g = (await db.query(`select has_function_privilege('authenticated', '${FN}', 'execute') a`)).rows[0];
  check("grants still correct after re-apply", g.a === false);
  check("0010 applies on a database with ONLY 0001–0004 (independent of 0005–0009)", true);
  const text = mig("0010_harden_admin_set_user_roles.sql").replace(/--.*$/gm, "");
  check("0010 references no 0005–0009 objects", !/\b(papers|paper_[a-z_]+|reviews|editorial_decisions|volumes|issues|publications)\b/.test(text));
  await db.close();
}

console.log(`\n${failures === 0 ? "✓ PASS — escalation is closed; legitimate admin management works." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

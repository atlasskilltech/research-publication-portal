/**
 * Exercises the REAL registration form path against the running app: the
 * student Application-Number verification works end-to-end, invalid numbers
 * are rejected, and the created account is a non-admin, unverified,
 * passwordless STUDENT in MySQL. Self-cleaning.
 *
 *   /api/student-check 2507316  → 200 ok           (valid, through the app)
 *   /api/student-check 0000000  → 422              (invalid rejected)
 *   /api/register STUDENT 2507316 → 201            (account created; SMTP may be off → emailSent:false)
 *   /api/register same app no. again → 409          (one account per application number)
 *   /api/register STUDENT 0000000 → 422, no account created
 *
 * Prereq: app running with a working STUDENT_CHECK_API_KEY.
 * Run: node scripts/test-register-form.mjs http://localhost:3001   (DB_* = the app's DB)
 */
import { makeHarness } from "./lib/test-db.mjs";

const h = makeHarness(process.argv[2]);
const { check } = h;
const br = h.browser();
const post = (p, json) => br.api(p, { method: "POST", json });

async function main() {
  console.log(`\n=== Registration form path tests (app ${h.BASE}) ===\n`);
  if (await h.db.one(`SELECT 1 AS x FROM \`${h.T.users}\` WHERE applicationNo = '2507316'`)) {
    check("precondition: application number 2507316 is free", false, "already registered — test cannot run");
    return;
  }
  console.log("Verification pre-check (/api/student-check):");
  { const r = await post("/api/student-check", { applicationNo: "2507316" }); check("valid 2507316 → 200 ok", r.status === 200 && r.data?.ok === true, `status ${r.status}`); }
  { const r = await post("/api/student-check", { applicationNo: "0000000" }); check("invalid 0000000 → 422 not found", r.status === 422, `status ${r.status}`); }

  console.log("\nFull registration submit (/api/register):");
  const goodEmail = h.email("form");
  {
    const r = await post("/api/register", { name: "Form Test", email: goodEmail, baseType: "STUDENT", school: "ISDI", applicationNo: "2507316" });
    check("valid student 2507316 → 201 created", r.status === 201 && r.data?.ok === true, `status ${r.status} ${r.data?.error || ""}`);
    const u = await h.track(goodEmail);
    const row = u ? await h.db.one(`SELECT applicationNo, isAdmin, baseType, emailVerified, passwordHash, status FROM \`${h.T.users}\` WHERE id = ?`, [u.id]) : null;
    check("account created, unverified (awaiting email), no password", !!row && !row.emailVerified && row.passwordHash === null);
    check("applicationNo = 2507316", row?.applicationNo === "2507316", String(row?.applicationNo));
    check("isAdmin forced false, no roles", row?.isAdmin === false && Number((await h.db.one(`SELECT COUNT(*) AS n FROM \`${h.T.userRoles}\` WHERE user_id = ?`, [u?.id])).n) === 0);
    check("baseType STUDENT, status ACTIVE", row?.baseType === "STUDENT" && row?.status === "ACTIVE");
    check("a single-use INVITE token was issued (hash only stored)", !!(await h.db.one(`SELECT 1 AS x FROM \`${h.T.authTokens}\` WHERE user_id = ? AND purpose = 'INVITE' AND consumed_at IS NULL`, [u?.id])));
  }
  {
    const r = await post("/api/register", { name: "Dup", email: h.email("dup"), baseType: "STUDENT", school: "ISDI", applicationNo: " 2507316 " });
    check("same application number again → 409", r.status === 409, `status ${r.status}`);
    const r2 = await post("/api/register", { name: "Dup mail", email: goodEmail.toUpperCase(), baseType: "FACULTY" });
    check("same email (different case) → 409, no duplicate account", r2.status === 409 && Number((await h.db.one(`SELECT COUNT(*) AS n FROM \`${h.T.users}\` WHERE email = ?`, [goodEmail])).n) === 1, `status ${r2.status}`);
  }
  {
    const r = await post("/api/register", { name: "Bypass", email: h.email("bypass"), baseType: "FACULTY", isAdmin: true, roles: ["ADMINISTRATOR"] });
    const u = await h.track(r.data && r.status === 201 ? (await h.db.one(`SELECT email FROM \`${h.T.users}\` WHERE name = 'Bypass' ORDER BY createdAt DESC LIMIT 1`))?.email : "");
    check("client-supplied isAdmin/roles ignored (faculty created as non-admin)", r.status === 201 && u && u.is_admin === false, `status ${r.status}`);
  }
  const badEmail = h.email("bad");
  {
    const r = await post("/api/register", { name: "Bad App", email: badEmail, baseType: "STUDENT", school: "ISDI", applicationNo: "0000000" });
    check("invalid application number → 422 (registration refused)", r.status === 422, `status ${r.status}`);
    check("no account created for the invalid attempt", !(await h.track(badEmail)));
  }
}
main().catch(h.fail).finally(() => h.finish("registration form"));

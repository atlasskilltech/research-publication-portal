/**
 * Email-restriction policy test — ZERO side effects (no account created, no
 * email sent). It submits STUDENT registrations with a deliberately invalid
 * application number, so the request is rejected BEFORE any account is created.
 * WHICH field the 422 cites tells whether the email itself was accepted:
 *   - email rejected  → issues.email present
 *   - email accepted  → issues.applicationNo present, issues.email absent
 *
 * Proves: sf48116@gmail.com (allow-listed exception) is accepted; an unrelated
 * Gmail is rejected; the university domain works; nothing is written to MySQL.
 *
 * Run: node scripts/test-email-policy.mjs http://localhost:3001   (DB_* = the app's DB)
 */
import { makeHarness } from "./lib/test-db.mjs";

const h = makeHarness(process.argv[2]);
const { check } = h;
const br = h.browser();
const register = (email) => br.api("/api/register", { method: "POST", json: { name: "Policy Test", email, baseType: "STUDENT", school: "ISDI", applicationNo: "0000000" } });
const noUser = async (email) => !(await h.db.one(`SELECT 1 AS x FROM \`${h.T.users}\` WHERE email = ?`, [email.toLowerCase()]));

async function main() {
  console.log(`\n=== Email-restriction policy tests (app ${h.BASE}) ===\n`);
  const before = Number((await h.db.one(`SELECT COUNT(*) AS n FROM \`${h.T.users}\``)).n);

  { const email = "someone.random.999@gmail.com"; const r = await register(email);
    check("unrelated Gmail rejected by email policy", r.status === 422 && !!r.data?.issues?.email, `status ${r.status}`);
    check("  → no account created", await noUser(email)); }
  { const email = "sf48116@gmail.com"; const r = await register(email);
    check("sf48116@gmail.com ACCEPTED by email policy (fails only on app no.)", r.status === 422 && !!r.data?.issues?.applicationNo && !r.data?.issues?.email, `status ${r.status}`); }
  { const email = `policy.uni.test.${Date.now()}@atlasuniversity.edu.in`; const r = await register(email);
    check("university email accepted by policy (fails only on app no.)", r.status === 422 && !!r.data?.issues?.applicationNo && !r.data?.issues?.email, `status ${r.status}`);
    check("  → no account created", await noUser(email)); }
  { const r = await register("user@atlasuniversity.edu.in.example.com");
    check("lookalike domain rejected", r.status === 422 && !!r.data?.issues?.email); }

  check("user count unchanged", Number((await h.db.one(`SELECT COUNT(*) AS n FROM \`${h.T.users}\``)).n) === before);
}
main().catch(h.fail).finally(() => h.finish("email policy"));

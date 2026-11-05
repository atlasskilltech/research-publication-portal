/**
 * External AUTHOR (AIDC 2026) — HTTP checks against a RUNNING app (MySQL).
 *
 *   Registration  POST /api/register/author with password: account (Argon2id
 *                 hash) + profile + session; duplicate, invalid email/phone,
 *                 missing fields, password rules, every current-status option.
 *   Login/reset   email + password login, wrong password, Forgot password for a
 *                 non-university Author, Google-era Author without a password.
 *   Google        one common flow, no Author linkage; one Google form on /login
 *                 plus a separate Author email/password section.
 *   Authorization a real AUTHOR session: own dashboard + profile, submit a
 *                 paper, list/view own papers; refused on another author's
 *                 paper, admin / editor / reviewer / publication / volume /
 *                 assignment / role APIs; an admin can't grant an Author roles.
 * The Google callback decision (AUTHOR refused) needs a Google-signed token; it
 * is covered offline with real RS256 tokens by scripts/test-author-registration.mjs.
 * Throwaway accounts only (self-cleaning).
 *
 *   node scripts/test-author-http.mjs http://localhost:3001   (DB_* = the app's DB)
 */
import crypto from "node:crypto";
import { makeHarness } from "./lib/test-db.mjs";
import { sha256Hex } from "../lib/auth/crypto.mjs";
import { hashPassword } from "../lib/auth/password.mjs";
import { createAuthorUser, setPasswordHash } from "../lib/repos/users.mjs";
import { AUTHOR_STATUSES } from "../lib/authorRegistration.js";

const h = makeHarness(process.argv[2]);
const { check, db, T } = h;
const loc = (r) => r.headers.get("location") || "";
const extEmail = (k) => `rpp.it.${k}.${h.tag()}@example-author.org`;
const pendingEmails = [];

const PASSWORD = "Author#Pass2026!";
const VALID = (email) => ({
  name: "IT Author", email, phone: "+91 98765 43210", organization: "Example Institute of Design",
  currentStatus: "RESEARCHER", designation: "Research Fellow", location: "Pune, India",
  password: PASSWORD, confirmPassword: PASSWORD,
});

function makePdf(label) {
  const objs = ["<</Type/Catalog/Pages 2 0 R>>", "<</Type/Pages/Kids[3 0 R]/Count 1>>", "<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>"];
  const stream = `BT /F1 12 Tf 20 100 Td (${label}) Tj ET`;
  objs.push(`<</Length ${stream.length}>>stream\n${stream}\nendstream`);
  let out = "%PDF-1.4\n";
  const offs = objs.map((o, i) => { const off = out.length; out += `${i + 1} 0 obj\n${o}\nendobj\n`; return off; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out);
}
function paperForm(title, email) {
  const f = new FormData();
  f.append("manuscript", new Blob([makePdf(title)], { type: "application/pdf" }), "manuscript.pdf");
  f.append("title", title);
  f.append("abstract", "Automated Author test submission. Safe to ignore.");
  f.append("keywords", "aidc, test");
  f.append("authors", JSON.stringify([{ fullName: "IT Author", email, affiliation: "Example Institute of Design", isCorresponding: true }]));
  return f;
}

/** A real AUTHOR account (as Google activation creates it) + a password so this suite can sign in. */
async function mkAuthor(kind) {
  const email = extEmail(kind);
  const id = await db.transaction((tx) => createAuthorUser(tx, {
    name: `IT Author ${kind}`, email, phone: "+91 90000 00000", organization: "Example Org", current_status: "WORKING_PROFESSIONAL",
    designation: "Designer", location: "Mumbai, India",
  }));
  h.manifest.users.push(id);
  const password = `It#${crypto.randomBytes(12).toString("base64url")}`;
  await setPasswordHash(db, id, await hashPassword(password));
  const br = h.browser();
  const st = await br.login(email, password);
  return { id, email, br, loginStatus: st };
}

async function startGoogle(br, fields) {
  const r = await br.req("/auth/google", { method: "POST", body: new URLSearchParams(fields), headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  const target = loc(r);
  let u = null;
  try { u = new URL(target); } catch { /* relative */ }
  return { r, target, u };
}

async function main() {
  console.log(`\n=== External Author (AIDC 2026) HTTP tests (app ${h.BASE}) ===`);

  // ---------------------------------------------------------------------------
  console.log("\nRegistration (POST /api/register/author):");
  const br = h.browser();
  const email = extEmail("reg");
  const ok = await br.api("/api/register/author", { method: "POST", json: VALID(email.toUpperCase()) });
  const created = await h.track(email);
  check("1. new Author registration with password → 201, → /dashboard", ok.status === 201 && ok.data?.ok === true && ok.data?.redirect === "/dashboard" && ok.data?.email === email, `${ok.status} ${JSON.stringify(ok.data)}`);
  check("…AUTHOR account created (email lower-cased), not admin, no roles", created?.base_type === "AUTHOR" && created.is_admin === false && !(await db.one(`SELECT role FROM \`${T.userRoles}\` WHERE user_id = ?`, [created.id])));
  const credRow = await db.one(`SELECT passwordHash FROM \`${T.users}\` WHERE id = ?`, [created?.id]);
  check("…password stored only as an Argon2id hash (never plaintext)", credRow?.passwordHash?.startsWith("$argon2id$") && !credRow.passwordHash.includes(PASSWORD));
  const prof = await db.one(`SELECT phone, organization, current_status, designation, location FROM \`${T.authorProfiles}\` WHERE user_id = ?`, [created?.id]);
  check("…profile stored with every field", prof?.phone === "+91 98765 43210" && prof.current_status === "RESEARCHER" && prof.location === "Pune, India" && prof.organization === "Example Institute of Design");
  check("…no Google identity, no pending row, no registration cookie",
    !(await db.one(`SELECT 1 AS x FROM \`${T.userIdentities}\` WHERE user_id = ?`, [created?.id])) && !(await db.one(`SELECT 1 AS x FROM \`${T.authorRegistrations}\` WHERE email = ?`, [email]))
    && !(ok.res.headers.getSetCookie?.() || []).some((c) => c.startsWith("rpp_author_reg=")));
  check("…signed in right away (existing session cookie)", br.jar.has("rpp_sid"));
  const dashNew = await br.api("/api/dashboard");
  check("…the new session opens the Author dashboard", dashNew.status === 200 && !!dashNew.data?.externalAuthor);
  check("…response never echoes the password", !JSON.stringify(ok.data).includes(PASSWORD));

  console.log("\nAuthor email + password login:");
  const lb = h.browser();
  check("2. existing Author logs in with email + password → 200", (await lb.login(email, PASSWORD)) === 200);
  check("…case-insensitive email", (await h.browser().login(email.toUpperCase(), PASSWORD)) === 200);
  const meDash = await lb.api("/api/dashboard");
  check("…session is the Author's (AIDC profile)", meDash.status === 200 && meDash.data?.externalAuthor?.email === email);
  check("3. incorrect password → 401 generic", (await h.browser().login(email, "Wrong#Password99")) === 401);
  check("…unknown email → same 401", (await h.browser().login(extEmail("nobody"), PASSWORD)) === 401);

  console.log("\nAuthor password reset:");
  const rb = h.browser();
  const fp = await rb.api("/api/auth/forgot-password", { method: "POST", json: { email } });
  const tok = await db.one(`SELECT COUNT(*) AS n FROM \`${T.authTokens}\` WHERE user_id = ? AND purpose = 'RECOVERY'`, [created?.id]);
  check("4. Forgot password for a non-university Author address → neutral 200 AND a recovery link is issued", fp.status === 200 && Number(tok.n) >= 1, `${fp.status} tokens=${tok.n}`);
  const raw = await h.token(created.id, "RECOVERY");
  const c = await h.confirmLink(rb, raw, "recovery", "reset");
  check("…recovery link → /reset-password", /\/reset-password$/.test(c.location || ""), `${c.status} → ${c.location}`);
  const NEWPW = "Author#Reset2026x";
  const sp = await rb.api("/api/set-password", { method: "POST", json: { password: NEWPW, confirm: NEWPW } });
  check("…new password saved", sp.status === 200, `${sp.status}`);
  check("…old password no longer works, new one does", (await h.browser().login(email, PASSWORD)) === 401 && (await h.browser().login(email, NEWPW)) === 200);
  check("…earlier sessions were revoked by the reset", (await lb.api("/api/dashboard")).status === 401);

  console.log("\nExisting Author from the Google era (no password) → safe password setup:");
  const legacyEmail = extEmail("legacy");
  const legacyId = await db.transaction((tx) => createAuthorUser(tx, {
    name: "IT Legacy Author", email: legacyEmail, phone: "+91 90000 00001", organization: "Example Org", current_status: "OTHER", designation: "Designer", location: "Delhi, India",
  }));
  h.manifest.users.push(legacyId);
  await db.exec(`INSERT INTO \`${T.userIdentities}\` (id, user_id, provider, subject, email) VALUES (UUID(), ?, 'google', ?, ?)`, [legacyId, `g-legacy-${h.tag()}`, legacyEmail]);
  check("Google-era Author without a password can't use password login yet (401)", (await h.browser().login(legacyEmail, "anything-at-all-1")) === 401);
  const lfp = await h.browser().api("/api/auth/forgot-password", { method: "POST", json: { email: legacyEmail } });
  check("…Forgot password issues a setup/reset link for them", lfp.status === 200 && Number((await db.one(`SELECT COUNT(*) AS n FROM \`${T.authTokens}\` WHERE user_id = ? AND purpose = 'RECOVERY'`, [legacyId])).n) >= 1);
  const lb2 = h.browser();
  const lc = await h.confirmLink(lb2, await h.token(legacyId, "RECOVERY"), "recovery", "reset");
  const LPW = "Legacy#Author2026";
  const lsp = await lb2.api("/api/set-password", { method: "POST", json: { password: LPW, confirm: LPW } });
  check("…sets a password through the link, then signs in with email + password", /\/reset-password$/.test(lc.location || "") && lsp.status === 200 && (await h.browser().login(legacyEmail, LPW)) === 200);
  check("…same account kept (no duplicate), profile and Google link record preserved",
    Number((await db.one(`SELECT COUNT(*) AS n FROM \`${T.users}\` WHERE email = ?`, [legacyEmail])).n) === 1
    && !!(await db.one(`SELECT 1 AS x FROM \`${T.authorProfiles}\` WHERE user_id = ?`, [legacyId]))
    && !!(await db.one(`SELECT 1 AS x FROM \`${T.userIdentities}\` WHERE user_id = ?`, [legacyId])));

  console.log("\nRegistration validation:");
  for (const s of AUTHOR_STATUSES) {
    const e = extEmail(`st${s.value.length}`);
    const r = await h.browser().api("/api/register/author", { method: "POST", json: { ...VALID(e), currentStatus: s.value } });
    await h.track(e);
    check(`current status "${s.label}" accepted`, r.status === 201, `${r.status}`);
  }
  const existing = await h.mkUser({ kind: "dup" });
  const dup = await h.browser().api("/api/register/author", { method: "POST", json: VALID(existing.email) });
  check("duplicate email (existing Student/Faculty account) → 409, nothing changed", dup.status === 409 && dup.data?.code === "exists" && (await h.track(existing.email))?.base_type === "FACULTY");
  const dupAuthor = await h.browser().api("/api/register/author", { method: "POST", json: VALID(email) });
  check("registering the same Author email twice → 409 (no duplicate account)", dupAuthor.status === 409 && Number((await db.one(`SELECT COUNT(*) AS n FROM \`${T.users}\` WHERE email = ?`, [email])).n) === 1);
  const dupSf = await h.browser().api("/api/register/author", { method: "POST", json: VALID("sf48116@gmail.com") });
  check("sf48116@gmail.com (existing account) can't be re-registered as an Author → 409", dupSf.status === 409);
  const noPw = await h.browser().api("/api/register/author", { method: "POST", json: { ...VALID(extEmail("nopw")), password: "", confirmPassword: "" } });
  check("missing password → 422", noPw.status === 422 && !!noPw.data?.issues?.password);
  const shortPw = await h.browser().api("/api/register/author", { method: "POST", json: { ...VALID(extEmail("short")), password: "short1", confirmPassword: "short1" } });
  check("password under 10 characters → 422", shortPw.status === 422 && !!shortPw.data?.issues?.password);
  const mismatch = await h.browser().api("/api/register/author", { method: "POST", json: { ...VALID(extEmail("mm")), confirmPassword: "Different#Pass2026" } });
  check("password and confirmation don't match → 422", mismatch.status === 422 && !!mismatch.data?.issues?.confirmPassword);
  const badEmail = await h.browser().api("/api/register/author", { method: "POST", json: VALID("not-an-email") });
  check("invalid email → 422 with an email issue", badEmail.status === 422 && !!badEmail.data?.issues?.email);
  const badPhone = await h.browser().api("/api/register/author", { method: "POST", json: { ...VALID(extEmail("ph")), phone: "12ab" } });
  check("invalid phone → 422 with a phone issue", badPhone.status === 422 && !!badPhone.data?.issues?.phone);
  const missing = await h.browser().api("/api/register/author", { method: "POST", json: {} });
  check("missing required fields → 422 listing all 8 (7 profile + password)", missing.status === 422 && Object.keys(missing.data?.issues || {}).length === 8, JSON.stringify(missing.data?.issues));
  const badStatus = await h.browser().api("/api/register/author", { method: "POST", json: { ...VALID(extEmail("bs")), currentStatus: "ADMIN" } });
  check("unknown current status → 422", badStatus.status === 422 && !!badStatus.data?.issues?.currentStatus);
  const smuggle = extEmail("smuggle");
  const sm = await h.browser().api("/api/register/author", { method: "POST", json: { ...VALID(smuggle), isAdmin: true, roles: ["ADMINISTRATOR"], baseType: "FACULTY" } });
  const smU = await h.track(smuggle);
  check("role/admin/base-type fields in the request are ignored", sm.status === 201 && smU?.base_type === "AUTHOR" && smU.is_admin === false);
  const nojson = await h.browser().req("/api/register/author", { method: "POST", body: "{", headers: { "Content-Type": "application/json" } });
  check("malformed JSON → 400", nojson.status === 400);
  const xsite = await h.browser().req("/api/register/author", { method: "POST", body: JSON.stringify(VALID(extEmail("x"))), headers: { "Content-Type": "application/json", Origin: "https://evil.example" } });
  check("cross-site POST → 403 (CSRF middleware)", xsite.status === 403);

  // ---------------------------------------------------------------------------
  console.log("\nGoogle start (POST /auth/google):");
  const g = await startGoogle(h.browser(), { next: "/submissions" });
  const gRow = g.u ? await db.one(`SELECT next_path, author_registration_id AS a FROM \`${T.oauthStates}\` WHERE state_hash = ?`, [sha256Hex(g.u.searchParams.get("state"))]) : null;
  check("one common Google flow: 303 to Google, PKCE S256, no hd, no login_hint, no Author linkage",
    g.r.status === 303 && g.u?.origin === "https://accounts.google.com" && g.u.searchParams.get("code_challenge_method") === "S256"
    && !g.u.searchParams.has("hd") && !g.u.searchParams.has("login_hint") && gRow?.a === null && gRow?.next_path === "/submissions");
  const stale = h.browser(); stale.set("rpp_author_reg", crypto.randomBytes(32).toString("base64url"));
  const sg = await startGoogle(stale, {});
  const sRow = sg.u ? await db.one(`SELECT author_registration_id AS a FROM \`${T.oauthStates}\` WHERE state_hash = ?`, [sha256Hex(sg.u.searchParams.get("state"))]) : null;
  check("a stale Author-registration cookie has no effect", sRow?.a === null && !sg.u.searchParams.has("login_hint"));
  const cbForged = await h.browser().req("/auth/callback?code=x&state=nope");
  check("callback with an unknown state → refused (no session)", cbForged.status === 303 && /notice=google_failed/.test(loc(cbForged)));
  // The verified-token decision (AUTHOR → refused, incl. a linked identity) is
  // covered with real RS256 tokens in scripts/test-author-registration.mjs.

  console.log("\nPages:");
  const reg = await h.browser().req("/register?type=author");
  const regHtml = await reg.text();
  check("/register renders the Student / Faculty / Author choice", reg.status === 200 && /student/i.test(regHtml) && /faculty/i.test(regHtml) && /author/i.test(regHtml));
  const login = await h.browser().req("/login");
  const loginHtml = await login.text();
  check("/login has EXACTLY ONE Google sign-in form", (loginHtml.match(/action="\/auth\/google"/g) || []).length === 1);
  check("…\"Sign in with Google\", no Author Google button, no intent field", /Sign in with Google/.test(loginHtml) && !/Author sign-in with Google/.test(loginHtml) && !/name="intent"/.test(loginHtml));
  check("…clearly says Google Sign-In is not available for Authors", /Google Sign-In is not available for Authors/.test(loginHtml));
  check("…separate Author email + password sign-in section", /id="author-signin"/.test(loginHtml) && /Author sign-in/.test(loginHtml) && /name="password"/.test(loginHtml));
  check("…Author registration link and Forgot password link present", /href="\/register\?type=author"/.test(loginHtml) && /href="\/auth\/forgot-password"/.test(loginHtml));
  const nt = await (await h.browser().req("/login?notice=author_google_disabled")).text();
  check("…Author Google refusal notice renders", /Google Sign-In is not available for Author accounts/.test(nt));

  // ---------------------------------------------------------------------------
  console.log("\nAuthorization (real AUTHOR session):");
  const A = await mkAuthor("one");
  const B = await mkAuthor("two");
  check("AUTHOR signs in (existing password login works for the session)", A.loginStatus === 200 && B.loginStatus === 200, `${A.loginStatus}/${B.loginStatus}`);
  const dash = await A.br.api("/api/dashboard");
  check("own Author dashboard → 200 with AIDC 2026 profile", dash.status === 200 && dash.data?.externalAuthor?.conference === "AIDC – ATLAS International Design Conference 2026" && dash.data.externalAuthor.profile?.organization === "Example Org" && dash.data.externalAuthor.profile?.currentStatus === "Working Professional");
  check("dashboard has NO reviewer / editorial / admin sections", dash.data && !dash.data.reviewer && !dash.data.editorial && !dash.data.people && !dash.data.publication);
  const page = await A.br.req("/dashboard");
  check("/dashboard page renders for the Author", page.status === 200);

  const sub = await A.br.api("/api/papers", { method: "POST", body: paperForm("IT AIDC paper A", A.email) });
  check("Author submits a paper → 201", sub.status === 201 && !!sub.data?.id, `${sub.status} ${sub.data?.error || ""}`);
  const pidA = sub.data?.id;
  const subB = await B.br.api("/api/papers", { method: "POST", body: paperForm("IT AIDC paper B", B.email) });
  const pidB = subB.data?.id;
  const list = await A.br.api("/api/papers");
  const listed = (list.data?.papers || list.data || []);
  check("Author lists own papers only", list.status === 200 && JSON.stringify(list.data).includes(pidA) && !JSON.stringify(list.data).includes(pidB), `${list.status} ${Array.isArray(listed) ? listed.length : ""}`);
  const own = await A.br.api(`/api/papers/${pidA}`);
  check("Author views own paper → 200", own.status === 200);
  const ownMs = await A.br.req(`/api/papers/${pidA}/manuscript`);
  check("Author downloads own manuscript → 200", ownMs.status === 200);
  const other = await A.br.api(`/api/papers/${pidB}`);
  check("Author CANNOT view another Author's paper (403/404)", [403, 404].includes(other.status), `${other.status}`);
  const otherMs = await A.br.req(`/api/papers/${pidB}/manuscript`);
  check("Author CANNOT download another Author's manuscript (403/404)", [403, 404].includes(otherMs.status), `${otherMs.status}`);
  const otherRev = await A.br.api(`/api/papers/${pidB}/reviews`);
  check("Author CANNOT read another paper's reviews (403/404)", [403, 404].includes(otherRev.status), `${otherRev.status}`);
  const otherRevision = await A.br.api(`/api/papers/${pidB}/revisions`);
  check("Author CANNOT read another paper's revisions (403/404)", [403, 404].includes(otherRevision.status), `${otherRevision.status}`);
  const ownRevisions = await A.br.api(`/api/papers/${pidA}/revisions`);
  check("Author reads own revisions list → 200", ownRevisions.status === 200, `${ownRevisions.status}`);
  const revs = await A.br.api("/api/revisions");
  check("Author's revision requests page API → 200", revs.status === 200, `${revs.status}`);

  // Complete, valid bodies so the request reaches the permission check.
  const DECISION = { decision: "ACCEPT", summary: "Looks good to me — accept." };
  const REVISION = { type: "MINOR", instructions: "Please fix the references section.", reviewIds: [crypto.randomUUID()] };
  const forbidden = [
    ["GET", "/api/admin/users", "admin user list"], ["GET", "/api/admin/reviews", "admin review monitor"],
    ["PATCH", `/api/admin/users/${A.id}`, "change OWN role", { roles: ["ADMINISTRATOR"] }],
    ["PATCH", `/api/admin/users/${B.id}`, "change another user's role", { roles: ["EDITOR"] }],
    ["GET", "/api/editorial", "editor dashboard"], ["GET", "/api/publications/manage", "publication management"],
    ["POST", "/api/publications/volumes", "create a volume", { title: "x", year: 2026 }],
    ["POST", "/api/publications/issues", "create an issue", { title: "x" }],
    ["POST", `/api/papers/${pidB}/assign`, "assign a reviewer", { assignee: A.id, role: "PEER_REVIEWER" }],
    ["POST", `/api/papers/${pidA}/assign`, "assign a reviewer to own paper", { assignee: B.id, role: "PEER_REVIEWER" }],
    ["PUT", `/api/papers/${pidB}/review`, "review another author's paper", { recommendation: "ACCEPT" }],
    ["POST", `/api/papers/${pidB}/decisions`, "record a decision", DECISION],
    ["POST", `/api/papers/${pidA}/decisions`, "decide on own paper", DECISION],
    ["POST", `/api/papers/${pidA}/revisions`, "request a revision on own paper", REVISION],
    ["POST", `/api/papers/${pidB}/revisions`, "request a revision on another paper", REVISION],
  ];
  for (const [method, p, label, json] of forbidden) {
    const r = await A.br.api(p, { method, json: json ?? (method === "GET" ? undefined : {}) });
    check(`Author CANNOT ${label} (${method} ${p.replace(/[0-9a-f-]{36}/g, ":id")}) → ${r.status}`, [401, 403, 404].includes(r.status), JSON.stringify(r.data)?.slice(0, 80));
  }
  const reviews = await A.br.api("/api/reviews");
  check("reviewer queue is empty for an Author (no assignments possible)", reviews.status === 403 || (reviews.status === 200 && JSON.stringify(reviews.data).indexOf(pidB) === -1), `${reviews.status}`);
  const me = await db.one(`SELECT isAdmin, baseType FROM \`${T.users}\` WHERE id = ?`, [A.id]);
  check("after all attempts the Author is still AUTHOR, not admin, no roles", me.baseType === "AUTHOR" && !me.isAdmin && !(await db.one(`SELECT role FROM \`${T.userRoles}\` WHERE user_id = ?`, [A.id])));

  console.log("\nAdministrator vs. Author accounts:");
  const ad = await h.mkAdmin();
  const adm = h.browser();
  await adm.login(ad.email, ad.password);
  const grant = await adm.api(`/api/admin/users/${A.id}`, { method: "PATCH", json: { roles: ["PEER_REVIEWER"] } });
  check("admin cannot grant an Author a reviewer role → 422", grant.status === 422 && /submitters only/.test(grant.data?.error || ""), `${grant.status} ${grant.data?.error}`);
  const grantAdmin = await adm.api(`/api/admin/users/${A.id}`, { method: "PATCH", json: { roles: ["ADMINISTRATOR"] } });
  check("admin cannot make an Author an administrator → 422", grantAdmin.status === 422);
  const base = await adm.api(`/api/admin/users/${A.id}`, { method: "PATCH", json: { baseType: "FACULTY" } });
  check("base type (AUTHOR) is immutable → 422", base.status === 422);
  const assign = await adm.api(`/api/papers/${pidB}/assign`, { method: "POST", json: { assignee: A.id, role: "PEER_REVIEWER" } });
  check("admin cannot assign an Author as reviewer (no role) → 422", assign.status === 422, `${assign.status}`);
  const users = await adm.api("/api/admin/users");
  check("admin user list shows the Author with base type AUTHOR", users.status === 200 && JSON.stringify(users.data).includes(A.email) && JSON.stringify(users.data).includes("AUTHOR"));
  const adDash = await adm.api("/api/dashboard");
  check("admin dashboard counts Authors", adDash.status === 200 && adDash.data?.people?.authors >= 2);
  const adminSeesB = await adm.api(`/api/papers/${pidB}`);
  check("admin can still open an Author's paper (existing editorial workflow)", adminSeesB.status === 200);
}

try {
  await main();
} catch (e) {
  h.fail(e);
} finally {
  if (pendingEmails.length) await db.exec(`DELETE FROM \`${T.authorRegistrations}\` WHERE email IN (?)`, [pendingEmails]);
  await db.exec(`DELETE FROM \`${T.authorRegistrations}\` WHERE email LIKE 'rpp.it.%'`);
  await h.finish("external Author HTTP");
}

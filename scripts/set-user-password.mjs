/**
 * Set (or reset) the password of an EXISTING account — e.g. onboarding the
 * administrators after the MySQL migration. The password is typed at a hidden
 * prompt (never argv / shell history), hashed with Argon2id, and every session
 * of that user is revoked. Roles and the admin flag are NOT touched; no account
 * is ever created.
 *
 *   npm run db:set-password -- "<email>"
 */
import readline from "node:readline";
import { createDb, createPool, dbConfigFromEnv } from "../lib/db/core.mjs";
import { T } from "../lib/db/tables.mjs";
import { hashPassword } from "../lib/auth/password.mjs";
import { revokeAllSessions } from "../lib/auth/store.mjs";
import { validatePasswordPair } from "../lib/passwordPolicy.js";

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function main() {
  const email = String(process.argv[2] || "").trim().toLowerCase();
  if (!email) { console.error('Usage: npm run db:set-password -- "<email>"'); process.exit(2); }
  const db = createDb(createPool({ ...dbConfigFromEnv(process.env), connectionLimit: 1 }));
  try {
    const u = await db.one(`SELECT id, status FROM \`${T.users}\` WHERE email = ?`, [email]);
    if (!u) { console.error("No account with that email. (This tool never creates accounts.)"); process.exitCode = 1; return; }
    const pw = await askHidden("New password (hidden): ");
    const confirm = await askHidden("Confirm password: ");
    const v = validatePasswordPair(pw, confirm);
    if (!v.ok) { console.error(`✗ ${v.error}`); process.exitCode = 1; return; }
    await db.transaction(async (tx) => {
      await tx.exec(
        `UPDATE \`${T.users}\` SET passwordHash = ?, passwordChangedAt = UTC_TIMESTAMP(3), emailVerified = COALESCE(emailVerified, UTC_TIMESTAMP(3)) WHERE id = ?`,
        [await hashPassword(pw), u.id],
      );
      const n = await revokeAllSessions(tx, u.id);
      console.log(`✓ Password set (Argon2id). ${n} existing session(s) revoked.${u.status !== "ACTIVE" ? " NOTE: account status is " + u.status : ""}`);
    });
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error("✗", e.message); process.exit(1); });

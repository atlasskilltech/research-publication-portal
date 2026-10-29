/**
 * One-time, repeatable Administrator provisioning (direct MySQL via mysql2).
 *
 *   npm run db:provision-admins
 *   (= node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/provision-admins.mjs)
 *
 * Loads .env first, then .env.local on top if present (local overrides). On
 * production, where only .env exists, .env.local is skipped harmlessly.
 *
 * Creates (or promotes) the intended initial Administrator accounts and sets
 * their passwords. Passwords are TYPED INTERACTIVELY with hidden input — never
 * hardcoded, never passed on the command line, never printed, never committed.
 *
 * Safe to run again: existing accounts are promoted/updated via
 * INSERT ... ON DUPLICATE KEY UPDATE (unique email), never duplicated. It only
 * touches the database your DB_* variables point at — load production's
 * .env.local to provision production, the local one for local.
 */
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";
import { TABLES } from "../lib/tables.mjs";

// The intended initial Administrators (from the project's original provisioning
// list). Edit here if the institution confirms a different set.
const ADMINS = [
  { email: "faizan.shaikh@atlasuniversity.edu.in", name: "Faizan Shaikh" },
  { email: "elizabeth.jerome@atlasuniversity.edu.in", name: "Elizabeth Jerome" },
];
const MIN_LENGTH = 10;
const BCRYPT_COST = 12; // must match lib/auth/password.js

const { DB_HOST, DB_PORT = "3306", DB_USER, DB_PASS = "", DB_NAME } = process.env;
const missing = ["DB_HOST", "DB_USER", "DB_NAME"].filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env vars: ${missing.join(", ")}`);
  process.exit(1);
}

/** Prompt on the terminal; when hidden, keystrokes are masked and never echoed. */
function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stdout;
    output.write(question);
    if (hidden && input.isTTY) input.setRawMode(true);
    input.resume();
    let buf = "";
    const onData = (d) => {
      for (const ch of d.toString("utf8")) {
        if (ch === "\n" || ch === "\r") {
          cleanup();
          output.write("\n");
          return resolve(buf);
        } else if (ch === "\u0003") {
          cleanup();
          output.write("\n");
          process.exit(130);
        } else if (ch === "\u007f" || ch === "\b") {
          buf = buf.slice(0, -1);
        } else {
          buf += ch;
          if (!hidden) output.write(ch);
        }
      }
    };
    const cleanup = () => {
      input.removeListener("data", onData);
      if (hidden && input.isTTY) input.setRawMode(false);
      input.pause();
    };
    input.on("data", onData);
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error(
      "Refusing to run without an interactive terminal (passwords must be typed securely).",
    );
    process.exit(1);
  }

  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
  });

  try {
    console.log(`\nProvisioning Administrators on ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
    console.log("Passwords are typed with hidden input and are never displayed or stored in plaintext.\n");

    for (const admin of ADMINS) {
      console.log(`• ${admin.email}`);
      const pw = await prompt(`  Set password (min ${MIN_LENGTH} chars): `, { hidden: true });
      if (pw.length < MIN_LENGTH) {
        console.error("  x Too short — skipped.\n");
        continue;
      }
      const confirm = await prompt("  Confirm password: ", { hidden: true });
      if (pw !== confirm) {
        console.error("  x Passwords did not match — skipped.\n");
        continue;
      }

      const passwordHash = await bcrypt.hash(pw, BCRYPT_COST);
      await conn.execute(
        `INSERT INTO \`${TABLES.users}\` ` +
          "(`id`, `name`, `email`, `passwordHash`, `baseType`, `isAdmin`, `createdAt`, `updatedAt`) " +
          "VALUES (?, ?, ?, ?, 'FACULTY', 1, NOW(3), NOW(3)) " +
          "ON DUPLICATE KEY UPDATE " +
          "`passwordHash` = VALUES(`passwordHash`), `name` = VALUES(`name`), " +
          "`isAdmin` = 1, `updatedAt` = NOW(3)",
        [crypto.randomUUID(), admin.name, admin.email, passwordHash],
      );
      console.log(`  ok ${admin.email} is now an Administrator.\n`);
    }

    console.log("Done.");
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("Provisioning failed:", e?.code || e?.message);
  process.exitCode = 1;
});

/**
 * One-time, repeatable Admin provisioning (direct MySQL via mysql2).
 *
 * Creates (or promotes) the intended initial Administrator accounts and sets
 * their passwords. Passwords are TYPED INTERACTIVELY with hidden input — never
 * hardcoded, never passed on the command line, never printed, never committed.
 *
 * Run locally from the project root:
 *   npx dotenv -e .env.local -- node scripts/provision-admins.mjs
 *
 * Safe to run again: existing accounts are promoted/updated via
 * INSERT ... ON DUPLICATE KEY UPDATE (unique email), never duplicated. It only
 * touches the database your DATABASE_URL points at — never production unless
 * that is the URL you load.
 */
import readline from "node:readline";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import mysql from "mysql2/promise";

const ADMINS = [
  { email: "faizan.shaikh@atlasuniversity.edu.in", name: "Faizan Shaikh" },
  { email: "elizabeth.jerome@atlasuniversity.edu.in", name: "Elizabeth Jerome" },
];
const MIN_LENGTH = 10;

function dbConfigFromUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ""),
  };
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
    console.error("Refusing to run without an interactive terminal (passwords must be typed securely).");
    process.exit(1);
  }

  const conn = await mysql.createConnection(dbConfigFromUrl());
  try {
    console.log("Provisioning initial Administrator accounts.");
    console.log("Passwords are typed with hidden input and are never displayed or stored in plaintext.\n");

    for (const admin of ADMINS) {
      console.log(`• ${admin.email}`);
      const pw = await prompt(`  Set password (min ${MIN_LENGTH} chars): `, { hidden: true });
      if (pw.length < MIN_LENGTH) {
        console.error("  ✗ Too short — skipped.\n");
        continue;
      }
      const confirm = await prompt("  Confirm password: ", { hidden: true });
      if (pw !== confirm) {
        console.error("  ✗ Passwords did not match — skipped.\n");
        continue;
      }

      const passwordHash = await bcrypt.hash(pw, 12);
      await conn.execute(
        `INSERT INTO \`users\`
           (\`id\`, \`name\`, \`email\`, \`passwordHash\`, \`baseType\`, \`isAdmin\`, \`createdAt\`, \`updatedAt\`)
         VALUES (?, ?, ?, ?, 'FACULTY', 1, NOW(3), NOW(3))
         ON DUPLICATE KEY UPDATE
           \`passwordHash\` = VALUES(\`passwordHash\`),
           \`name\` = VALUES(\`name\`),
           \`isAdmin\` = 1,
           \`baseType\` = 'FACULTY',
           \`updatedAt\` = NOW(3)`,
        [crypto.randomUUID(), admin.name, admin.email, passwordHash],
      );
      console.log(`  ✓ ${admin.email} is now an Administrator.\n`);
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

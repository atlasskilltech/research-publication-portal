/**
 * One-time, repeatable Admin provisioning.
 *
 * Creates (or promotes) the intended initial Administrator accounts and sets
 * their passwords. Passwords are TYPED INTERACTIVELY with hidden input — never
 * hardcoded, never passed on the command line, never printed, never committed.
 *
 * Run locally from the project root:
 *   npx dotenv -e .env.local -- node scripts/provision-admins.mjs
 *
 * Safe to run again: existing accounts are promoted/updated (upsert), not
 * duplicated. It only touches the database your .env.local points at — never
 * production (configure production separately on the server).
 */
import readline from "node:readline";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const ADMINS = [
  { email: "faizan.shaikh@atlasuniversity.edu.in", name: "Faizan Shaikh" },
  { email: "elizabeth.jerome@atlasuniversity.edu.in", name: "Elizabeth Jerome" },
];

const MIN_LENGTH = 10;
const prisma = new PrismaClient();

/** Prompt on the terminal; when hidden, keystrokes are masked and never echoed. */
function prompt(query, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stdout;
    output.write(query);
    if (hidden && input.isTTY) input.setRawMode(true);
    input.resume();
    let buf = "";
    const onData = (d) => {
      const s = d.toString("utf8");
      for (const ch of s) {
        if (ch === "\n" || ch === "\r") {
          cleanup();
          output.write("\n");
          return resolve(buf);
        } else if (ch === "\u0003") {
          // Ctrl-C
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
    await prisma.user.upsert({
      where: { email: admin.email },
      update: { isAdmin: true, passwordHash, name: admin.name, baseType: "FACULTY" },
      create: {
        email: admin.email,
        name: admin.name,
        passwordHash,
        isAdmin: true,
        baseType: "FACULTY",
      },
    });
    console.log(`  ✓ ${admin.email} is now an Administrator.\n`);
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error("Provisioning failed:", e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

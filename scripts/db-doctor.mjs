/**
 * Read-only diagnostic for the login failure "ER_DBACCESS_DENIED_ERROR"
 * (MySQL error 1044: authenticated, but no privileges on the named database).
 *
 * It uses the SAME mysql2 driver and the SAME env values the app uses, so it
 * connects exactly as the app does. It changes nothing and prints nothing
 * secret (passwords are never shown; any grant line is redacted).
 *
 * Run from the project root on the server:
 *   node scripts/db-doctor.mjs
 *
 * The goal is to decide which of two situations you are in:
 *   (a) wrong DB_NAME  -> an .env-only fix you can make yourself, or
 *   (b) a missing GRANT on the account/host you connect as -> only whoever
 *       administers the MySQL server (65.1.118.10) can fix it.
 */
import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

// Minimal .env loader (no extra dependency), matching Next.js precedence for
// `next start`: a real pre-set env var always wins, then among the files the
// *.local / *.production variants override plain .env. We load low-priority
// files first and let higher-priority ones overwrite, while never clobbering a
// variable that was already present in the real process environment.
function loadEnv() {
  const preset = new Set(Object.keys(process.env));
  // Lowest priority first, highest last (Next loads .env.local over .env).
  const files = [".env", ".env.production", ".env.local", ".env.production.local"];
  const seenFiles = [];
  for (const file of files) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    seenFiles.push(file);
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      // Real env vars win; otherwise the last (highest-priority) file wins.
      if (!preset.has(key)) process.env[key] = val;
    }
  }
  return seenFiles;
}

// Mirror lib/db.js: prefer DATABASE_URL, else discrete DB_* parts.
function targetConfig() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port ? Number(u.port) : 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
    };
  }
  const { DB_USER, DB_PASS, DB_NAME, DB_HOST, DB_PORT } = process.env;
  return {
    host: DB_HOST || "127.0.0.1",
    port: DB_PORT ? Number(DB_PORT) : 3306,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
  };
}

// Never print auth material, even if a grant line happens to carry it.
function redact(s) {
  return String(s).replace(/IDENTIFIED BY[^\n]*/gi, "IDENTIFIED BY <redacted>");
}

async function main() {
  const seenFiles = loadEnv();
  const cfg = targetConfig();
  if (!cfg.user || !cfg.password || !cfg.database) {
    console.error(
      "Missing DB config. Set DATABASE_URL, or DB_USER/DB_PASS/DB_NAME in .env.",
    );
    process.exit(1);
  }

  console.log("Env source:");
  console.log("  files found :", seenFiles.length ? seenFiles.join(", ") : "(none)");
  console.log(
    "  config path :",
    process.env.DATABASE_URL
      ? "DATABASE_URL is set -> it OVERRIDES DB_USER/DB_PASS/DB_NAME"
      : "using DB_USER/DB_PASS/DB_NAME parts",
  );
  console.log("");

  console.log("Connecting as:");
  console.log("  host    :", cfg.host);
  console.log("  port    :", cfg.port);
  console.log("  user    :", cfg.user);
  console.log("  database:", cfg.database, "(the name being denied)");
  console.log("  password: <set, not shown>\n");

  // Step 1 — reproduce the app's failure: connect WITH the database selected.
  console.log("Step 1 - connect with the database selected (reproduces the app):");
  try {
    const c = await mysql.createConnection(cfg);
    console.log("  OK - the database grant is fine; the app should connect.");
    console.log("  If the app still fails, restart it: pm2 restart research-publication-portal\n");
    await c.end();
  } catch (e) {
    console.log("  FAILED:", e.code || e.message, e.errno ? `(errno ${e.errno})` : "");
    if (e.code === "ER_ACCESS_DENIED_ERROR") {
      console.log("  -> Wrong user/password. Fix DB_USER / DB_PASS in .env. Stopping.\n");
      return;
    }
    if (e.code === "ER_BAD_DB_ERROR") {
      console.log("  -> This database name does not exist on the server. See Step 2 for the real names.");
    }
    if (e.code === "ER_DBACCESS_DENIED_ERROR") {
      console.log("  -> Authenticated OK, but no privileges on this database. See Step 2.");
    }
    console.log("");
  }

  // Step 2 — connect WITHOUT a database, to inspect the account itself.
  console.log("Step 2 - connect without a database, to inspect the account:");
  let conn;
  try {
    conn = await mysql.createConnection({ ...cfg, database: undefined });
  } catch (e) {
    console.log("  Could not connect at all:", e.code || e.message);
    console.log("  -> This is authentication/host level, not a db grant.");
    console.log("     The MySQL admin must allow this user from this host.");
    return;
  }

  const [who] = await conn.query("SELECT CURRENT_USER() AS matched, USER() AS requested");
  console.log("  requested account :", who[0].requested);
  console.log("  MATCHED account   :", who[0].matched, " <-- grants must be on THIS row");

  const [dbs] = await conn.query("SHOW DATABASES");
  const names = dbs.map((r) => Object.values(r)[0]);
  console.log("\n  Databases this account can actually access:");
  if (names.length === 0) {
    console.log("    (none - this account has no database privileges at all)");
  }
  for (const n of names) {
    const mark = n === cfg.database ? "  <-- matches DB_NAME" : "";
    console.log("    -", n + mark);
  }

  const [grants] = await conn.query("SHOW GRANTS FOR CURRENT_USER()");
  console.log("\n  Grants for the matched account:");
  for (const g of grants) console.log("    ", redact(Object.values(g)[0]));

  console.log("\nHow to read this:");
  console.log("  * Only 'USAGE ON *.*' in the grants -> the account/host you connect");
  console.log("    as has NO privilege on any database. The MySQL admin must run, on");
  console.log("    the server:");
  console.log("      GRANT ALL PRIVILEGES ON `" + cfg.database + "`.*");
  console.log("        TO " + who[0].matched.replace(/^(.*)@(.*)$/, "'$1'@'$2'") + ";");
  console.log("      FLUSH PRIVILEGES;");
  console.log("  * 'SHOW DATABASES' lists a db with a slightly DIFFERENT name -> put");
  console.log("    that exact name in DB_NAME in .env (a fix you can make yourself),");
  console.log("    then: pm2 restart research-publication-portal");
  console.log("  * It lists your db but Step 1 still failed -> stale pooled connection;");
  console.log("    just restart: pm2 restart research-publication-portal");

  await conn.end();
}

main().catch((e) => {
  console.error("db-doctor failed:", e?.code || e?.message);
  process.exitCode = 1;
});

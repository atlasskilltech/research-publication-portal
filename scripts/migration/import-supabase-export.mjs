/**
 * Import a Supabase export (scripts/migration/export-supabase.mjs) into MySQL.
 *
 *   node --env-file-if-exists=.env --env-file-if-exists=.env.local \
 *     scripts/migration/import-supabase-export.mjs <export.json> [--hashes <file>] [--replace-hashes] [--apply]
 *
 * DRY RUN by default: prints every planned change and touches nothing.
 * --apply runs the whole import in ONE transaction (all or nothing).
 *
 * Accounts — matched to an existing MySQL user by, in order:
 *   users.supabaseId = auth id → users.id = profiles.legacy_id (the original
 *   MySQL id) → same email. A match KEEPS its MySQL id and existing values; only
 *   empty fields are filled (supabaseId, applicationNo, emailVerified,
 *   schoolCode, passwordHash). No match → inserted with the Supabase UUID as id.
 *   Roles: Supabase user_roles rows are added (never removed) and isAdmin is
 *   kept in sync with ADMINISTRATOR — printed in the dry run for review.
 * Passwords — Supabase bcrypt hashes are not in the API export. If you exported
 *   `select id, encrypted_password from auth.users` (CSV with header, or JSON
 *   array) pass it with --hashes; it fills empty passwordHash values, and with
 *   --replace-hashes also replaces an existing (older) MySQL hash. Logins verify
 *   bcrypt and upgrade it to Argon2id automatically.
 * Workflow tables — copied with the same ids; every user reference is mapped
 *   to the MySQL user id; rows whose id already exists are skipped (re-runnable).
 *
 * Never deletes, truncates or overwrites non-empty values. Prints no secrets.
 */
import { readFileSync } from "node:fs";
import { createDb, createPool, dbConfigFromEnv, toDate } from "../../lib/db/core.mjs";
import { T } from "../../lib/db/tables.mjs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--hashes");
const hashesFile = args.includes("--hashes") ? args[args.indexOf("--hashes") + 1] : null;
const APPLY = args.includes("--apply");
const REPLACE_HASHES = args.includes("--replace-hashes");
if (!file) {
  console.error("usage: import-supabase-export.mjs <export.json> [--hashes <file>] [--replace-hashes] [--apply]");
  process.exit(2);
}

const data = JSON.parse(readFileSync(file, "utf8"));
const tables = data.tables || {};

function loadHashes(path) {
  if (!path) return new Map();
  const raw = readFileSync(path, "utf8").trim();
  let rows;
  if (raw.startsWith("[")) rows = JSON.parse(raw);
  else {
    const [head, ...lines] = raw.split(/\r?\n/);
    const cols = head.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    rows = lines.filter(Boolean).map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v.trim().replace(/^"|"$/g, "")])));
  }
  return new Map(rows.filter((r) => r.id && /^\$2[aby]\$/.test(r.encrypted_password || "")).map((r) => [r.id, r.encrypted_password]));
}

const plan = [];
const note = (s) => plan.push(s);
const lower = (s) => String(s || "").trim().toLowerCase();

// User-reference columns per table → mapped through the Supabase→MySQL id map.
const COPY = [
  ["papers", T.papers, ["id", "title", "abstract", "keywords", "school_code", "status", "submitted_by", "current_round", "created_at", "updated_at"], ["submitted_by"]],
  ["paper_authors", T.paperAuthors, ["id", "paper_id", "full_name", "email", "affiliation", "is_corresponding", "author_order", "created_at"], []],
  ["paper_manuscripts", T.paperManuscripts, ["id", "paper_id", "version", "storage_key", "original_filename", "mime_type", "byte_size", "sha256", "uploaded_by", "created_at"], ["uploaded_by"]],
  ["paper_assignments", T.paperAssignments, ["id", "paper_id", "assignee", "role", "assigned_by", "assigned_at", "due_at"], ["assignee", "assigned_by"]],
  ["paper_activity", T.paperActivity, ["id", "paper_id", "actor", "action", "detail", "created_at"], ["actor"]],
  ["reviews", T.reviews, ["id", "paper_id", "reviewer", "round", "status", "recommendation", "technical_quality", "originality", "methodology", "clarity", "strengths", "weaknesses", "comments_to_author", "confidential_to_editor", "submitted_at", "created_at", "updated_at"], ["reviewer"]],
  ["paper_revisions", T.paperRevisions, ["id", "paper_id", "round", "revision_type", "instructions", "due_at", "status", "review_ids", "responses", "requested_by", "requested_at", "started_at", "submitted_at", "submitted_by", "rereview_started_at", "updated_at"], ["requested_by", "submitted_by"]],
  ["editorial_decisions", T.editorialDecisions, ["id", "paper_id", "round", "decision", "summary", "confidential_note", "review_ids", "revision_due_at", "revision_id", "version", "decided_by", "created_at", "updated_at", "released_at", "released_by"], ["decided_by", "released_by"]],
  ["volumes", T.volumes, ["id", "volume_number", "year", "title", "description", "status", "published_at", "created_by", "created_at", "updated_at"], ["created_by"]],
  ["issues", T.issues, ["id", "volume_id", "issue_number", "title", "description", "publication_date", "status", "published_at", "created_by", "created_at", "updated_at"], ["created_by"]],
  ["publications", T.publications, ["id", "paper_id", "volume_id", "issue_id", "title", "abstract", "authors", "keywords", "page_start", "page_end", "doi", "publication_date", "manuscript_id", "manuscript_public", "status", "version", "scheduled_by", "scheduled_at", "published_by", "published_at", "created_at", "updated_at"], ["scheduled_by", "published_by"]],
];
const JSON_COLS = new Set(["keywords", "detail", "review_ids", "responses", "authors"]);
const DATETIME_COLS = /(_at|^due_at)$/;
const DATE_COLS = new Set(["publication_date"]);

function value(col, v) {
  if (v === undefined) return null;
  if (JSON_COLS.has(col)) return JSON.stringify(v ?? (col === "detail" ? {} : []));
  if (DATE_COLS.has(col)) return v ? String(v).slice(0, 10) : null;
  if (DATETIME_COLS.test(col)) return toDate(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

async function main() {
  const cfg = dbConfigFromEnv(process.env);
  const db = createDb(createPool({ ...cfg, connectionLimit: 1 }));
  const hashes = loadHashes(hashesFile);
  try {
    for (const t of [T.users, T.userRoles, T.papers, T.publications]) {
      if (!(await db.one("SELECT 1 AS x FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [t]))) {
        throw new Error(`table ${t} missing — run \`npm run db:migrate -- --apply\` first`);
      }
    }
    console.log(`Export from ${data.source} at ${data.exportedAt}: ${data.authUsers?.length || 0} auth users, ${tables.profiles?.length || 0} profiles`);
    console.log(`Target: \`${cfg.database}\` on ${cfg.host} — ${APPLY ? "APPLY (one transaction)" : "DRY RUN (no changes)"}\n`);

    await db.transaction(async (tx) => {
      const idMap = new Map();
      const profiles = new Map((tables.profiles || []).map((p) => [p.id, p]));
      for (const au of data.authUsers || []) {
        const p = profiles.get(au.id) || {};
        const email = lower(au.email || p.email);
        let m = await tx.one(`SELECT * FROM \`${T.users}\` WHERE supabaseId = ?`, [au.id]);
        if (!m && p.legacy_id) m = await tx.one(`SELECT * FROM \`${T.users}\` WHERE id = ?`, [p.legacy_id]);
        if (!m) m = await tx.one(`SELECT * FROM \`${T.users}\` WHERE email = ?`, [email]);
        const hash = hashes.get(au.id) || null;
        const masked = email.replace(/^(.).*(@.*)$/, "$1***$2");
        if (m) {
          idMap.set(au.id, m.id);
          if (lower(m.email) !== email) note(`! ${masked}: matched MySQL id ${m.id} by legacy_id but email differs — kept MySQL email`);
          const set = {};
          if (!m.supabaseId) set.supabaseId = au.id;
          if (!m.applicationNo && p.application_no) set.applicationNo = p.application_no;
          if (!m.emailVerified && au.email_confirmed_at) set.emailVerified = toDate(au.email_confirmed_at);
          if (!m.schoolCode && p.school_code) set.schoolCode = p.school_code;
          if (hash && (!m.passwordHash || REPLACE_HASHES)) set.passwordHash = hash;
          else if (hash && m.passwordHash) note(`  ${masked}: MySQL already has a password hash (older); pass --replace-hashes to use the current Supabase password`);
          if (p.base_type && m.baseType !== p.base_type) note(`! ${masked}: base type MySQL=${m.baseType} Supabase=${p.base_type} — kept MySQL (immutable)`);
          const keys = Object.keys(set);
          note(`= ${masked} → existing MySQL user ${m.id}${keys.length ? `; fill ${keys.join(", ")}` : "; nothing to fill"}`);
          if (keys.length) await tx.exec(`UPDATE \`${T.users}\` SET ${keys.map((k) => `\`${k}\` = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => set[k]), m.id]);
        } else {
          idMap.set(au.id, au.id);
          note(`+ ${masked} → new MySQL user ${au.id} (${p.base_type || "STUDENT"}${hash ? ", password hash" : ", no password — must use 'Forgot password'"})`);
          await tx.exec(
            `INSERT INTO \`${T.users}\` (id, name, email, passwordHash, baseType, isAdmin, status, schoolCode, rollNo, applicationNo, emailVerified, supabaseId, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, 0, 'ACTIVE', ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
            [au.id, p.name || "", email, hash, p.base_type === "FACULTY" ? "FACULTY" : "STUDENT", p.school_code || null, p.roll_no || null,
              p.application_no || null, toDate(au.email_confirmed_at), au.id, toDate(au.created_at || p.created_at) || new Date()],
          );
        }
      }

      // Roles (added, never removed) + isAdmin mirror.
      for (const r of tables.user_roles || []) {
        const uid = idMap.get(r.user_id);
        if (!uid) { note(`! role ${r.role} for unknown user ${r.user_id} — skipped`); continue; }
        const res = await tx.exec(`INSERT IGNORE INTO \`${T.userRoles}\` (user_id, role, assigned_by, assigned_at) VALUES (?, ?, ?, ?)`,
          [uid, r.role, idMap.get(r.assigned_by) || null, toDate(r.assigned_at) || new Date()]);
        note(`${res.affectedRows ? "+" : "="} role ${r.role} → ${uid}${res.affectedRows ? "" : " (already present)"}`);
        if (r.role === "ADMINISTRATOR") {
          const u = await tx.exec(`UPDATE \`${T.users}\` SET isAdmin = 1 WHERE id = ? AND isAdmin = 0`, [uid]);
          if (u.affectedRows) note(`! ${uid}: isAdmin set to 1 to mirror the ADMINISTRATOR role held in Supabase`);
        }
      }
      for (const p of tables.profiles || []) {
        if (p.is_admin && !(tables.user_roles || []).some((r) => r.user_id === p.id && r.role === "ADMINISTRATOR")) {
          note(`! Supabase profile ${p.id} has is_admin=true but no ADMINISTRATOR role row — not granted (review manually)`);
        }
      }

      // Workflow tables.
      const mapUser = (v) => (v ? idMap.get(v) || null : null);
      for (const [name, table, cols, userCols] of COPY) {
        const rows = tables[name] || [];
        let inserted = 0, skipped = 0;
        for (const row of rows) {
          if (await tx.one(`SELECT 1 AS x FROM \`${table}\` WHERE id = ?`, [row.id])) { skipped++; continue; }
          const vals = cols.map((c) => (userCols.includes(c) ? mapUser(row[c]) : value(c, row[c])));
          await tx.exec(`INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (?)`, [vals]);
          inserted++;
        }
        note(`${name.padEnd(20)} ${rows.length} in export → ${inserted} inserted, ${skipped} already present`);
      }

      console.log(plan.join("\n"));
      if (!APPLY) throw Object.assign(new Error("dry-run"), { dryRun: true });
    });
    console.log("\n✓ Import committed.");
  } catch (e) {
    if (e.dryRun) console.log("\nDry run only — rolled back, nothing changed. Re-run with --apply to import.");
    else { console.error("✗ Import failed (rolled back):", e.message); process.exitCode = 1; }
  } finally {
    await db.end();
  }
}
main();

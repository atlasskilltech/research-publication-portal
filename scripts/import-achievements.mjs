/**
 * Import the old Google-Forms achievement workbook ("Faculty Research & Academic
 * Achievements Aggregate Sheet", 12 sheets) into the portal.
 *
 *   npm run achievements:import -- <workbook.xlsx> [--contributors names.csv]           # PREVIEW (read-only)
 *   npm run achievements:import -- <workbook.xlsx> [--contributors names.csv] --apply   # write
 *     --no-download   keep every proof as its Google Drive link (don't try to fetch files)
 *     --report <file> where to write the per-row CSV report (default: OS temp folder)
 *
 * What --apply does:
 *  1. Creates a portal account (Faculty, no password, not admin, no roles) for
 *     every email in the workbook — and in --contributors — that has none, so
 *     those people just "Sign in with Google". Existing accounts are untouched.
 *  2. Adds every row as an achievement with status "Awaiting check", keeping the
 *     original form timestamp. A row that was imported before is skipped (each
 *     row has a stable key), so re-running is safe.
 *  3. Proof: each Google Drive link is downloaded when the file is shared
 *     publicly ("Anyone with the link") and is a real PDF/DOCX/DOC — then it is
 *     stored like any upload (S3 or the private folder). Otherwise the Drive link
 *     is kept and the faculty member is asked in the portal to upload the file.
 *  4. Entries submitted by an office mailbox (centreofexcellence@, phd@) list the
 *     people named on them as contributors; a contributor whose email is known
 *     (from the workbook itself or --contributors) sees the entry in "My
 *     achievements". Unmatched names (e.g. students) stay as names.
 *  5. ORCID iDs are saved to each person's profile (an existing one is kept).
 *
 * --contributors: CSV with a header row "name,email[,school]" — the names exactly
 * as they appear on the office entries, e.g. "Gaurav Shergill,gaurav.shergill@…".
 *
 * Safety: nothing is written without --apply; only research_* tables are touched;
 * account creation never grants admin or roles; every SQL value is bound.
 * Env: the same DB_* and storage settings as the app (.env / .env.local).
 */
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, createPool, dbConfigFromEnv } from "../lib/db/core.mjs";
import { T } from "../lib/db/tables.mjs";
import { uuid } from "../lib/auth/crypto.mjs";
import { createRegisteredUser } from "../lib/repos/users.mjs";
import { insertAchievement, sourceKeyExists } from "../lib/repos/achievements.mjs";
import { validateUpload, newStorageKey, sha256, ALLOWED, MAX_BYTES } from "../lib/manuscriptFiles.js";
import { readXlsx } from "./lib/xlsx.mjs";
import { createImportStorage } from "./lib/importStorage.mjs";
import {
  mapSheet, sheetConfig, createNameIndex, displayName, driveFileId, mapSchool, nameTokens, OFFICE_EMAILS, OFFICE_NAMES,
} from "../lib/achievementImport.js";

// ---- Arguments ---------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const workbook = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--contributors" && argv[i - 1] !== "--report");
const APPLY = flag("--apply");
const DOWNLOAD = !flag("--no-download");
const contributorsCsv = opt("--contributors");
const reportPath = opt("--report") || path.join(os.tmpdir(), `achievement-import-report-${Date.now()}.csv`);
if (!workbook) {
  console.error("Usage: npm run achievements:import -- <workbook.xlsx> [--contributors names.csv] [--apply] [--no-download]");
  process.exit(2);
}

// ---- Small CSV helpers ---------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- Drive download ------------------------------------------------------------------
async function fetchCapped(url, limit) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(45_000), headers: { "User-Agent": "Mozilla/5.0 (portal import)" } });
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  if (/text\/html/i.test(res.headers.get("content-type") || "")) { try { await res.body?.cancel(); } catch { /* */ } return { ok: false, reason: "not shared publicly (Google sign-in page)" }; }
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > limit) { try { await res.body?.cancel(); } catch { /* */ } return { ok: false, reason: "larger than 25 MB" }; }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > limit) return { ok: false, reason: "larger than 25 MB" };
    chunks.push(chunk);
  }
  const cd = res.headers.get("content-disposition") || "";
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"/i.exec(cd);
  let name = null;
  try { name = m ? decodeURIComponent(m[1] || m[2]) : null; } catch { name = m ? m[2] || null : null; }
  return { ok: true, buffer: Buffer.concat(chunks), name, mime: res.headers.get("content-type") || "" };
}

async function downloadDrive(url) {
  const id = driveFileId(url);
  if (!id) return { ok: false, reason: "not a Google Drive file link" };
  let r;
  try {
    // ACHIEVEMENT_IMPORT_DRIVE_URL (tests only): a URL template with {id}, e.g. a local stand-in for Drive.
    const tpl = process.env.ACHIEVEMENT_IMPORT_DRIVE_URL || "https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t";
    r = await fetchCapped(tpl.replace("{id}", encodeURIComponent(id)), MAX_BYTES);
  } catch (e) {
    return { ok: false, reason: e?.name === "TimeoutError" ? "timed out" : `network error (${e?.cause?.code || e?.message})` };
  }
  if (!r.ok) return r;
  const extGuess = (r.name || "").match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const name = r.name || `document.${extGuess || "pdf"}`;
  const verdict = validateUpload({ originalName: name, declaredMime: r.mime, size: r.buffer.length, buffer: r.buffer });
  if (!verdict.ok) return { ok: false, reason: `not a PDF/DOCX/DOC (${verdict.error})` };
  return { ok: true, buffer: r.buffer, ext: verdict.ext, mime: ALLOWED[verdict.ext].mime, name: name.slice(0, 255) };
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

// ---- Main ----------------------------------------------------------------------------
async function main() {
  console.log(`\n${APPLY ? "IMPORT (writes to the database)" : "PREVIEW (read-only — nothing is written)"} — ${path.basename(workbook)}\n`);

  // 1. Read + map every sheet
  const sheets = readXlsx(workbook);
  const records = [];
  const orcids = [];
  const skipped = [];
  for (const sh of sheets) {
    const cfg = sheetConfig(sh.name);
    if (!cfg) { console.log(`  ! sheet "${sh.name}" not recognised — skipped`); continue; }
    const r = mapSheet(sh.name, sh.rows);
    records.push(...r.records);
    orcids.push(...r.orcids);
    skipped.push(...r.skipped.map((s) => ({ ...s, sheet: sh.name })));
    console.log(`  ${sh.name.padEnd(34)} ${String(cfg.type === "ORCID" ? r.orcids.length : r.records.length).padStart(4)} ${cfg.type === "ORCID" ? "ORCID iDs" : "entries"}${r.skipped.length ? `, ${r.skipped.length} row(s) skipped` : ""}`);
  }

  // 2. Name → email index (contributors file first, then the workbook's own rows)
  const index = createNameIndex();
  const extraPeople = new Map(); // email → { name, school }
  if (contributorsCsv) {
    const rows = parseCsv(readFileSync(contributorsCsv, "utf8"));
    const head = rows[0].map((h) => h.trim().toLowerCase());
    const ni = head.indexOf("name"), ei = head.indexOf("email"), si = head.indexOf("school");
    if (ni < 0 || ei < 0) throw new Error(`${contributorsCsv}: needs a header row with "name" and "email"`);
    let n = 0;
    for (const r of rows.slice(1)) {
      const name = (r[ni] || "").trim(), email = (r[ei] || "").trim().toLowerCase();
      if (!name || !EMAIL_RE.test(email)) continue;
      index.add(name, email);
      if (!extraPeople.has(email)) extraPeople.set(email, { name: displayName(name), school: mapSchool(si >= 0 ? r[si] : "") });
      n++;
    }
    console.log(`\n  Contributors file: ${n} name → email pairs`);
  }
  const ownName = new Map(); // email → Map(name → count)
  const ownSchool = new Map();
  const bump = (m, k, v) => { if (!v) return; if (!m.has(k)) m.set(k, new Map()); m.get(k).set(v, (m.get(k).get(v) || 0) + 1); };
  for (const r of records) {
    if (r.office) continue;
    const name = r.details.submitted_by_name || r.ownerName;
    if (name && !/[,&]|\band\b/i.test(name) && nameTokens(name).length >= 2) { index.add(name, r.ownerEmail); bump(ownName, r.ownerEmail, name); }
    bump(ownSchool, r.ownerEmail, r.school);
  }
  for (const o of orcids) { if (o.name) { index.add(o.name, o.email); bump(ownName, o.email, o.name); } bump(ownSchool, o.email, o.school); }
  const top = (m, k) => (m.has(k) ? [...m.get(k).entries()].sort((a, b) => b[1] - a[1])[0][0] : null);

  // 3. Contributors on office entries
  let matched = 0, unmatched = 0;
  const unmatchedNames = new Map();
  for (const r of records) {
    r.contributors = r.names.map((n) => {
      const email = index.match(n);
      if (email) matched++; else { unmatched++; unmatchedNames.set(displayName(n), (unmatchedNames.get(displayName(n)) || 0) + 1); }
      return { name: displayName(n), email };
    });
  }

  // 4. Accounts needed
  const cfg = dbConfigFromEnv(process.env);
  const db = createDb(createPool({ ...cfg, connectionLimit: 2 }));
  try {
    const people = new Map(); // email → { name, school }
    for (const r of records) people.set(r.ownerEmail, null);
    for (const o of orcids) people.set(o.email, null);
    for (const r of records) for (const c of r.contributors) if (c.email) people.set(c.email, null);
    for (const email of people.keys()) {
      const extra = extraPeople.get(email);
      people.set(email, {
        name: OFFICE_NAMES[email] || displayName(top(ownName, email) || extra?.name || email.split("@")[0].replace(/[._]/g, " ")),
        school: top(ownSchool, email) || extra?.school || null,
      });
    }
    const emails = [...people.keys()];
    const existing = new Map();
    for (let i = 0; i < emails.length; i += 500) {
      const chunk = emails.slice(i, i + 500);
      for (const u of await db.query(`SELECT id, email, baseType AS base_type FROM \`${T.users}\` WHERE email IN (?)`, [chunk])) existing.set(u.email.toLowerCase(), u);
    }
    const toCreate = emails.filter((e) => !existing.has(e));
    const authors = emails.filter((e) => existing.get(e)?.base_type === "AUTHOR");

    // 5. Already imported?
    let already = 0;
    for (const r of records) { r.done = await sourceKeyExists(db, r.sourceKey); if (r.done) already++; }
    const pending = records.filter((r) => !r.done);
    const linkCount = pending.reduce((a, r) => a + r.links.length, 0);

    console.log(`\n  Entries in the workbook:           ${records.length}`);
    console.log(`  …already imported earlier:         ${already}`);
    console.log(`  …to import now:                    ${pending.length}  (status: Awaiting check)`);
    console.log(`  Proof links on those entries:      ${linkCount}${DOWNLOAD ? " (each will be tried for download)" : " (kept as Drive links: --no-download)"}`);
    console.log(`  ORCID iDs:                         ${orcids.length}`);
    console.log(`  People (emails):                   ${emails.length}`);
    console.log(`  …already have a portal account:    ${emails.length - toCreate.length}`);
    console.log(`  …accounts to create (Faculty):     ${toCreate.length}`);
    if (authors.length) console.log(`  ! ${authors.length} email(s) belong to external AUTHOR accounts — their entries are imported but they can't open Achievements: ${authors.join(", ")}`);
    console.log(`  Office entries: people matched to an email: ${matched}, names kept without an account: ${unmatched}`);
    const topUnmatched = [...unmatchedNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
    if (topUnmatched.length) console.log(`    most frequent unmatched names: ${topUnmatched.map(([n, c]) => `${n} (${c})`).join(", ")}`);
    const noDate = pending.filter((r) => !r.achievementDate).length;
    if (noDate) console.log(`  Entries whose date couldn't be read (original text kept): ${noDate}`);
    if (skipped.length) console.log(`  Rows skipped: ${skipped.length} (${[...new Set(skipped.map((s) => s.reason))].join("; ")})`);

    // 6. Apply
    const result = new Map(); // sourceKey → { status, files, links, note }
    if (APPLY) {
      const storage = DOWNLOAD ? createImportStorage() : null;
      if (storage) console.log(`\n  File storage: ${storage.describe}`);

      // 6a. accounts
      let created = 0;
      for (const email of toCreate) {
        const p = people.get(email);
        try {
          await db.transaction((tx) => createRegisteredUser(tx, { name: p.name.slice(0, 191), email, baseType: "FACULTY", schoolCode: p.school }));
          created++;
        } catch (e) {
          if (e?.code !== "ER_DUP_ENTRY") throw e;
        }
      }
      const ids = new Map();
      for (let i = 0; i < emails.length; i += 500) {
        for (const u of await db.query(`SELECT id, email FROM \`${T.users}\` WHERE email IN (?)`, [emails.slice(i, i + 500)])) ids.set(u.email.toLowerCase(), u.id);
      }
      console.log(`  ✓ accounts created: ${created}`);

      // 6b. entries (downloads run 4 at a time)
      let done = 0, downloaded = 0, kept = 0, failed = 0;
      const reasons = new Map();
      await pool(pending, 4, async (r) => {
        const files = [];
        const links = [];
        const notes = [];
        for (const l of r.links) {
          if (storage && driveFileId(l.url)) {
            const d = await downloadDrive(l.url);
            if (d.ok) {
              const key = newStorageKey(d.ext);
              try {
                await storage.save(key, d.buffer, d.mime);
                files.push({ id: uuid(), slot: l.slot, key, name: d.name, mime: d.mime, size: d.buffer.length, sha: sha256(d.buffer) });
                continue;
              } catch (e) {
                notes.push(`storage error: ${e?.name || e?.message}`);
              }
            } else {
              notes.push(d.reason);
              reasons.set(d.reason, (reasons.get(d.reason) || 0) + 1);
            }
          }
          links.push(l);
        }
        try {
          await db.transaction((tx) => insertAchievement(tx, {
            id: uuid(),
            userId: ids.get(r.ownerEmail),
            data: { type: r.type, school: r.school, title: r.title, achievementDate: r.achievementDate, amountInr: r.amountInr, affiliation: r.affiliation, details: r.details },
            files, links, contributors: r.contributors, source: "IMPORT", sourceKey: r.sourceKey, createdAt: r.createdAt,
          }));
          done++; downloaded += files.length; kept += links.length;
          result.set(r.sourceKey, { status: "imported", files: files.length, links: links.length, note: [...new Set(notes)].join("; ") });
        } catch (e) {
          for (const f of files) await storage.remove(f.key);
          failed++;
          result.set(r.sourceKey, { status: e?.code === "ER_DUP_ENTRY" ? "already imported" : `failed: ${e?.code || e?.message}`, files: 0, links: 0, note: "" });
        }
        if ((done + failed) % 100 === 0) console.log(`    … ${done + failed} / ${pending.length}`);
      });
      console.log(`  ✓ entries imported: ${done}${failed ? `, failed: ${failed}` : ""}`);
      console.log(`  ✓ proof files downloaded and stored: ${downloaded}`);
      console.log(`  ✓ proof kept as Drive links (faculty will be asked to upload): ${kept}`);
      if (reasons.size) console.log(`    why links weren't downloaded: ${[...reasons.entries()].map(([k, v]) => `${k} (${v})`).join(", ")}`);

      // 6c. ORCID (latest per person; an existing value is kept)
      let orcidSet = 0;
      const latest = new Map();
      for (const o of orcids) latest.set(o.email, o.orcid);
      for (const [email, orcid] of latest) {
        const uid = ids.get(email);
        if (!uid) continue;
        const r = await db.exec(
          `INSERT INTO \`${T.facultyProfiles}\` (user_id, orcid, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE orcid = COALESCE(orcid, VALUES(orcid))`, [uid, orcid]);
        if (r.affectedRows) orcidSet++;
      }
      console.log(`  ✓ ORCID iDs saved: ${orcidSet}`);
    }

    // 7. Report
    const lines = [["Sheet", "Row", "Type", "Owner email", "Title", "Date", "School", "Proof links", "Contributors (email = will see it)", "Result", "Files stored", "Links kept", "Notes"].map(csvCell).join(",")];
    for (const r of records) {
      const res = result.get(r.sourceKey);
      lines.push([
        r.sheet, r.row, r.type, r.ownerEmail, r.title, r.achievementDate || r.details.date_text || "", r.school || r.details.school_text || "",
        r.links.length, r.contributors.map((c) => (c.email ? `${c.name} <${c.email}>` : c.name)).join("; "),
        r.done ? "already imported" : res ? res.status : APPLY ? "" : "would import", res?.files ?? "", res?.links ?? "", res?.note || "",
      ].map(csvCell).join(","));
    }
    for (const s of skipped) lines.push([s.sheet, s.row, "", "", "", "", "", "", "", `skipped: ${s.reason}`, "", "", ""].map(csvCell).join(","));
    writeFileSync(reportPath, "﻿" + lines.join("\r\n") + "\r\n", { mode: 0o600 });
    console.log(`\n  Report (one line per row): ${reportPath}`);
    console.log(APPLY ? "\n✓ Done.\n" : "\nNothing was written. Run again with --apply to import.\n");
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(`\n✗ ${e.message}\n`);
  process.exit(1);
});

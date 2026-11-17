/**
 * The import of the old Google-Forms achievement workbook — the database part,
 * shared by the command-line script (scripts/import-achievements.mjs) and the
 * Administrator's Import page (/achievements/import → /api/achievements/import).
 *
 *   plan = buildPlan(sheets, contributorsCsvText)      pure: rows → records, people, matches
 *   state = await loadState(db, plan)                  which accounts / rows already exist
 *   summary(plan, state)                               numbers for a preview
 *   ids = await createAccounts(db, plan, state)        Faculty accounts (no password, no admin, no roles)
 *   await importRecords(db, records, ids, { storage }) entries + files or Drive links + contributors
 *   await saveOrcids(db, plan, ids)                    ORCID iDs (an existing one is kept)
 *
 * `storage` is { save(key, buffer, mime), remove(key) } — the app's private store
 * (S3 or folder) — or null to keep every proof as its Drive link. Every row has a
 * stable key, so running any step again never duplicates anything.
 */
import { T } from "./db/tables.mjs";
import { uuid } from "./auth/crypto.mjs";
import { createRegisteredUser } from "./repos/users.mjs";
import { insertAchievement } from "./repos/achievements.mjs";
import { validateUpload, newStorageKey, sha256, ALLOWED, MAX_BYTES } from "./manuscriptFiles.js";
import {
  mapSheet, sheetConfig, createNameIndex, displayName, driveFileId, mapSchool, nameTokens, OFFICE_NAMES,
} from "./achievementImport.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Small RFC 4180 CSV parser (quoted cells, CRLF). */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/**
 * Map every sheet and work out who is who.
 * contributorsCsv: optional text with a header row "name,email[,school]".
 * → { sheets: [{ name, type, count, skipped }], unknownSheets, records, orcids, skipped,
 *     people: Map(email → { name, school }), matched, unmatched, unmatchedNames: [[name, count]] }
 */
export function buildPlan(sheets, contributorsCsv = "") {
  const records = [], orcids = [], skipped = [], sheetInfo = [], unknownSheets = [];
  for (const sh of sheets) {
    const cfg = sheetConfig(sh.name);
    if (!cfg) { unknownSheets.push(sh.name); continue; }
    const r = mapSheet(sh.name, sh.rows);
    records.push(...r.records);
    orcids.push(...r.orcids);
    skipped.push(...r.skipped.map((s) => ({ ...s, sheet: sh.name })));
    sheetInfo.push({ name: sh.name, type: cfg.type, count: cfg.type === "ORCID" ? r.orcids.length : r.records.length, skipped: r.skipped.length });
  }

  // Name → email: the contributors list first, then the workbook's own rows.
  const index = createNameIndex();
  const extraPeople = new Map();
  let contributorPairs = 0;
  if (String(contributorsCsv || "").trim()) {
    const rows = parseCsv(contributorsCsv);
    const head = (rows[0] || []).map((h) => h.trim().toLowerCase());
    const ni = head.indexOf("name"), ei = head.indexOf("email"), si = head.indexOf("school");
    if (ni < 0 || ei < 0) throw new Error('The contributors file needs a header row with "name" and "email".');
    for (const r of rows.slice(1)) {
      const name = (r[ni] || "").trim(), email = (r[ei] || "").trim().toLowerCase();
      if (!name || !EMAIL_RE.test(email)) continue;
      index.add(name, email);
      if (!extraPeople.has(email)) extraPeople.set(email, { name: displayName(name), school: mapSchool(si >= 0 ? r[si] : "") });
      contributorPairs++;
    }
  }
  const ownName = new Map(), ownSchool = new Map();
  const bump = (m, k, v) => { if (!v) return; if (!m.has(k)) m.set(k, new Map()); m.get(k).set(v, (m.get(k).get(v) || 0) + 1); };
  for (const r of records) {
    if (r.office) continue;
    const name = r.details.submitted_by_name || r.ownerName;
    if (name && !/[,&]|\band\b/i.test(name) && nameTokens(name).length >= 2) { index.add(name, r.ownerEmail); bump(ownName, r.ownerEmail, name); }
    bump(ownSchool, r.ownerEmail, r.school);
  }
  for (const o of orcids) { if (o.name) { index.add(o.name, o.email); bump(ownName, o.email, o.name); } bump(ownSchool, o.email, o.school); }
  const top = (m, k) => (m.has(k) ? [...m.get(k).entries()].sort((a, b) => b[1] - a[1])[0][0] : null);

  let matched = 0, unmatched = 0;
  const unmatchedNames = new Map();
  for (const r of records) {
    r.contributors = r.names.map((n) => {
      const email = index.match(n);
      if (email) matched++;
      else { unmatched++; unmatchedNames.set(displayName(n), (unmatchedNames.get(displayName(n)) || 0) + 1); }
      return { name: displayName(n), email };
    });
  }

  const people = new Map();
  const addPerson = (email) => {
    if (people.has(email)) return;
    const extra = extraPeople.get(email);
    people.set(email, {
      name: OFFICE_NAMES[email] || displayName(top(ownName, email) || extra?.name || email.split("@")[0].replace(/[._]/g, " ")),
      school: top(ownSchool, email) || extra?.school || null,
    });
  };
  for (const r of records) addPerson(r.ownerEmail);
  for (const o of orcids) addPerson(o.email);
  for (const r of records) for (const c of r.contributors) if (c.email) addPerson(c.email);

  return {
    sheets: sheetInfo, unknownSheets, records, orcids, skipped, people, contributorPairs,
    matched, unmatched, unmatchedNames: [...unmatchedNames.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/** Which accounts and rows already exist. Sets `r.done` on records imported before. */
export async function loadState(db, plan) {
  const emails = [...plan.people.keys()];
  const existing = new Map();
  for (let i = 0; i < emails.length; i += 500) {
    for (const u of await db.query(`SELECT id, email, baseType AS base_type FROM \`${T.users}\` WHERE email IN (?)`, [emails.slice(i, i + 500)])) {
      existing.set(u.email.toLowerCase(), u);
    }
  }
  const keys = plan.records.map((r) => r.sourceKey);
  const done = new Set();
  for (let i = 0; i < keys.length; i += 500) {
    for (const row of await db.query(`SELECT source_key FROM \`${T.achievements}\` WHERE source_key IN (?)`, [keys.slice(i, i + 500)])) done.add(row.source_key);
  }
  for (const r of plan.records) r.done = done.has(r.sourceKey);
  return {
    existing,
    toCreate: emails.filter((e) => !existing.has(e)),
    authors: emails.filter((e) => existing.get(e)?.base_type === "AUTHOR"),
    pending: plan.records.filter((r) => !r.done),
    already: plan.records.length - plan.records.filter((r) => !r.done).length,
  };
}

/** Numbers for a preview (plain JSON). */
export function summary(plan, state) {
  return {
    sheets: plan.sheets,
    unknownSheets: plan.unknownSheets,
    entries: plan.records.length,
    alreadyImported: state.already,
    toImport: state.pending.length,
    proofLinks: state.pending.reduce((a, r) => a + r.links.length, 0),
    orcids: plan.orcids.length,
    people: plan.people.size,
    existingAccounts: plan.people.size - state.toCreate.length,
    accountsToCreate: state.toCreate.length,
    authorAccounts: state.authors,
    contributorPairs: plan.contributorPairs,
    officeMatched: plan.matched,
    officeUnmatched: plan.unmatched,
    topUnmatchedNames: plan.unmatchedNames.slice(0, 25),
    noDate: state.pending.filter((r) => !r.achievementDate).length,
    skippedRows: plan.skipped.length,
    skippedReasons: [...new Set(plan.skipped.map((s) => s.reason))],
  };
}

/** Create the missing Faculty accounts. → Map(email → user id) for every person in the plan. */
export async function createAccounts(db, plan, state) {
  let created = 0;
  for (const email of state.toCreate) {
    const p = plan.people.get(email);
    try {
      await db.transaction((tx) => createRegisteredUser(tx, { name: p.name.slice(0, 191), email, baseType: "FACULTY", schoolCode: p.school }));
      created++;
    } catch (e) {
      if (!(e?.code === "ER_DUP_ENTRY" || e?.errno === 1062)) throw e;
    }
  }
  const ids = new Map();
  const emails = [...plan.people.keys()];
  for (let i = 0; i < emails.length; i += 500) {
    for (const u of await db.query(`SELECT id, email FROM \`${T.users}\` WHERE email IN (?)`, [emails.slice(i, i + 500)])) ids.set(u.email.toLowerCase(), u.id);
  }
  return { ids, created };
}

// ---- Google Drive download ------------------------------------------------------------

async function fetchCapped(url, limit) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(45_000), headers: { "User-Agent": "Mozilla/5.0 (portal import)" } });
  const cancel = async () => { try { await res.body?.cancel(); } catch { /* ignore */ } };
  if (!res.ok) { await cancel(); return { ok: false, reason: `HTTP ${res.status}` }; }
  if (/text\/html/i.test(res.headers.get("content-type") || "")) { await cancel(); return { ok: false, reason: "not shared publicly (Google sign-in page)" }; }
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > limit) { await cancel(); return { ok: false, reason: "larger than 25 MB" }; }
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

/**
 * Download a Google Drive file that is shared with "Anyone with the link" and
 * check it is a real PDF/DOCX/DOC. → { ok, buffer, ext, mime, name } | { ok: false, reason }
 * ACHIEVEMENT_IMPORT_DRIVE_URL (tests only) replaces Google's URL template ({id}).
 */
export async function downloadDrive(url) {
  const id = driveFileId(url);
  if (!id) return { ok: false, reason: "not a Google Drive file link" };
  let r;
  try {
    const tpl = process.env.ACHIEVEMENT_IMPORT_DRIVE_URL || "https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t";
    r = await fetchCapped(tpl.replace("{id}", encodeURIComponent(id)), MAX_BYTES);
  } catch (e) {
    return { ok: false, reason: e?.name === "TimeoutError" ? "timed out" : `network error (${e?.cause?.code || e?.message})` };
  }
  if (!r.ok) return r;
  const extGuess = (r.name || "").match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  const name = r.name || `document.${extGuess || "pdf"}`;
  const verdict = validateUpload({ originalName: name, declaredMime: r.mime, size: r.buffer.length, buffer: r.buffer });
  if (!verdict.ok) return { ok: false, reason: "not a PDF/DOCX/DOC" };
  return { ok: true, buffer: r.buffer, ext: verdict.ext, mime: ALLOWED[verdict.ext].mime, name: name.slice(0, 255) };
}

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  }));
}

/**
 * Import records (those not done yet). → { imported, failed, filesStored, linksKept, reasons: {reason: n}, results: Map(sourceKey → {...}) }
 */
export async function importRecords(db, records, ids, { storage = null, concurrency = 4, onProgress } = {}) {
  const out = { imported: 0, failed: 0, filesStored: 0, linksKept: 0, reasons: {}, results: new Map() };
  await pool(records.filter((r) => !r.done), concurrency, async (r) => {
    const files = [], links = [], notes = [];
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
            out.reasons["storage error"] = (out.reasons["storage error"] || 0) + 1;
          }
        } else {
          notes.push(d.reason);
          out.reasons[d.reason] = (out.reasons[d.reason] || 0) + 1;
        }
      }
      links.push(l);
    }
    const userId = ids.get(r.ownerEmail);
    try {
      if (!userId) throw Object.assign(new Error("no account"), { code: "NO_ACCOUNT" });
      await db.transaction((tx) => insertAchievement(tx, {
        id: uuid(),
        userId,
        data: { type: r.type, school: r.school, title: r.title, achievementDate: r.achievementDate, amountInr: r.amountInr, affiliation: r.affiliation, details: r.details },
        files, links, contributors: r.contributors, source: "IMPORT", sourceKey: r.sourceKey, createdAt: r.createdAt,
      }));
      r.done = true;
      out.imported++; out.filesStored += files.length; out.linksKept += links.length;
      out.results.set(r.sourceKey, { status: "imported", files: files.length, links: links.length, note: [...new Set(notes)].join("; ") });
    } catch (e) {
      for (const f of files) await storage.remove(f.key);
      const dup = e?.code === "ER_DUP_ENTRY" || e?.errno === 1062;
      if (dup) r.done = true; else out.failed++;
      out.results.set(r.sourceKey, { status: dup ? "already imported" : `failed: ${e?.code || e?.message}`, files: 0, links: 0, note: "" });
    }
    onProgress?.(out);
  });
  return out;
}

/** Save ORCID iDs (latest per person); a person's existing iD is kept. → number saved */
export async function saveOrcids(db, plan, ids) {
  const latest = new Map();
  for (const o of plan.orcids) latest.set(o.email, o.orcid);
  let n = 0;
  for (const [email, orcid] of latest) {
    const uid = ids.get(email);
    if (!uid) continue;
    const r = await db.exec(
      `INSERT INTO \`${T.facultyProfiles}\` (user_id, orcid, updated_at) VALUES (?, ?, UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE orcid = COALESCE(orcid, VALUES(orcid))`, [uid, orcid]);
    if (r.affectedRows) n++;
  }
  return n;
}

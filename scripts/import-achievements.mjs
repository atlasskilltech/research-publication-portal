/**
 * Import the old Google-Forms achievement workbook ("Faculty Research & Academic
 * Achievements Aggregate Sheet", 12 sheets) into the portal — command-line
 * version of the Administrator's Import page (/achievements/import). Both use
 * lib/achievementImportRunner.mjs.
 *
 *   npm run achievements:import -- <workbook.xlsx> [--contributors names.csv]           # PREVIEW (read-only)
 *   npm run achievements:import -- <workbook.xlsx> [--contributors names.csv] --apply   # write
 *     --no-download   keep every proof as its Google Drive link (don't try to fetch files)
 *     --report <file> where to write the per-row CSV report (default: OS temp folder)
 *
 * --apply: creates Faculty accounts (no password, no admin, no roles) for every
 * email that has none, adds every row as "Awaiting check" with its original
 * timestamp (rows imported before are skipped), stores each Drive file that is
 * shared publicly and is a real PDF/DOCX/DOC (otherwise keeps the link), links
 * the people named on office-submitted entries as contributors, saves ORCID iDs.
 *
 * --contributors: CSV with a header row "name,email[,school]" — names exactly as
 * on the office entries. Env: the same DB_* and storage settings as the app.
 */
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDb, createPool, dbConfigFromEnv } from "../lib/db/core.mjs";
import { readXlsx } from "../lib/xlsx.mjs";
import { createImportStorage } from "./lib/importStorage.mjs";
import { buildPlan, loadState, summary, createAccounts, importRecords, saveOrcids } from "../lib/achievementImportRunner.mjs";

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
const csvCell = (v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  console.log(`\n${APPLY ? "IMPORT (writes to the database)" : "PREVIEW (read-only — nothing is written)"} — ${path.basename(workbook)}\n`);
  const plan = buildPlan(readXlsx(workbook), contributorsCsv ? readFileSync(contributorsCsv, "utf8") : "");
  for (const s of plan.sheets) console.log(`  ${s.name.padEnd(34)} ${String(s.count).padStart(4)} ${s.type === "ORCID" ? "ORCID iDs" : "entries"}${s.skipped ? `, ${s.skipped} row(s) skipped` : ""}`);
  for (const n of plan.unknownSheets) console.log(`  ! sheet "${n}" not recognised — skipped`);

  const db = createDb(createPool({ ...dbConfigFromEnv(process.env), connectionLimit: 4 }));
  try {
    const state = await loadState(db, plan);
    const s = summary(plan, state);
    console.log(`\n  Entries in the workbook:           ${s.entries}`);
    console.log(`  …already imported earlier:         ${s.alreadyImported}`);
    console.log(`  …to import now:                    ${s.toImport}  (status: Awaiting check)`);
    console.log(`  Proof links on those entries:      ${s.proofLinks}${DOWNLOAD ? " (each will be tried for download)" : " (kept as Drive links: --no-download)"}`);
    console.log(`  ORCID iDs:                         ${s.orcids}`);
    console.log(`  People (emails):                   ${s.people}`);
    console.log(`  …already have a portal account:    ${s.existingAccounts}`);
    console.log(`  …accounts to create (Faculty):     ${s.accountsToCreate}`);
    if (s.authorAccounts.length) console.log(`  ! external AUTHOR accounts (can't open Achievements): ${s.authorAccounts.join(", ")}`);
    if (s.contributorPairs) console.log(`  Contributors file: ${s.contributorPairs} name → email pairs`);
    console.log(`  Office entries: people matched to an email: ${s.officeMatched}, names kept without an account: ${s.officeUnmatched}`);
    if (s.topUnmatchedNames.length) console.log(`    most frequent unmatched names: ${s.topUnmatchedNames.slice(0, 15).map(([n, c]) => `${n} (${c})`).join(", ")}`);
    if (s.noDate) console.log(`  Entries whose date couldn't be read (original text kept): ${s.noDate}`);
    if (s.skippedRows) console.log(`  Rows skipped: ${s.skippedRows} (${s.skippedReasons.join("; ")})`);

    let results = new Map();
    if (APPLY) {
      const storage = DOWNLOAD ? createImportStorage() : null;
      if (storage) console.log(`\n  File storage: ${storage.describe}`);
      const { ids, created } = await createAccounts(db, plan, state);
      console.log(`  ✓ accounts created: ${created}`);
      let last = 0;
      const r = await importRecords(db, state.pending, ids, {
        storage,
        onProgress: (o) => { const n = o.imported + o.failed; if (n - last >= 100) { last = n; console.log(`    … ${n} / ${state.pending.length}`); } },
      });
      results = r.results;
      console.log(`  ✓ entries imported: ${r.imported}${r.failed ? `, failed: ${r.failed}` : ""}`);
      console.log(`  ✓ proof files downloaded and stored: ${r.filesStored}`);
      console.log(`  ✓ proof kept as Drive links (faculty will be asked to upload): ${r.linksKept}`);
      if (Object.keys(r.reasons).length) console.log(`    why links weren't downloaded: ${Object.entries(r.reasons).map(([k, v]) => `${k} (${v})`).join(", ")}`);
      console.log(`  ✓ ORCID iDs saved: ${await saveOrcids(db, plan, ids)}`);
    }

    const lines = [["Sheet", "Row", "Type", "Owner email", "Title", "Date", "School", "Proof links", "Contributors (email = will see it)", "Result", "Files stored", "Links kept", "Notes"].map(csvCell).join(",")];
    for (const r of plan.records) {
      const res = results.get(r.sourceKey);
      lines.push([
        r.sheet, r.row, r.type, r.ownerEmail, r.title, r.achievementDate || r.details.date_text || "", r.school || r.details.school_text || "",
        r.links.length, r.contributors.map((c) => (c.email ? `${c.name} <${c.email}>` : c.name)).join("; "),
        res ? res.status : r.done ? "already imported" : APPLY ? "" : "would import", res?.files ?? "", res?.links ?? "", res?.note || "",
      ].map(csvCell).join(","));
    }
    for (const sk of plan.skipped) lines.push([sk.sheet, sk.row, "", "", "", "", "", "", "", `skipped: ${sk.reason}`, "", "", ""].map(csvCell).join(","));
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

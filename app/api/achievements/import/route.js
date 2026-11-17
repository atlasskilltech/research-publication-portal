// Administrator import of the old Google-Forms achievement workbook.
//
//   POST multipart  { workbook: .xlsx, contributors?: .csv }
//        → keeps the files in a private temp folder on the server and returns a
//          read-only PREVIEW: { token, summary }
//   POST JSON { action: "run", token, download }
//        → imports the next batch of rows (accounts are created first), so a
//          long import never hits a request time-out. The page calls it until
//          { remaining: 0 }; then ORCID iDs are saved and the temp files deleted.
//          Every row has a stable key, so a stopped import can simply be resumed.
//   POST JSON { action: "discard", token } → delete the temp files.
//
// Administrator only. The workbook never leaves this server (nothing is sent to
// GitHub or anywhere else); proof files that can be downloaded go to the same
// private store as every upload (lib/storage.js).
import { NextResponse } from "next/server";
import { mkdir, writeFile, readFile, rm, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { readXlsx } from "@/lib/xlsx.mjs";
import { buildPlan, loadState, summary, createAccounts, importRecords, saveOrcids } from "@/lib/achievementImportRunner.mjs";
import { saveManuscript, deleteManuscript } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ROOT = path.join(os.tmpdir(), "rpp-achievement-import");
const TOKEN_RE = /^[a-f0-9]{32}$/;
const MAX_WORKBOOK = 25 * 1024 * 1024;
const MAX_CSV = 1024 * 1024;
const BATCH = 20;

const dirFor = (token) => path.join(ROOT, token);

async function cleanupOld() {
  try {
    for (const name of await readdir(ROOT)) {
      const p = path.join(ROOT, name);
      if (Date.now() - (await stat(p)).mtimeMs > 24 * 3600 * 1000) await rm(p, { recursive: true, force: true });
    }
  } catch { /* nothing to clean */ }
}

async function loadPlan(token) {
  const dir = dirFor(token);
  const workbook = await readFile(path.join(dir, "workbook.xlsx"));
  let csv = "";
  try { csv = await readFile(path.join(dir, "contributors.csv"), "utf8"); } catch { /* optional */ }
  return buildPlan(readXlsx(workbook), csv);
}

const storageAdapter = { save: (key, buffer, mime) => saveManuscript(key, buffer, mime), remove: (key) => deleteManuscript(key) };

export async function POST(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

  const type = request.headers.get("content-type") || "";

  // ---- Upload + preview ------------------------------------------------------
  if (type.startsWith("multipart/form-data")) {
    const len = Number(request.headers.get("content-length"));
    if (!Number.isFinite(len) || len > MAX_WORKBOOK + MAX_CSV + 1024 * 1024) {
      return NextResponse.json({ error: "The file is too large (max 25 MB)." }, { status: 413 });
    }
    let form;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }
    const wb = form.get("workbook");
    const cs = form.get("contributors");
    if (!wb || typeof wb.arrayBuffer !== "function" || !wb.size) return NextResponse.json({ error: "Choose the Excel workbook (.xlsx)." }, { status: 422 });
    if (wb.size > MAX_WORKBOOK) return NextResponse.json({ error: "The workbook is larger than 25 MB." }, { status: 422 });
    const buf = Buffer.from(await wb.arrayBuffer());
    if (buf[0] !== 0x50 || buf[1] !== 0x4b || !/\.xlsx$/i.test(wb.name || "")) {
      return NextResponse.json({ error: "That isn't an Excel .xlsx file. In Google Sheets use File → Download → Microsoft Excel (.xlsx)." }, { status: 422 });
    }
    let csv = "";
    if (cs && typeof cs.arrayBuffer === "function" && cs.size) {
      if (cs.size > MAX_CSV) return NextResponse.json({ error: "The contributors file is larger than 1 MB." }, { status: 422 });
      csv = Buffer.from(await cs.arrayBuffer()).toString("utf8");
    }

    let plan;
    try {
      plan = buildPlan(readXlsx(buf), csv);
    } catch (e) {
      return NextResponse.json({ error: `Couldn't read the file: ${e.message}` }, { status: 422 });
    }
    if (!plan.records.length && !plan.orcids.length) {
      return NextResponse.json({ error: "No achievement sheets were found in this workbook. Is it the Faculty Research & Academic Achievements sheet?" }, { status: 422 });
    }

    await cleanupOld();
    const token = crypto.randomBytes(16).toString("hex");
    const dir = dirFor(token);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(path.join(dir, "workbook.xlsx"), buf, { mode: 0o600 });
    if (csv) await writeFile(path.join(dir, "contributors.csv"), csv, { mode: 0o600 });

    try {
      const state = await loadState(db, plan);
      return NextResponse.json({ token, summary: summary(plan, state) });
    } catch (e) {
      console.error("achievements import preview:", e?.code || e?.message);
      return NextResponse.json({ error: "Could not check the database. Please try again." }, { status: 500 });
    }
  }

  // ---- Run a batch / discard ---------------------------------------------------
  const body = await request.json().catch(() => ({}));
  const token = String(body?.token || "");
  if (!TOKEN_RE.test(token)) return NextResponse.json({ error: "This import has expired. Upload the file again." }, { status: 404 });

  if (body.action === "discard") {
    await rm(dirFor(token), { recursive: true, force: true });
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "run") return NextResponse.json({ error: "Unknown action." }, { status: 400 });

  let plan;
  try { plan = await loadPlan(token); } catch { return NextResponse.json({ error: "This import has expired. Upload the file again." }, { status: 404 }); }
  try {
    const state = await loadState(db, plan);
    const { ids, created } = await createAccounts(db, plan, state);
    const batch = state.pending.slice(0, BATCH);
    const r = await importRecords(db, batch, ids, { storage: body.download ? storageAdapter : null });
    const remaining = state.pending.length - batch.filter((x) => x.done).length;
    let orcidsSaved = null;
    if (remaining <= 0) {
      // finished: ORCID iDs, then remove the temp files
      orcidsSaved = await saveOrcids(db, plan, ids);
      await rm(dirFor(token), { recursive: true, force: true });
    }
    return NextResponse.json({
      accountsCreated: created,
      imported: r.imported,
      failed: r.failed,
      filesStored: r.filesStored,
      linksKept: r.linksKept,
      reasons: r.reasons,
      remaining: Math.max(0, remaining),
      total: plan.records.length,
      orcidsSaved,
      done: remaining <= 0,
    });
  } catch (e) {
    console.error("achievements import run:", e?.code || e?.message);
    return NextResponse.json({ error: "The import stopped because of a server error. Press “Continue import” to resume — nothing will be duplicated." }, { status: 500 });
  }
}

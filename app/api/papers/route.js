// Paper submissions:
//   POST — create a submission (metadata in MySQL + manuscript on the private
//          server filesystem). Multipart form: title, abstract, keywords,
//          school, authors (JSON), and the `manuscript` file.
//   GET  — list submissions: a submitter sees their own; an admin sees all.
//
// Security: identity from the session (never the client); the manuscript file
// is validated (size/signature/extension) before storage; the paper, authors,
// manuscript and activity rows are written in ONE transaction, and the stored
// file is deleted if that transaction fails. Author identity is kept in a
// separate table for double-blind review.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { logActivity } from "@/lib/repos/rows.mjs";
import { uuid } from "@/lib/auth/crypto.mjs";
import { notifyLater } from "@/lib/notifyServer";
import { validatePaperMeta } from "@/lib/validation";
import { ValidationError } from "@/lib/errors";
import { validateUpload, newStorageKey, sha256, MAX_BYTES, ALLOWED, requestTooLarge } from "@/lib/manuscriptFiles";
import { saveManuscript, deleteManuscript } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const papers = me.isAdmin
      ? await db.query(`SELECT id, title, status, school_code, submitted_by, created_at FROM \`${T.papers}\` ORDER BY created_at DESC`)
      : await db.query(
        `SELECT id, title, status, school_code, submitted_by, created_at FROM \`${T.papers}\` WHERE submitted_by = ? ORDER BY created_at DESC`,
        [me.id],
      ); // submitters: own only

    // Corresponding author is visible to the owner and to admins (not reviewers).
    const ids = papers.map((p) => p.id);
    const corr = new Map();
    const counts = new Map();
    if (ids.length) {
      const authors = await db.query(
        `SELECT paper_id, full_name, is_corresponding FROM \`${T.paperAuthors}\` WHERE paper_id IN (?)`, [ids]);
      authors.forEach((a) => {
        counts.set(a.paper_id, (counts.get(a.paper_id) || 0) + 1);
        if (a.is_corresponding) corr.set(a.paper_id, a.full_name);
      });
    }

    const rows = papers.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      school: p.school_code || null,
      createdAt: p.created_at,
      correspondingAuthor: corr.get(p.id) || null,
      authorCount: counts.get(p.id) || 0,
      mine: p.submitted_by === me.id,
    }));
    return NextResponse.json({ papers: rows });
  } catch (e) {
    console.error("papers GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load submissions." }, { status: 500 });
  }
}

export async function POST(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  // ---- Parse multipart form -------------------------------------------------
  if (requestTooLarge(request.headers)) {
    return NextResponse.json({ error: "File exceeds the 25 MB limit." }, { status: 413 });
  }
  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form submission." }, { status: 400 });
  }

  let meta;
  try {
    let authors = [];
    const authorsRaw = form.get("authors");
    if (typeof authorsRaw === "string" && authorsRaw) {
      try { authors = JSON.parse(authorsRaw); } catch { throw new ValidationError("Authors list is malformed."); }
    }
    meta = validatePaperMeta({
      title: form.get("title"),
      abstract: form.get("abstract"),
      keywords: form.get("keywords"),
      school: form.get("school"),
      authors,
    });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message, issues: e.fields }, { status: 422 });
    }
    throw e;
  }
  // Exactly one corresponding author (validatePaperMeta enforces it; re-checked
  // here because MySQL has no partial unique index to back it up).
  if (meta.authors.filter((a) => a.isCorresponding).length !== 1) {
    return NextResponse.json({ error: "Please check the submission.", issues: { corresponding: "Select exactly one corresponding author." } }, { status: 422 });
  }

  // ---- Validate the manuscript file (server-side, never trust the client) --
  const file = form.get("manuscript");
  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "Attach a manuscript file (PDF, DOCX or DOC)." }, { status: 422 });
  }
  if (typeof file.size === "number" && file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds the 25 MB limit." }, { status: 422 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const verdict = validateUpload({ originalName: file.name, declaredMime: file.type, size: buffer.length, buffer });
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: 422 });
  }
  // Trusted type from the verified signature, never the browser's.
  const mimeType = ALLOWED[verdict.ext].mime;

  // ---- Store the file, then write metadata in one transaction --------------
  const key = newStorageKey(verdict.ext);
  try {
    await saveManuscript(key, buffer);
  } catch (e) {
    console.error("papers POST: storage:", e?.message);
    return NextResponse.json({ error: "Could not store the manuscript. Please try again." }, { status: 500 });
  }

  const paperId = uuid();
  try {
    await db.transaction(async (tx) => {
      await tx.exec(
        `INSERT INTO \`${T.papers}\` (id, title, abstract, keywords, school_code, status, submitted_by, current_round, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'SUBMITTED', ?, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [paperId, meta.title, meta.abstract || "", JSON.stringify(meta.keywords || []), meta.school, me.id],
      );
      await tx.exec(
        `INSERT INTO \`${T.paperAuthors}\` (id, paper_id, full_name, email, affiliation, is_corresponding, author_order, created_at) VALUES ?`,
        [meta.authors.map((a) => [uuid(), paperId, a.fullName, a.email, a.affiliation, a.isCorresponding ? 1 : 0, a.order, new Date()])],
      );
      await tx.exec(
        `INSERT INTO \`${T.paperManuscripts}\` (id, paper_id, version, storage_key, original_filename, mime_type, byte_size, sha256, uploaded_by, created_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [uuid(), paperId, key, String(file.name || "").slice(0, 255), mimeType, buffer.length, sha256(buffer), me.id],
      );
      await logActivity(tx, paperId, me.id, "SUBMITTED", { authors: meta.authors.length });
    });
  } catch (e) {
    // The transaction rolled back (no half-written submission); remove the
    // stored file so no orphan remains.
    console.error("papers POST: db:", e?.code || e?.message);
    await deleteManuscript(key);
    return NextResponse.json({ error: "Could not save the submission. Please try again." }, { status: 500 });
  }

  notifyLater("SUBMISSION_RECEIVED", { paperId, actorId: me.id });
  return NextResponse.json({ ok: true, id: paperId }, { status: 201 });
}

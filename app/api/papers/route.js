// Paper submissions:
//   POST — create a submission (metadata in Supabase + manuscript on the private
//          server filesystem). Multipart form: title, abstract, keywords,
//          school, authors (JSON), and the `manuscript` file.
//   GET  — list submissions: a submitter sees their own; an admin sees all.
//
// Security: identity from the session (never the client); writes via the
// service role; the manuscript file is validated (size/signature/extension)
// before storage; a failed DB write cleans up the orphan file. Author identity
// is kept in a separate table for double-blind review.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
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
    const admin = createAdminClient();
    let q = admin
      .from("papers")
      .select("id, title, status, school_code, submitted_by, created_at")
      .order("created_at", { ascending: false });
    if (!me.isAdmin) q = q.eq("submitted_by", me.id); // submitters: own only
    const { data: papers, error } = await q;
    if (error) throw error;

    // Corresponding author is visible to the owner and to admins (not reviewers).
    const ids = (papers || []).map((p) => p.id);
    const corr = new Map();
    const counts = new Map();
    if (ids.length) {
      const { data: authors } = await admin
        .from("paper_authors")
        .select("paper_id, full_name, is_corresponding")
        .in("paper_id", ids);
      (authors || []).forEach((a) => {
        counts.set(a.paper_id, (counts.get(a.paper_id) || 0) + 1);
        if (a.is_corresponding) corr.set(a.paper_id, a.full_name);
      });
    }

    const rows = (papers || []).map((p) => ({
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
    console.error("papers GET:", e?.message);
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
  // Browsers sometimes omit the type (notably for .doc); fall back to the
  // canonical MIME for the validated extension so the NOT NULL column is safe.
  const mimeType = ALLOWED[verdict.ext].mime; // trusted type from the verified signature, never the browser's

  // ---- Store the file, then write metadata; clean up the orphan on failure --
  const key = newStorageKey(verdict.ext);
  try {
    await saveManuscript(key, buffer);
  } catch (e) {
    console.error("papers POST: storage:", e?.message);
    return NextResponse.json({ error: "Could not store the manuscript. Please try again." }, { status: 500 });
  }

  const admin = createAdminClient();
  let paperId = null;
  try {
    const { data: paper, error: pErr } = await admin
      .from("papers")
      .insert({ title: meta.title, abstract: meta.abstract, keywords: meta.keywords, school_code: meta.school, submitted_by: me.id, status: "SUBMITTED" })
      .select("id")
      .single();
    if (pErr) throw pErr;
    paperId = paper.id;

    const authorRows = meta.authors.map((a) => ({
      paper_id: paperId, full_name: a.fullName, email: a.email, affiliation: a.affiliation,
      is_corresponding: a.isCorresponding, author_order: a.order,
    }));
    const { error: aErr } = await admin.from("paper_authors").insert(authorRows);
    if (aErr) throw aErr;

    const { error: mErr } = await admin.from("paper_manuscripts").insert({
      paper_id: paperId, storage_key: key, original_filename: String(file.name || "").slice(0, 255),
      mime_type: mimeType, byte_size: buffer.length, sha256: sha256(buffer), uploaded_by: me.id,
    });
    if (mErr) throw mErr;

    await admin.from("paper_activity").insert({ paper_id: paperId, actor: me.id, action: "SUBMITTED", detail: { authors: authorRows.length } });

    notifyLater("SUBMISSION_RECEIVED", { paperId, actorId: me.id });
    return NextResponse.json({ ok: true, id: paperId }, { status: 201 });
  } catch (e) {
    // Compensating cleanup: remove the stored file and any partial paper row
    // (children cascade) so no orphan file or half-written submission remains.
    console.error("papers POST: db:", e?.message);
    await deleteManuscript(key);
    if (paperId) { try { await admin.from("papers").delete().eq("id", paperId); } catch {} }
    return NextResponse.json({ error: "Could not save the submission. Please try again." }, { status: 500 });
  }
}

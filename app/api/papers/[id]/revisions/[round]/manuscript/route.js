// Author uploads the revised manuscript for revision <round> (multipart field
// `manuscript`). Reuses the Phase 1 file pipeline: server-side validation
// (25 MB, PDF/DOCX/DOC magic bytes), a fresh unpredictable storage key, and the
// private filesystem store (outside the web root).
//
// Versioning: the file is stored as version = <round> (>= 1), so the original
// (version 0) and every earlier round are never touched. While the revision is
// still a draft the author may replace THIS round's file; the replaced file is
// deleted only after the database commit succeeds.
//
// Consistency: file first, then attachRevisionManuscript() (one MySQL transaction).
// If the DB step fails, the new file is deleted (compensating cleanup), so no
// orphan file or half-written version remains.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { attachRevisionManuscript } from "@/lib/services/workflow.mjs";
import { loadPaperContext } from "@/lib/paperAccess";
import { canAuthorEdit, mapRpcError } from "@/lib/revisionLogic";
import { validateUpload, newStorageKey, sha256, MAX_BYTES, ALLOWED, requestTooLarge } from "@/lib/manuscriptFiles";
import { saveManuscript, deleteManuscript } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id, round: roundParam } = await params;
  const round = Number(roundParam);
  if (!Number.isInteger(round) || round < 1) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // Authorize BEFORE reading the (possibly large) body.
  try {
    const ctx = await loadPaperContext(db, id, me);
    if (!ctx) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const gate = canAuthorEdit({ paper: ctx.paper, revision: ctx.revisions.find((r) => r.round === round), userId: me.id });
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  } catch (e) {
    console.error("revision manuscript auth:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not upload the manuscript." }, { status: 500 });
  }

  if (requestTooLarge(request.headers)) {
    return NextResponse.json({ error: "File exceeds the 25 MB limit." }, { status: 413 });
  }
  let form;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Invalid upload." }, { status: 400 }); }
  const file = form.get("manuscript");
  if (!file || typeof file.arrayBuffer !== "function") {
    return NextResponse.json({ error: "Attach the revised manuscript (PDF, DOCX or DOC)." }, { status: 422 });
  }
  if (typeof file.size === "number" && file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File exceeds the 25 MB limit." }, { status: 422 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const verdict = validateUpload({ originalName: file.name, declaredMime: file.type, size: buffer.length, buffer });
  if (!verdict.ok) return NextResponse.json({ error: verdict.error }, { status: 422 });
  const mimeType = ALLOWED[verdict.ext].mime; // trusted type from the verified signature, never the browser's

  const key = newStorageKey(verdict.ext);
  try {
    await saveManuscript(key, buffer, mimeType);
  } catch (e) {
    console.error("revision manuscript storage:", e?.name, e?.message);
    return NextResponse.json({ error: "Could not store the manuscript. Please try again." }, { status: 500 });
  }

  try {
    let replacedKey;
    try {
      replacedKey = await attachRevisionManuscript(db, {
        paperId: id, round, actorId: me.id, key,
        filename: String(file.name || "").slice(0, 255), mime: mimeType,
        size: buffer.length, sha: sha256(buffer),
      });
    } catch (error) {
      const mapped = mapRpcError(error);
      if (mapped) {
        await deleteManuscript(key); // compensating cleanup
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }
      throw error; // outer catch deletes the new file
    }
    // Committed: the previous DRAFT file for this round is no longer referenced.
    if (replacedKey) await deleteManuscript(replacedKey);
    return NextResponse.json({ ok: true, version: round, byteSize: buffer.length }, { status: 201 });
  } catch (e) {
    console.error("revision manuscript db:", e?.code || e?.message);
    await deleteManuscript(key);
    return NextResponse.json({ error: "Could not save the manuscript. Please try again." }, { status: 500 });
  }
}

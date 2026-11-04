// Authenticated manuscript download. Only the owner, an admin, or an assigned
// reviewer may fetch the file. The bytes are read from the private server
// filesystem (never a public URL); the filesystem path is never exposed.
// Reviewers receive a neutral, identity-free filename (double-blind).
//
// Versions (Phase 3): ?version=N selects a manuscript version (0 = original).
// Owner/admin may fetch any version; an assigned user only RELEASED versions
// (<= the round released for re-review). Without ?version, the latest version
// the caller may access is served.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db, T } from "@/lib/db";
import { logActivity } from "@/lib/repos/rows.mjs";
import { neutralDownloadName, mimeForStorageKey } from "@/lib/manuscriptFiles";
import { readManuscript } from "@/lib/storage";
import { loadPaperContext } from "@/lib/paperAccess";
import { permittedVersions, defaultVersion } from "@/lib/revisionLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  try {
    const ctx = await loadPaperContext(db, id, me);
    if (!ctx) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const privileged = me.isAdmin || ctx.isOwner;
    if (!privileged && !ctx.isAssigned) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const all = await db.query(
      `SELECT version, storage_key, mime_type, original_filename, byte_size FROM \`${T.paperManuscripts}\` WHERE paper_id = ?`, [id]);
    // Managers (admin / the paper's EDITOR) need every version — including a
    // submitted revision before it is released to reviewers — to check it.
    // Filenames stay owner/admin-only (below).
    const allowed = permittedVersions(privileged || ctx.canManage ? "owner" : "assigned", all, ctx.released);

    const vParam = new URL(request.url).searchParams.get("version");
    let m;
    if (vParam !== null) {
      const v = Number(vParam);
      // An unreleased or nonexistent version looks the same: 404.
      m = Number.isInteger(v) ? allowed.find((x) => x.version === v) : null;
    } else {
      m = defaultVersion(allowed);
    }
    if (!m) return NextResponse.json({ error: "No manuscript on file." }, { status: 404 });

    const bytes = await readManuscript(m.storage_key);
    if (!bytes) {
      // Metadata exists but the file is missing from storage.
      console.error("manuscript download: file missing for paper", id);
      return NextResponse.json({ error: "The manuscript file is unavailable on the server." }, { status: 410 });
    }

    // Audit reviewer access to the manuscript (admin-only visibility; owners
    // never see this action — see OWNER_VISIBLE_ACTIONS).
    if (!privileged) {
      try {
        await logActivity(db, id, me.id, "MANUSCRIPT_DOWNLOADED", { version: m.version });
      } catch (e) {
        console.error("manuscript audit:", e?.code || e?.message);
      }
    }

    const ext = m.storage_key.split(".").pop();
    const neutral = neutralDownloadName(id, ext).replace(/\.(\w+)$/, m.version ? `-v${m.version}.$1` : ".$1");
    const filename = privileged && m.original_filename ? m.original_filename : neutral;
    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeForStorageKey(m.storage_key),
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("manuscript download:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not fetch the manuscript." }, { status: 500 });
  }
}

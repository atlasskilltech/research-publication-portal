// Authenticated manuscript download. Only the owner, an admin, or an assigned
// reviewer may fetch the file. The bytes are read from the private server
// filesystem (never a public URL); the filesystem path is never exposed.
// Reviewers receive a neutral, identity-free filename (double-blind).
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { neutralDownloadName } from "@/lib/manuscriptFiles";
import { manuscriptPath as resolvePath } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;

  try {
    const admin = createAdminClient();
    const { data: paper } = await admin.from("papers").select("submitted_by").eq("id", id).maybeSingle();
    if (!paper) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const isOwner = paper.submitted_by === me.id;
    let isAssigned = false;
    if (!me.isAdmin && !isOwner) {
      const { data: a } = await admin.from("paper_assignments").select("assignee").eq("paper_id", id).eq("assignee", me.id).maybeSingle();
      isAssigned = !!a;
    }
    const privileged = me.isAdmin || isOwner;
    if (!privileged && !isAssigned) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const { data: m } = await admin
      .from("paper_manuscripts")
      .select("storage_key, mime_type, original_filename, byte_size")
      .eq("paper_id", id)
      .maybeSingle();
    if (!m) return NextResponse.json({ error: "No manuscript on file." }, { status: 404 });

    const full = resolvePath(m.storage_key);
    if (!full) return NextResponse.json({ error: "Unavailable." }, { status: 500 });

    let bytes;
    try {
      bytes = await readFile(full);
    } catch {
      // Metadata exists but the file is missing (e.g. non-persistent storage lost it).
      console.error("manuscript download: file missing for paper", id);
      return NextResponse.json({ error: "The manuscript file is unavailable on the server." }, { status: 410 });
    }

    // Audit reviewer access to the manuscript (admin-only visibility; owners
    // never see this action — see OWNER_VISIBLE_ACTIONS).
    if (!privileged) {
      await admin.from("paper_activity")
        .insert({ paper_id: id, actor: me.id, action: "MANUSCRIPT_DOWNLOADED", detail: {} })
        .then(({ error }) => { if (error) console.error("manuscript audit:", error.message); });
    }

    const ext = m.storage_key.split(".").pop();
    const filename = privileged && m.original_filename ? m.original_filename : neutralDownloadName(id, ext);
    const safeName = filename.replace(/[^A-Za-z0-9._-]/g, "_");

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": m.mime_type || "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("manuscript download:", e?.message);
    return NextResponse.json({ error: "Could not fetch the manuscript." }, { status: 500 });
  }
}

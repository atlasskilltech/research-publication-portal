// PUBLIC (no session): download the FINAL manuscript of a PUBLISHED paper, only
// when its editor explicitly made it public (publications.manuscript_public).
// Bytes are streamed from the private store; no storage key, path or internal
// id is ever exposed, and the filename is neutral. Anything else → 404.
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { getPublicManuscriptRef } from "@/lib/publicCatalog";
import { manuscriptPath } from "@/lib/storage";
import { mimeForStorageKey } from "@/lib/manuscriptFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  try {
    const ref = await getPublicManuscriptRef(id);
    if (!ref) return NextResponse.json({ error: "Not found." }, { status: 404 });
    const full = manuscriptPath(ref.storageKey);
    if (!full) return NextResponse.json({ error: "Not found." }, { status: 404 });
    let bytes;
    try { bytes = await readFile(full); } catch {
      console.error("public manuscript: file missing for publication", id);
      return NextResponse.json({ error: "The file is unavailable." }, { status: 410 });
    }
    const ext = ref.storageKey.split(".").pop();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mimeForStorageKey(ref.storageKey),
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="publication-${String(id).slice(0, 8)}.${ext}"`,
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("public manuscript GET:", e?.message);
    return NextResponse.json({ error: "Could not fetch the file." }, { status: 500 });
  }
}

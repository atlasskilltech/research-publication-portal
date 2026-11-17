// Download one proof document of an achievement — only its owner, a
// contributor named on it (matched by email), or an Administrator. The served type comes from the server-made storage key,
// never from what the browser declared at upload time.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { getAchievementFile, isContributor } from "@/lib/repos/achievements.mjs";
import { mimeForStorageKey } from "@/lib/manuscriptFiles";
import { readManuscript } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID_RE = /^[0-9a-f-]{36}$/i;

function safeName(name, key) {
  const ext = String(key).split(".").pop();
  const base = String(name || "document").replace(/\.[A-Za-z0-9]+$/, "").replace(/[^\w.\- ]+/g, "_").trim().slice(0, 120) || "document";
  return `${base}.${ext}`;
}

export async function GET(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id, fileId } = await params;
  if (!ID_RE.test(id) || !ID_RE.test(fileId)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  try {
    const f = await getAchievementFile(db, id, fileId);
    if (!f) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (f.user_id !== me.id && !me.isAdmin && !(me.baseType !== "AUTHOR" && (await isContributor(db, id, me.email)))) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    const bytes = await readManuscript(f.storage_key);
    if (!bytes) return NextResponse.json({ error: "The file is missing from storage." }, { status: 404 });
    const mime = mimeForStorageKey(f.storage_key);
    // PDFs open in the browser tab; Word files download.
    const inline = request.nextUrl.searchParams.get("download") !== "1" && mime === "application/pdf";
    const name = safeName(f.original_filename, f.storage_key);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (e) {
    console.error("achievement file GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not download the file." }, { status: 500 });
  }
}

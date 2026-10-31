// PUBLIC (no session): published papers only, whitelisted fields only.
//   GET ?q=<title|author|keyword>&year=&volumeId=&issueId=&limit=&offset=
import { NextResponse } from "next/server";
import { getPublishedCatalog } from "@/lib/publicCatalog";
import { matchesSearch } from "@/lib/publicationLogic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const sp = new URL(request.url).searchParams;
    const q = (sp.get("q") || "").slice(0, 200);
    const year = Number(sp.get("year")) || null;
    const volumeId = sp.get("volumeId") || null;
    const issueId = sp.get("issueId") || null;
    const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 100);
    const offset = Math.max(Number(sp.get("offset")) || 0, 0);

    const { publications } = await getPublishedCatalog();
    const filtered = publications.filter((p) =>
      (!year || p.year === year) &&
      (!volumeId || p.volume.id === volumeId) &&
      (!issueId || p.issue.id === issueId) &&
      matchesSearch(p, q));
    return NextResponse.json(
      { total: filtered.length, publications: filtered.slice(offset, offset + limit) },
      { headers: { "Cache-Control": "public, max-age=60" } },
    );
  } catch (e) {
    console.error("public publications GET:", e?.message);
    return NextResponse.json({ error: "Could not load publications." }, { status: 500 });
  }
}

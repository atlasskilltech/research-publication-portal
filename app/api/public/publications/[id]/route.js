// PUBLIC (no session): one published paper, or 404 (unpublished looks absent).
import { NextResponse } from "next/server";
import { getPublishedPublication } from "@/lib/publicCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  try {
    const p = await getPublishedPublication(id);
    if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json({ publication: p }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    console.error("public publication GET:", e?.message);
    return NextResponse.json({ error: "Could not load the publication." }, { status: 500 });
  }
}

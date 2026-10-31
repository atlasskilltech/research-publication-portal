// PUBLIC (no session): one published volume + its published issues and papers.
import { NextResponse } from "next/server";
import { getPublishedVolume } from "@/lib/publicCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { volumeId } = await params;
  try {
    const data = await getPublishedVolume(volumeId);
    if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    console.error("public volume GET:", e?.message);
    return NextResponse.json({ error: "Could not load the volume." }, { status: 500 });
  }
}

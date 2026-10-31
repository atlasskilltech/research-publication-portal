// PUBLIC (no session): published volumes with their published issues.
import { NextResponse } from "next/server";
import { getPublishedCatalog } from "@/lib/publicCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { volumes } = await getPublishedCatalog();
    return NextResponse.json({ volumes }, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    console.error("public volumes GET:", e?.message);
    return NextResponse.json({ error: "Could not load volumes." }, { status: 500 });
  }
}

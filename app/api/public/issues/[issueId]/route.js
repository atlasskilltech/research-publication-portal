// PUBLIC (no session): one published issue + its published papers.
import { NextResponse } from "next/server";
import { getPublishedIssue } from "@/lib/publicCatalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { issueId } = await params;
  try {
    const data = await getPublishedIssue(issueId);
    if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
    return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=60" } });
  } catch (e) {
    console.error("public issue GET:", e?.message);
    return NextResponse.json({ error: "Could not load the issue." }, { status: 500 });
  }
}

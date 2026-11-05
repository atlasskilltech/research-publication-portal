// Admin-only: one user's papers and their relationship to each (author,
// co-author, POC, reviewer, editor). Read-only, paginated.
//   GET ?status=&page=1&pageSize=25
//   200 { user, total, page, pageSize, papers[] } | 401 | 403 | 404 | 500
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { normalizeStatsQuery, userPapers } from "@/lib/repos/paperStats.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const { id } = await params;
  if (typeof id !== "string" || !id || id.length > 191) return NextResponse.json({ error: "User not found." }, { status: 404 });

  try {
    const { status, page, pageSize } = normalizeStatsQuery(new URL(request.url).searchParams);
    const result = await userPapers(db, id, { status, page, pageSize });
    if (!result) return NextResponse.json({ error: "User not found." }, { status: 404 });
    return NextResponse.json(result);
  } catch (e) {
    console.error("admin/stats user GET: error:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load this user's papers." }, { status: 500 });
  }
}

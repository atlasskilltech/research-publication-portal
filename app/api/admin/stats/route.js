// Admin-only paper statistics: summary cards + one page of users with their
// paper counts (lib/repos/paperStats.mjs — SQL aggregation, read-only).
//   GET ?search=&role=&status=&sort=&includeZero=1&page=1&pageSize=25
//   200 { summary, total, page, pageSize, users[] } | 401 | 403 | 500
// Authorization comes from the SESSION only (never a client flag).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { normalizeStatsQuery, statsSummary, userPaperStats } from "@/lib/repos/paperStats.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

  try {
    const opts = normalizeStatsQuery(new URL(request.url).searchParams);
    const [summary, page] = await Promise.all([statsSummary(db), userPaperStats(db, opts)]);
    return NextResponse.json({ summary, ...page, filters: opts });
  } catch (e) {
    console.error("admin/stats GET: error:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load paper statistics." }, { status: 500 });
  }
}

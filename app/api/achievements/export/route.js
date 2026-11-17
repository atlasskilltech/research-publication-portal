// Administrator export of achievements as CSV (opens directly in Excel), with
// the same filters as the list: type, school, status, year ("2026-27").
// Choosing one type gives that type's fields their own columns.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { listAchievements } from "@/lib/repos/achievements.mjs";
import {
  ACHIEVEMENT_TYPES, ACHIEVEMENT_SCHOOLS, ACHIEVEMENT_STATUSES, academicYearRange, achievementsCsv,
} from "@/lib/achievementTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });

  const sp = request.nextUrl.searchParams;
  const filters = {};
  const type = sp.get("type");
  const school = sp.get("school");
  const status = sp.get("status");
  const year = sp.get("year");
  if (type && ACHIEVEMENT_TYPES[type]) filters.type = type;
  if (school && ACHIEVEMENT_SCHOOLS.includes(school)) filters.school = school;
  if (status && ACHIEVEMENT_STATUSES.includes(status)) filters.status = status;
  const range = academicYearRange(year);
  if (range) Object.assign(filters, range);

  try {
    const rows = await listAchievements(db, filters);
    const csv = achievementsCsv(rows);
    const parts = ["achievements", filters.type ? filters.type.toLowerCase() : null, range ? year : null].filter(Boolean);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${parts.join("-")}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    console.error("achievements export:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not export achievements." }, { status: 500 });
  }
}

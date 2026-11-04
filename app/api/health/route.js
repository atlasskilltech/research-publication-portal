// Liveness probe. GET /api/health reports whether the app can reach MySQL.
// Never returns credentials — only the database host and latency.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const host = process.env.DB_HOST || "unknown";
  const startedAt = performance.now();
  try {
    await db.one("SELECT 1 AS ok");
    return NextResponse.json({
      ok: true,
      db: { ok: true, target: host, latencyMs: Number((performance.now() - startedAt).toFixed(1)) },
    });
  } catch {
    return NextResponse.json({ ok: false, db: { ok: false, target: host, message: "Unable to reach the database." } }, { status: 503 });
  }
}

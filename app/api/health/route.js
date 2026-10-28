// Liveness probe. GET /api/health returns whether the app can reach MySQL.
// Useful for confirming a deployment's database configuration without logging
// in. It never returns credentials — only host:port/name and latency.
import { NextResponse } from "next/server";
import { healthCheck } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await healthCheck();
  return NextResponse.json({ ok: db.ok, db }, { status: db.ok ? 200 : 503 });
}

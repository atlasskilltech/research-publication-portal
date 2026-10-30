// Liveness probe. GET /api/health reports whether the app can reach Supabase.
// Useful for confirming a deployment's configuration without signing in. It
// never returns credentials — only the project host and latency.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadSupabaseConfig } from "@/lib/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let host = "unknown";
  const startedAt = performance.now();
  try {
    host = new URL(loadSupabaseConfig().url).host;
    const supabase = await createClient();
    // A head-only count touches PostgREST and the `profiles` table. Under RLS an
    // anonymous caller simply sees zero rows — reaching the API without an error
    // is what proves connectivity and that the schema is deployed.
    const { error } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true });
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      db: { ok: true, target: host, latencyMs: Number((performance.now() - startedAt).toFixed(1)) },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        db: { ok: false, target: host, message: "Unable to reach Supabase." },
      },
      { status: 503 },
    );
  }
}

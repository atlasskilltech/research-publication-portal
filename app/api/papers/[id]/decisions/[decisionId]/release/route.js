// Communicate a saved decision to the author (admin / paper EDITOR).
//   POST { expectedVersion }
// Applies the effect atomically in release_editorial_decision() (0008):
// ACCEPT → ACCEPTED, REJECT → REJECTED, MINOR/MAJOR → Phase 3 revision request.
// Once communicated, the decision is immutable. A stale expectedVersion (someone
// else edited the draft) or a second/concurrent release returns 409.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { releaseDecision } from "@/lib/decisionService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id, decisionId } = await params;

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return NextResponse.json({ error: "Reload the decision before communicating it." }, { status: 422 });
  }

  try {
    const admin = createAdminClient();
    const r = await releaseDecision(admin, id, me, decisionId, expectedVersion);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("decision release:", e?.message);
    return NextResponse.json({ error: "Could not communicate the decision." }, { status: 500 });
  }
}

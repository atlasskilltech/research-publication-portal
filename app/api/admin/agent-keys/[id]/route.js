// Admin-only: revoke an IntelligenceOS Agent API key (POST { action: "revoke" }).
// Revoking is permanent; the key stops working on its next request (401).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { revokeApiKey } from "@/lib/agentApi/keys.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (body?.action !== "revoke") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return NextResponse.json({ error: "Key not found." }, { status: 404 });
  try {
    const found = await revokeApiKey(db, { id, actorId: me.id });
    if (!found) return NextResponse.json({ error: "Key not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("admin/agent-keys revoke:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not revoke the key." }, { status: 500 });
  }
}

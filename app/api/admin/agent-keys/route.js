// Admin-only: IntelligenceOS Agent API keys.
//   GET  — list keys (name, permissions, expiry, last used, state; never the key or its hash)
//   POST — create a key { name, scopes[], expiresAt? } → the plain key is returned ONCE
// Identity comes from the session cookie; CSRF is enforced by middleware.js.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { db } from "@/lib/db";
import { createApiKey, listApiKeys, validateNewKey, SCOPES, PRESETS } from "@/lib/agentApi/keys.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function admin() {
  const me = await getSessionUser();
  if (!me) return { res: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (!me.isAdmin) return { res: NextResponse.json({ error: "Administrator access is required." }, { status: 403 }) };
  return { me };
}

export async function GET() {
  const { me, res } = await admin();
  if (!me) return res;
  try {
    return NextResponse.json({ keys: await listApiKeys(db), scopes: SCOPES, presets: PRESETS }, { headers: NO_STORE });
  } catch (e) {
    console.error("admin/agent-keys GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load keys." }, { status: 500 });
  }
}

export async function POST(request) {
  const { me, res } = await admin();
  if (!me) return res;
  const body = await request.json().catch(() => null);
  const v = validateNewKey(body || {});
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 422 });
  try {
    const { key, record } = await createApiKey(db, { ...v.value, createdBy: me.id });
    return NextResponse.json({ key, record }, { status: 201, headers: NO_STORE });
  } catch (e) {
    console.error("admin/agent-keys POST:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not create the key." }, { status: 500 });
  }
}

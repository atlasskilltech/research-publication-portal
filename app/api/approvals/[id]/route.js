// Act on one Program Chair approval request.
//   POST { action: "approve" | "return", comment? }
//   approve → the editor's decision is communicated to the author unchanged
//             (accept, or the revision request), in one transaction.
//   return  → sent back to the editor; `comment` is required.
// Program Chair or administrator only; re-checked inside the transaction.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { actOnApproval } from "@/lib/approvalService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request, { params }) {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(String(id))) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }); }
  const action = String(body?.action || "").toLowerCase();
  const comment = typeof body?.comment === "string" ? body.comment : "";

  try {
    const r = await actOnApproval(id, me, action, comment);
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    console.error("approvals POST:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not complete the approval action." }, { status: 500 });
  }
}

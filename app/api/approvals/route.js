// Program Chair "Final Approvals" data.
//   GET — the Program Chair or an administrator: every decision waiting for
//         final approval (paper, AUTHOR NAMES, the editor's decision and the
//         submitted reviews) + the 50 most recent approvals / send-backs.
//         Anyone else: 403.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { canApprove, loadApprovals } from "@/lib/approvalService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const me = await getSessionUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canApprove(me)) return NextResponse.json({ error: "Only the Program Chair or an administrator can view final approvals." }, { status: 403 });
  try {
    const data = await loadApprovals(me);
    return NextResponse.json({ role: me.isProgramChair ? "chair" : "admin", ...data });
  } catch (e) {
    console.error("approvals GET:", e?.code || e?.message);
    return NextResponse.json({ error: "Could not load approvals." }, { status: 500 });
  }
}

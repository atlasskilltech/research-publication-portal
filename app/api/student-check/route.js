// Optional pre-check endpoint for inline UX on the registration form: lets the
// student's Application Number be validated before they submit the whole form.
//
// This is a convenience only. It is NOT the authoritative gate — /api/register
// re-runs verifyApplicationNo server-side, so a client that skips or fakes this
// call still cannot register an unverified number. The secret API key never
// leaves the server; this route returns only a coarse status string.
import { NextResponse } from "next/server";
import { verifyApplicationNo } from "@/lib/studentCheck";
import { normalizeApplicationNo } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  let applicationNo = "";
  try {
    const body = await request.json();
    applicationNo = normalizeApplicationNo(body?.applicationNo);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!applicationNo) {
    return NextResponse.json({ error: "Enter your application number." }, { status: 422 });
  }

  const { status } = await verifyApplicationNo(applicationNo);
  if (status === "exists") return NextResponse.json({ ok: true });
  if (status === "not_found") {
    return NextResponse.json(
      { error: "We couldn't find that application number." },
      { status: 422 },
    );
  }
  // unavailable
  return NextResponse.json(
    { error: "Verification is temporarily unavailable. Please try again." },
    { status: 503 },
  );
}

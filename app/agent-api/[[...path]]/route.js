// IntelligenceOS Agent API (spec atlas-agent-api/1) — https://<host>/agent-api
//
// Server-to-server only: authenticated by an admin-issued API key
// (Authorization: Bearer atl_…), never by the session cookie. All logic lives in
// lib/agentApi/handler.mjs (shared with the test scripts). This path is outside
// /api/* so the browser-CSRF middleware does not apply — there are no cookies
// involved, and every request must carry a valid key.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { programChairEmails } from "@/lib/config/env";
import { createAgentApi, MAX_BODY_CHARS } from "@/lib/agentApi/handler.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY = Symbol.for("rpp.agentApi.handler");
const handler = () => (globalThis[KEY] ||= createAgentApi({
  db,
  // Program Chair = PROGRAM_CHAIR role + allowlisted email, re-read on every request.
  chairEmails: programChairEmails,
  onError: (where, e) => console.error(`agent-api ${where}:`, e?.code || e?.message),
}));

/** Client IP behind the reverse proxy (first X-Forwarded-For hop) — for the request log only. */
const clientIp = (request) => {
  const xff = request.headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0] : request.headers.get("x-real-ip") || "").trim() || null;
};

async function serve(request, { params }) {
  const { path = [] } = await params;
  let body = "";
  if (request.method === "POST") {
    const declared = Number(request.headers.get("content-length") || 0);
    if (declared > MAX_BODY_CHARS * 4) {
      return NextResponse.json({ error: "Body too large" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    body = await request.text();
  }
  const res = await handler()({
    method: request.method,
    path: "/" + path.join("/"),
    query: request.nextUrl.searchParams,
    headers: request.headers,
    body,
    ip: clientIp(request),
  });
  return NextResponse.json(res.body, { status: res.status, headers: { "Cache-Control": "no-store", ...res.headers } });
}

export const GET = serve;
export const POST = serve;

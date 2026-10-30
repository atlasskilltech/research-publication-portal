import "server-only";

import { loadStudentCheckKey, studentCheckUrl } from "@/lib/config/env";

/**
 * Server-side verification of a student Application Number against the
 * university dashboard API.
 *
 * Security: the API key (STUDENT_CHECK_API_KEY) is read here and sent only in
 * the server→server request header. It is never returned to the client, never
 * logged, and never exposed in browser JavaScript.
 *
 * Fail-closed: the function returns a discriminated result and NEVER throws for
 * a network/timeout/HTTP error. The caller treats anything other than
 * `{ status: "exists" }` as "do not allow registration" — an API failure is
 * never interpreted as a successful verification.
 *
 * Result shape:
 *   { status: "exists" }        application number is valid
 *   { status: "not_found" }     API responded, number is not recognised
 *   { status: "unavailable" }   network error, timeout, or bad HTTP status
 */
const TIMEOUT_MS = 8000;

/**
 * Interpret the upstream JSON. The exact response contract is owned by the
 * university API; we accept the common "truthy exists" shapes and otherwise
 * treat the number as not found. This is intentionally conservative — an
 * ambiguous body is a non-match, never a pass.
 */
function bodySaysExists(data) {
  if (!data || typeof data !== "object") return false;
  const candidates = [
    data.exists,
    data.status,
    data.success,
    data.valid,
    data.data?.exists,
    data.data?.status,
    data.result?.exists,
  ];
  return candidates.some((v) => v === true || v === "true" || v === 1);
}

export async function verifyApplicationNo(applicationNo) {
  const appId = String(applicationNo || "").trim();
  if (!appId) return { status: "not_found" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(studentCheckUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Trimmed defensively so a stray newline/space in the env value can't
        // silently break auth. The value itself is never logged.
        "X-App-Key": loadStudentCheckKey().trim(),
      },
      body: JSON.stringify({ app_id: appId }),
      signal: controller.signal,
      cache: "no-store",
    });

    // A 404 is a clean "not found"; other non-2xx are treated as unavailable so
    // we never guess a pass from an error page.
    if (res.status === 404) return { status: "not_found" };
    if (!res.ok) {
      // Log only the status code (never the key or response body) so an
      // operator can tell a transient outage (5xx) from a credential/config
      // problem (401/403) in the server logs.
      console.warn(`studentCheck: upstream returned HTTP ${res.status}`);
      return { status: "unavailable" };
    }

    const data = await res.json().catch(() => null);
    return bodySaysExists(data) ? { status: "exists" } : { status: "not_found" };
  } catch (e) {
    // AbortError (timeout) or any network fault → unavailable, never a pass.
    console.warn(`studentCheck: upstream request failed (${e?.name || "error"})`);
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

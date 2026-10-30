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
 * Confirmed upstream contract (verified against the UAT endpoint, and matching
 * the working ATLAS Forge implementation):
 *   exists:     HTTP 200 {"status":1,"msg":"success","data":{"app_id":"…","exists":true}}
 *   not found:  HTTP 200 {"status":1,"msg":"success","data":{"app_id":"…","exists":false}}
 *   bad input:  HTTP 400 {"status":0,"msg":"app_id is required"}
 *   bad key:    HTTP 401 {"status":0,"msg":"Unauthorized"}
 *
 * The authoritative existence signal is therefore `data.exists === true`, and
 * ONLY when the HTTP response is ok and the request-level `status === 1`.
 * CRITICALLY: top-level `status === 1` means "the API call succeeded", NOT "the
 * student exists" — it is 1 for both exists:true and exists:false — so it must
 * never be treated as existence on its own.
 *
 * Result shape:
 *   { status: "exists" }        application number is valid
 *   { status: "not_found" }     API responded status:1 with exists:false
 *   { status: "unavailable" }   network error, timeout, non-2xx, status≠1, or
 *                               a status:1 body whose `exists` is missing/non-boolean
 */
const TIMEOUT_MS = 8000;

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

    // Any non-2xx (401 bad key, 400 bad input, 5xx outage) → unavailable: we
    // never guess a pass from an error response. Log only the status code
    // (never the key or body) so 401/403 (credential) is distinguishable from
    // 5xx (outage) in server logs.
    if (!res.ok) {
      console.warn(`studentCheck: upstream returned HTTP ${res.status}`);
      return { status: "unavailable" };
    }

    const data = await res.json().catch(() => null);

    // The request must have succeeded at the API level (status === 1) before we
    // trust anything in it. status:0 (or missing) on a 200 is an API-level
    // failure, not a verification result.
    if (!data || data.status !== 1) {
      console.warn(`studentCheck: unexpected body (status=${data?.status ?? "none"})`);
      return { status: "unavailable" };
    }

    const exists = data.data?.exists;
    if (exists === true) return { status: "exists" };
    if (exists === false) return { status: "not_found" };

    // status:1 but `exists` missing / non-boolean — can't be trusted either way.
    console.warn("studentCheck: status:1 but exists is missing/non-boolean");
    return { status: "unavailable" };
  } catch (e) {
    // AbortError (timeout) or any network fault → unavailable, never a pass.
    console.warn(`studentCheck: upstream request failed (${e?.name || "error"})`);
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

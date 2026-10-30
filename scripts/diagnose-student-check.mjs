/**
 * Read-only diagnosis of the student Application-Number verification path.
 * Prints NO secrets and NO upstream PII: the API key is shown only as a boolean
 * "present", and the upstream response is reduced to its SHAPE (keys + value
 * TYPES, with booleans/numbers/short enums kept, all other strings masked).
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL is irrelevant; needs STUDENT_CHECK_API_KEY
 * (+ optional STUDENT_CHECK_API_URL). Run:
 *   node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/diagnose-student-check.mjs [appId]
 */
const KEY = process.env.STUDENT_CHECK_API_KEY;
const URL_ = process.env.STUDENT_CHECK_API_URL ||
  "https://uat-dashboard.atlasskilltech.app/api/app/student-check/exists";
const appId = process.argv[2] || "2629885";

console.log("\n=== Student-check upstream diagnosis ===\n");
console.log("STUDENT_CHECK_API_KEY present:", !!KEY);
console.log("STUDENT_CHECK_API_KEY length :", KEY ? KEY.length : 0, "(value NOT shown)");
console.log("Upstream URL                 :", URL_);
console.log("Method                       : POST");
console.log("app_id                       :", appId, "\n");

if (!KEY) {
  console.log("✖ ROOT CAUSE CANDIDATE: STUDENT_CHECK_API_KEY is NOT set in this process.");
  console.log("  verifyApplicationNo() would throw on loadStudentCheckKey() and return");
  console.log("  { status: 'unavailable' } → the 'temporarily unavailable' message.\n");
  process.exit(0);
}

// Reduce an arbitrary JSON value to a PII-safe shape.
function shape(v, depth = 0) {
  if (v === null) return null;
  if (Array.isArray(v)) return v.slice(0, 2).map((x) => shape(x, depth + 1)).concat(v.length > 2 ? ["…"] : []);
  if (typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = shape(v[k], depth + 1);
    return o;
  }
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v;
  if (typeof v === "string") return v.length <= 12 ? v : `<string:${v.length}>`;
  return typeof v;
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 8000);
try {
  const started = Date.now();
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-App-Key": KEY },
    body: JSON.stringify({ app_id: appId }),
    signal: controller.signal,
    cache: "no-store",
  });
  const ms = Date.now() - started;
  console.log(`HTTP status      : ${res.status} ${res.statusText} (${ms} ms)`);
  console.log("content-type     :", res.headers.get("content-type"));
  const text = await res.text();
  console.log("raw body length  :", text.length);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (json !== null) {
    console.log("\nSanitized response SHAPE (types only, strings masked):");
    console.log(JSON.stringify(shape(json), null, 2));
    // Report the specific fields our parser checks.
    const candidates = {
      "exists": json.exists,
      "status": typeof json.status === "string" ? `<string>` : json.status,
      "success": json.success,
      "valid": json.valid,
      "data.exists": json.data?.exists,
      "data.status": typeof json.data?.status === "string" ? `<string>` : json.data?.status,
      "result.exists": json.result?.exists,
    };
    console.log("\nParser candidate fields (verifyApplicationNo checks these):");
    for (const [k, val] of Object.entries(candidates)) console.log("  " + k.padEnd(14), val);
  } else {
    console.log("\n(body is not JSON — first 80 chars, masked):");
    console.log("  " + text.slice(0, 80).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "<email>"));
  }
} catch (e) {
  console.log("✖ fetch threw:", e.name === "AbortError" ? "timeout (>8s)" : e.name, "-", e.message);
} finally {
  clearTimeout(timer);
  console.log("");
}

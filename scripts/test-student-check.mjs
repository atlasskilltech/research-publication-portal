/**
 * End-to-end test of the student Application Number verification, through the
 * REAL /api/student-check route, against a LOCAL mock of the university API.
 *
 * It touches NO Supabase project and needs NO real API key — it proves the
 * route's behaviour (valid / not-found / server-error / timeout / empty), that
 * the secret key is forwarded to the upstream but never leaked back to the
 * client, and that an upstream failure is never reported as a pass.
 *
 * Prereq: the app must be running with
 *   STUDENT_CHECK_API_KEY=<the key below>
 *   STUDENT_CHECK_API_URL=http://127.0.0.1:5661/exists
 * Run: node scripts/test-student-check.mjs [baseUrl]
 */
import http from "node:http";

const BASE = process.argv[2] || "http://127.0.0.1:5631";
const MOCK_PORT = 5661;
const KEY = "test-secret-key-do-not-use-in-prod";

let failures = 0;
let lastAppKeyHeader = null;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
};

// ---- Mock upstream: response is chosen by the app_id it receives ----------
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    lastAppKeyHeader = req.headers["x-app-key"] || null;
    let appId = "";
    try { appId = JSON.parse(body).app_id; } catch {}
    const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    switch (appId) {
      case "VALID": return send(200, { exists: true });
      case "VALIDNESTED": return send(200, { data: { exists: true } });
      case "UNKNOWN": return send(404, { exists: false });
      case "SERVERERROR": return send(500, { error: "boom" });
      case "SLOW": return setTimeout(() => send(200, { exists: true }), 9500); // > 8s client timeout
      default: return send(200, { exists: false });
    }
  });
});

async function post(applicationNo) {
  const res = await fetch(`${BASE}/api/student-check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ applicationNo }),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function main() {
  console.log(`\n=== Student-check route tests (app ${BASE}, mock :${MOCK_PORT}) ===\n`);

  {
    const r = await post("VALID");
    check("valid application number → 200 ok", r.status === 200 && r.json.ok === true, `status ${r.status}`);
    check("secret key forwarded to upstream (X-App-Key)", lastAppKeyHeader === KEY, lastAppKeyHeader ? "present" : "missing");
    check("secret key NOT leaked in client response", !r.text.includes(KEY));
  }
  {
    const r = await post("VALIDNESTED");
    check("valid via nested {data:{exists}} shape → 200 ok", r.status === 200 && r.json.ok === true, `status ${r.status}`);
  }
  {
    const r = await post("UNKNOWN");
    check("unknown application number → 422", r.status === 422, `status ${r.status}`);
  }
  {
    const r = await post("NOMATCH"); // upstream 200 but exists:false
    check("200-but-not-exists → 422 (fail closed)", r.status === 422, `status ${r.status}`);
  }
  {
    const r = await post("SERVERERROR");
    check("upstream 500 → 503 unavailable (never a pass)", r.status === 503, `status ${r.status}`);
  }
  {
    const r = await post("");
    check("empty application number → 422", r.status === 422, `status ${r.status}`);
  }
  {
    console.log("  … timeout case (waits ~8s for client abort)");
    const r = await post("SLOW");
    check("upstream timeout → 503 unavailable (never a pass)", r.status === 503, `status ${r.status}`);
  }

  console.log(`\n${failures === 0 ? "✓ PASS — student-check behaves correctly." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
}

mock.listen(MOCK_PORT, "127.0.0.1", () => {
  main()
    .catch((e) => { console.error("✖ Test error:", e?.message || e); failures++; })
    .finally(() => { mock.close(); process.exit(failures === 0 ? 0 : 1); });
});

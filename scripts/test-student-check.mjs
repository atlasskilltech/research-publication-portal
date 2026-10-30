/**
 * End-to-end test of the student Application Number verification, through the
 * REAL /api/student-check route, against a LOCAL mock of the university API that
 * reproduces the CONFIRMED upstream contract:
 *
 *   exists:     200 {"status":1,"msg":"success","data":{"app_id","exists":true}}
 *   not found:  200 {"status":1,"msg":"success","data":{"app_id","exists":false}}
 *   bad input:  400 {"status":0,"msg":"app_id is required"}
 *   bad key:    401 {"status":0,"msg":"Unauthorized"}
 *
 * It touches NO Supabase project and needs NO real API key. It proves the route
 * maps the contract correctly — crucially that status:1 + exists:false is a
 * REJECTION (422), not a pass — that the secret key is forwarded upstream but
 * never leaked to the client, and that failures never become a pass.
 *
 * Prereq: the app running with
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

// ---- Mock upstream reproducing the real contract, keyed by app_id ----------
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    lastAppKeyHeader = req.headers["x-app-key"] || null;
    let appId = "";
    try { appId = JSON.parse(body).app_id; } catch {}
    const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    const ok = (exists) => send(200, { status: 1, msg: "success", data: { app_id: appId, exists } });
    switch (appId) {
      case "EXISTS": return ok(true);
      case "NOTEXIST": return ok(false);
      case "STATUSZERO": return send(200, { status: 0, msg: "nope" });        // API-level failure on a 200
      case "EXISTSMISSING": return send(200, { status: 1, data: {} });        // status:1 but no exists
      case "BADKEY": return send(401, { status: 0, msg: "Unauthorized" });
      case "BADINPUT": return send(400, { status: 0, msg: "app_id is required" });
      case "SERVERERROR": return send(500, { error: "boom" });
      case "SLOW": return setTimeout(() => ok(true), 9500);                    // > 8s client timeout
      default: return ok(false);
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
    const r = await post("EXISTS");
    check("exists:true → 200 ok", r.status === 200 && r.json.ok === true, `status ${r.status}`);
    check("secret key forwarded to upstream (X-App-Key)", lastAppKeyHeader === KEY, lastAppKeyHeader ? "present" : "missing");
    check("secret key NOT leaked in client response", !r.text.includes(KEY));
  }
  {
    const r = await post("NOTEXIST");
    check("status:1 + exists:false → 422 (NOT a pass)", r.status === 422, `status ${r.status}`);
  }
  {
    const r = await post("STATUSZERO");
    check("200 with status:0 → 503 unavailable", r.status === 503, `status ${r.status}`);
  }
  {
    const r = await post("EXISTSMISSING");
    check("status:1 but exists missing → 503 (fail closed)", r.status === 503, `status ${r.status}`);
  }
  {
    const r = await post("BADKEY");
    check("401 bad key → 503 unavailable", r.status === 503, `status ${r.status}`);
  }
  {
    const r = await post("BADINPUT");
    check("400 bad input → 503 unavailable", r.status === 503, `status ${r.status}`);
  }
  {
    const r = await post("SERVERERROR");
    check("500 → 503 unavailable (never a pass)", r.status === 503, `status ${r.status}`);
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

  console.log(`\n${failures === 0 ? "✓ PASS — student-check maps the real contract correctly." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
}

mock.listen(MOCK_PORT, "127.0.0.1", () => {
  main()
    .catch((e) => { console.error("✖ Test error:", e?.message || e); failures++; })
    .finally(() => { mock.close(); process.exit(failures === 0 ? 0 : 1); });
});

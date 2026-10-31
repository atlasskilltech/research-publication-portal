/**
 * Unit test for workflow notification emails (lib/notifications.js). Pure — no
 * network, no Resend, no database. Run: npm run test:notifications
 */
import { EVENTS, AUDIENCE, buildNotification, uniqueRecipients } from "../lib/notifications.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };

const base = { siteUrl: "https://portal.example.edu/", paperId: "p-1", title: "Graph methods", recipientId: "u-1", round: 0 };

console.log("\nEvery event builds a complete email:");
for (const ev of Object.values(EVENTS)) {
  const m = buildNotification(ev, base);
  check(`${ev}`, !!m && m.subject && m.html.includes("Graph methods") && m.text.includes("Graph methods") && m.purpose.startsWith("notify_") && m.key, m ? "" : "null");
  check(`${ev} has an audience`, ["author", "reviewers", "managers", "assignee"].includes(AUDIENCE[ev]));
}
check("unknown event → null", buildNotification("NOPE", base) === null);

console.log("\nLinks:");
const sub = buildNotification(EVENTS.SUBMISSION_RECEIVED, base);
check("links to the submission page (no double slash)", sub.html.includes("https://portal.example.edu/submissions/p-1"));
const pub = buildNotification(EVENTS.PAPER_PUBLISHED, { ...base, publicUrl: "https://portal.example.edu/publications/x" });
check("published email links to the public record", pub.html.includes("https://portal.example.edu/publications/x"));

console.log("\nPrivacy:");
const dec = buildNotification(EVENTS.DECISION_AVAILABLE, base);
check("decision email reveals no outcome", !/accept|reject|minor|major/i.test(dec.subject + dec.text));
check("decision email has no reviewer identity/scores", !/reviewer \d|score|confidential/i.test(dec.text));
const rev = buildNotification(EVENTS.REVIEW_ASSIGNED, { ...base, dueAt: "2026-11-15T00:00:00Z" });
check("review email states double-blind", /double-blind/i.test(rev.text));
check("review email shows the deadline", /15 Nov 2026/.test(rev.text), rev.text.slice(0, 200));
check("builder takes no author fields (cannot leak them)", !/author name|@example/i.test(rev.text));

console.log("\nEscaping + length:");
const evil = buildNotification(EVENTS.SUBMISSION_RECEIVED, { ...base, title: '<script>alert(1)</script>' + "x".repeat(400) });
check("HTML in titles is escaped", !evil.html.includes("<script>") && evil.html.includes("&lt;script&gt;"));
check("long titles are clipped", !evil.text.includes("x".repeat(250)));
check("empty title has a fallback", buildNotification(EVENTS.SUBMISSION_RECEIVED, { ...base, title: "" }).text.includes("Untitled submission"));

console.log("\nIdempotency keys:");
const k = (o) => buildNotification(EVENTS.REVIEW_SUBMITTED, { ...base, ...o }).key;
check("same event/paper/recipient/round → same key", k({}) === k({}));
check("different recipient → different key", k({}) !== k({ recipientId: "u-2" }));
check("different round → different key", k({}) !== k({ round: 1 }));
check("different triggering user (e.g. 2nd reviewer, same round) → different key", k({ actorId: "rev-a" }) !== k({ actorId: "rev-b" }));
check("same triggering user retried → same key", k({ actorId: "rev-a" }) === k({ actorId: "rev-a" }));
check("different event → different key", k({}) !== buildNotification(EVENTS.DECISION_AVAILABLE, base).key);

console.log("\nRecipients:");
const r = uniqueRecipients([{ id: "a", email: "a@x.edu" }, { id: "a", email: "a@x.edu" }, { id: "b", email: "" }, { id: "c", email: "c@x.edu" }, null], ["c"]);
check("dedupes, drops empty emails and excluded ids", r.length === 1 && r[0].id === "a", JSON.stringify(r));

console.log(failures ? `\n✗ FAIL — ${failures} check(s) failed.\n` : "\n✓ PASS — workflow notifications are complete and privacy-safe.\n");
process.exit(failures ? 1 : 0);

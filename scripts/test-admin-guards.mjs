/**
 * No-network unit test of the pure admin-action guards (lib/adminGuards.js):
 * self-change, protected original admins, and last-admin protection, for both
 * role changes and deletion. Run: node scripts/test-admin-guards.mjs
 */
import { canSetAdmin, canDeleteUser, canSetStatus, deletionHistoryBlock } from "../lib/adminGuards.js";

const PROTECTED = ["faizan.shaikh@atlasuniversity.edu.in", "elizabeth.jerome@atlasuniversity.edu.in"];
let failures = 0;
const check = (label, ok) => { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) failures++; };

const me = "actor-1";
const other = (over = {}) => ({ id: "u-2", email: "stu@atlasuniversity.edu.in", is_admin: false, ...over });

console.log("\n=== Admin guard unit tests ===\n");

console.log("canSetAdmin:");
check("promote another normal user → allowed",
  canSetAdmin({ actorId: me, target: other(), next: true, adminCount: 2, protectedEmails: PROTECTED }).ok === true);
check("promote SELF → blocked (403)",
  canSetAdmin({ actorId: me, target: other({ id: me }), next: true, adminCount: 2, protectedEmails: PROTECTED }).status === 403);
check("demote SELF → blocked (403)",
  canSetAdmin({ actorId: me, target: other({ id: me, is_admin: true }), next: false, adminCount: 3, protectedEmails: PROTECTED }).status === 403);
check("demote another admin (plenty left) → allowed",
  canSetAdmin({ actorId: me, target: other({ is_admin: true }), next: false, adminCount: 3, protectedEmails: PROTECTED }).ok === true);
check("demote a PROTECTED original admin → blocked (403)",
  canSetAdmin({ actorId: me, target: other({ email: "elizabeth.jerome@atlasuniversity.edu.in", is_admin: true }), next: false, adminCount: 3, protectedEmails: PROTECTED }).status === 403);
check("demote the LAST admin → blocked (409)",
  canSetAdmin({ actorId: me, target: other({ is_admin: true }), next: false, adminCount: 1, protectedEmails: PROTECTED }).status === 409);
check("missing target → 404",
  canSetAdmin({ actorId: me, target: null, next: true, adminCount: 2, protectedEmails: PROTECTED }).status === 404);

console.log("\ncanDeleteUser:");
check("delete another normal user → allowed",
  canDeleteUser({ actorId: me, target: other(), adminCount: 2, protectedEmails: PROTECTED }).ok === true);
check("delete SELF → blocked (403)",
  canDeleteUser({ actorId: me, target: other({ id: me }), adminCount: 2, protectedEmails: PROTECTED }).status === 403);
check("delete a PROTECTED original admin → blocked (403)",
  canDeleteUser({ actorId: me, target: other({ email: "faizan.shaikh@atlasuniversity.edu.in", is_admin: true }), adminCount: 3, protectedEmails: PROTECTED }).status === 403);
check("delete the LAST admin → blocked (409)",
  canDeleteUser({ actorId: me, target: other({ is_admin: true }), adminCount: 1, protectedEmails: PROTECTED }).status === 409);
check("delete a non-last admin (non-protected) → allowed",
  canDeleteUser({ actorId: me, target: other({ is_admin: true }), adminCount: 2, protectedEmails: PROTECTED }).ok === true);


console.log("\ncanSetStatus (disable / reactivate):");
const st = (target, next, activeAdminCount = 2) => canSetStatus({ actorId: me, target, next, activeAdminCount, protectedEmails: PROTECTED });
check("disable a normal user → allowed", st(other(), "DISABLED").ok === true);
check("reactivate a disabled user → allowed", st(other({ status: "DISABLED" }), "ACTIVE").ok === true);
check("disable SELF → blocked (403)", st(other({ id: me, is_admin: true }), "DISABLED").status === 403);
check("reactivate SELF → blocked (403)", st(other({ id: me }), "ACTIVE").status === 403);
check("disable a protected original admin → blocked (403)", st(other({ email: "elizabeth.jerome@atlasuniversity.edu.in", is_admin: true }), "DISABLED", 3).status === 403);
check("disable the LAST active admin → blocked (409)", st(other({ is_admin: true }), "DISABLED", 1).status === 409);
check("disable an admin when others are active → allowed", st(other({ is_admin: true }), "DISABLED", 2).ok === true);
check("reactivating an admin is never blocked by the last-admin rule", st(other({ is_admin: true, status: "DISABLED" }), "ACTIVE", 1).ok === true);
check("unknown status → 422", st(other(), "DELETED").status === 422);
check("missing target → 404", st(null, "DISABLED").status === 404);

console.log("\ndeletionHistoryBlock:");
check("no history → deletion allowed", deletionHistoryBlock({ total: 0 }) === null);
check("any history → 409 has_history, suggests disabling", (() => { const b = deletionHistoryBlock({ total: 3, reviews: 2 }); return b.status === 409 && b.code === "has_history" && /Disable/.test(b.error); })());

console.log(`\n${failures === 0 ? "✓ PASS — all guard branches correct." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

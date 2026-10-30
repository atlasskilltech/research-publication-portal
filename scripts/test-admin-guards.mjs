/**
 * No-network unit test of the pure admin-action guards (lib/adminGuards.js):
 * self-change, protected original admins, and last-admin protection, for both
 * role changes and deletion. Run: node scripts/test-admin-guards.mjs
 */
import { canSetAdmin, canDeleteUser } from "../lib/adminGuards.js";

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

console.log(`\n${failures === 0 ? "✓ PASS — all guard branches correct." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

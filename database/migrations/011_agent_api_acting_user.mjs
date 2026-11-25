/**
 * 011_agent_api_acting_user — IntelligenceOS "acts as the signed-in user"
 * (spec atlas-agent-api/1, v1.1 §2a).
 *
 *   research_agent_api_log.acting_email   the X-IntelligenceOS-User header of the
 *                                         request (the agent's owner), so every
 *                                         call can be traced to a person — also
 *                                         refused ones (unknown / inactive user).
 *
 * Additive only. Rollback (`down`) drops the column only when no row uses it.
 */
import { T } from "../../lib/db/tables.mjs";

export const description = "Agent API log: acting user (X-IntelligenceOS-User)";
/** Tables this migration CREATES (none — collision preflight). */
export const tables = () => [];

export async function up(m) {
  await m.addColumn(T.agentApiLog, "acting_email", "VARCHAR(191) NULL AFTER `run_id`");
  await m.addIndex(T.agentApiLog, "research_agent_api_log_acting_at_idx", "KEY `research_agent_api_log_acting_at_idx` (`acting_email`, `at`)");
}

export async function down(m) {
  const col = await m.db.one(
    `SELECT 1 AS x FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'acting_email'`,
    [T.agentApiLog],
  );
  if (!col) return;
  const n = Number((await m.db.one(`SELECT COUNT(*) AS n FROM \`${T.agentApiLog}\` WHERE acting_email IS NOT NULL`)).n);
  if (n > 0) throw new Error(`${n} log row(s) record an acting user — refusing to drop; restore from backup instead.`);
  await m.db.query(`ALTER TABLE \`${T.agentApiLog}\` DROP INDEX \`research_agent_api_log_acting_at_idx\`, DROP COLUMN \`acting_email\``);
  m.log(`  - column ${T.agentApiLog}.acting_email (was unused)`);
}

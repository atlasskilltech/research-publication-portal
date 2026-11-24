/**
 * 010_agent_api — IntelligenceOS Agent API (spec atlas-agent-api/1):
 *
 *   research_agent_api_keys  admin-issued API keys. Only sha256(key) is stored
 *                            (key_hash, hex); the plain key is shown once.
 *                            scopes = JSON array ("research.read", "research.write").
 *                            revoked_at NULL = active.
 *   research_agent_api_log   one row per Agent API request: time, key, action,
 *                            X-IntelligenceOS-Agent, X-IntelligenceOS-Run, status.
 *
 * Additive only. Rollback (`down`) drops both tables only when they are empty.
 */
import { T } from "../../lib/db/tables.mjs";
import { UUID } from "../migrate-helpers.mjs";

export const description = "IntelligenceOS Agent API: API keys + request log";
export const tables = () => [T.agentApiKeys, T.agentApiLog];

const TS = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)";

export async function up(m) {
  const UID = await m.userIdType(T.users);

  await m.createTable(T.agentApiKeys, `
  \`id\`           ${UUID} NOT NULL,
  \`name\`         VARCHAR(100) NOT NULL,
  \`key_hash\`     CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`key_last4\`    CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`scopes\`       JSON NOT NULL,
  \`expires_at\`   DATETIME(3) NULL,
  \`revoked_at\`   DATETIME(3) NULL,
  \`revoked_by\`   ${UID} NULL,
  \`last_used_at\` DATETIME(3) NULL,
  \`created_by\`   ${UID} NULL,
  \`created_at\`   ${TS},
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_agent_api_keys_hash_uq\` (\`key_hash\`),
  CONSTRAINT \`research_agent_api_keys_created_by_fk\` FOREIGN KEY (\`created_by\`) REFERENCES \`${T.users}\` (\`id\`) ON DELETE SET NULL,
  CONSTRAINT \`research_agent_api_keys_revoked_by_fk\` FOREIGN KEY (\`revoked_by\`) REFERENCES \`${T.users}\` (\`id\`) ON DELETE SET NULL`);

  await m.createTable(T.agentApiLog, `
  \`id\`         BIGINT NOT NULL AUTO_INCREMENT,
  \`at\`         ${TS},
  \`key_id\`     ${UUID} NULL,
  \`method\`     VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`path\`       VARCHAR(255) NOT NULL,
  \`action\`     VARCHAR(64) NULL,
  \`agent\`      VARCHAR(128) NULL,
  \`run_id\`     VARCHAR(128) NULL,
  \`status\`     SMALLINT NOT NULL,
  \`ip\`         VARCHAR(64) NULL,
  PRIMARY KEY (\`id\`),
  KEY \`research_agent_api_log_key_at_idx\` (\`key_id\`, \`at\`),
  KEY \`research_agent_api_log_at_idx\` (\`at\`),
  CONSTRAINT \`research_agent_api_log_key_fk\` FOREIGN KEY (\`key_id\`) REFERENCES \`${T.agentApiKeys}\` (\`id\`) ON DELETE SET NULL`);
}

export async function down(m) {
  const list = [T.agentApiLog, T.agentApiKeys];
  for (const t of list) if ((await m.tableExists(t)) && (await m.count(t)) > 0) throw new Error(`${t} is not empty — refusing to drop; restore from backup instead.`);
  for (const t of list) if (await m.tableExists(t)) { await m.db.query(`DROP TABLE \`${t}\``); m.log(`  - table ${t} (was empty)`); }
}

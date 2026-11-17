/**
 * 006_achievements — Faculty Achievements (replaces five Google Forms:
 * Professional Achievements, Fellowship / Financial Support, Research /
 * Innovation Awards, Consultancy / Corporate Training, External Grants).
 *
 *   research_achievements       one row per record. Shared fields are columns
 *                               (school, title, main date, amount, ATLAS
 *                               affiliation, verification status); fields only
 *                               one type has live in the `details` JSON column.
 *                               Field definitions: lib/achievementTypes.js.
 *   research_achievement_files  the proof documents (one row per file, in a
 *                               named slot, e.g. "proof", "sanction_letter").
 *                               Bytes live in the private manuscript store
 *                               (lib/storage.js) under a random key.
 *
 * Additive only: two new tables, nothing existing is touched. Idempotent.
 * Rollback (`down`) refuses while either table has rows.
 */
import { T } from "../../lib/db/tables.mjs";
import { UUID } from "../migrate-helpers.mjs";

export const description = "Faculty achievements: achievements + achievement files";
/** Tables this migration CREATES (collision preflight). */
export const tables = () => [T.achievements, T.achievementFiles];

const TS = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)";
const TSU = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)";

export async function up(m) {
  const UID = await m.userIdType(T.users);
  const U = `REFERENCES \`${T.users}\` (\`id\`)`;

  await m.createTable(T.achievements, `
  \`id\`               ${UUID} NOT NULL,
  \`user_id\`          ${UID} NOT NULL,
  \`type\`             ENUM('PROFESSIONAL','FELLOWSHIP','AWARD','CONSULTANCY','GRANT') NOT NULL,
  \`school_code\`      VARCHAR(16) NOT NULL,
  \`title\`            VARCHAR(300) NOT NULL,
  \`achievement_date\` DATE NOT NULL,
  \`amount_inr\`       DECIMAL(14,2) NULL,
  \`atlas_affiliation\` ENUM('YES','NO','JOINT') NULL,
  \`details\`          JSON NOT NULL,
  \`status\`           ENUM('SUBMITTED','VERIFIED','REJECTED') NOT NULL DEFAULT 'SUBMITTED',
  \`review_note\`      VARCHAR(1000) NULL,
  \`reviewed_by\`      ${UID} NULL,
  \`reviewed_at\`      DATETIME(3) NULL,
  \`created_at\`       ${TS},
  \`updated_at\`       ${TSU},
  PRIMARY KEY (\`id\`),
  KEY \`research_achievements_user_idx\` (\`user_id\`, \`achievement_date\`),
  KEY \`research_achievements_type_date_idx\` (\`type\`, \`achievement_date\`),
  KEY \`research_achievements_status_idx\` (\`status\`),
  KEY \`research_achievements_school_idx\` (\`school_code\`),
  CONSTRAINT \`research_achievements_user_fk\` FOREIGN KEY (\`user_id\`) ${U} ON DELETE RESTRICT,
  CONSTRAINT \`research_achievements_reviewed_by_fk\` FOREIGN KEY (\`reviewed_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_achievements_amount_ck\` CHECK (\`amount_inr\` IS NULL OR \`amount_inr\` >= 0)`);

  await m.createTable(T.achievementFiles, `
  \`id\`                ${UUID} NOT NULL,
  \`achievement_id\`    ${UUID} NOT NULL,
  \`slot\`              VARCHAR(40) NOT NULL,
  \`storage_key\`       VARCHAR(64) NOT NULL,
  \`original_filename\` VARCHAR(255) NOT NULL,
  \`mime_type\`         VARCHAR(127) NOT NULL,
  \`byte_size\`         INT NOT NULL,
  \`sha256\`            CHAR(64) NOT NULL,
  \`created_at\`        ${TS},
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_achievement_files_key_uq\` (\`storage_key\`),
  KEY \`research_achievement_files_achievement_idx\` (\`achievement_id\`),
  CONSTRAINT \`research_achievement_files_achievement_fk\` FOREIGN KEY (\`achievement_id\`) REFERENCES \`${T.achievements}\` (\`id\`) ON DELETE CASCADE,
  CONSTRAINT \`research_achievement_files_size_ck\` CHECK (\`byte_size\` > 0)`);
}

export async function down(m) {
  const ts = [T.achievementFiles, T.achievements];
  for (const t of ts) if ((await m.tableExists(t)) && (await m.count(t)) > 0) throw new Error(`${t} is not empty — refusing to drop; restore from backup instead.`);
  for (const t of ts) if (await m.tableExists(t)) { await m.db.query(`DROP TABLE \`${t}\``); m.log(`  - table ${t} (was empty)`); }
}

/**
 * 007_achievements_import — more achievement types + what the import of the
 * old Google-Forms data needs. Additive / widening only:
 *
 *   research_achievements.type    enum gains PAPER, BOOK, EVENT_ATTENDED,
 *                                 PATENT, QUALIFICATION, EVENT_ORGANIZED
 *                                 (appended; existing rows unchanged)
 *   research_achievements.achievement_date, school_code → NULL allowed
 *                                 (old form answers like "2021" or a blank
 *                                 school; the raw text is kept in `details`)
 *   research_achievements.source, source_key   "IMPORT" + a hash of the source
 *                                 row, unique, so re-running an import never
 *                                 creates duplicates
 *   research_achievement_links    proof that is still only a Google Drive link
 *                                 (the owner is asked to upload the file)
 *   research_achievement_contributors  people named on an entry (e.g. the
 *                                 faculty on a patent entered by an office
 *                                 account); a contributor whose email matches
 *                                 a signed-in user sees the entry too
 *   research_faculty_profiles     ORCID iD per user
 *
 * Nothing is dropped or rewritten. Every step is idempotent.
 * Rollback (`down`) refuses while any new-type row or new-table row exists.
 */
import { T } from "../../lib/db/tables.mjs";
import { UUID } from "../migrate-helpers.mjs";
import { enumValues } from "./004_author_role.mjs";

export const description = "Achievements: 6 more types, nullable date/school, import source key, links, contributors, ORCID profiles";
/** Tables this migration CREATES (collision preflight). */
export const tables = () => [T.achievementLinks, T.achievementContributors, T.facultyProfiles];

export const NEW_TYPES = ["PAPER", "BOOK", "EVENT_ATTENDED", "PATENT", "QUALIFICATION", "EVENT_ORGANIZED"];
const TS = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)";
const TSU = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)";
const quote = (v) => `'${v.replace(/'/g, "''")}'`;

export async function up(m) {
  const A = T.achievements;
  // ---- 1. type enum: append the new types ------------------------------------
  const col = await m.columnInfo(A, "type");
  if (!col) throw new Error(`${A}.type not found — run 006 first. Nothing changed.`);
  const values = enumValues(col.type);
  if (!values || !values.includes("PROFESSIONAL")) throw new Error(`${A}.type is ${col.type} — refusing to guess. Nothing changed.`);
  const missing = NEW_TYPES.filter((t) => !values.includes(t));
  if (missing.length) {
    const list = [...values, ...missing].map(quote).join(",");
    await m.db.query(`ALTER TABLE \`${A}\` MODIFY COLUMN \`type\` ENUM(${list}) NOT NULL`);
    m.log(`  ~ column ${A}.type += ${missing.join(", ")}`);
  }

  // ---- 2. date + school may be NULL ------------------------------------------
  const date = await m.columnInfo(A, "achievement_date");
  if (date && date.nullable === "NO") {
    await m.db.query(`ALTER TABLE \`${A}\` MODIFY COLUMN \`achievement_date\` DATE NULL`);
    m.log(`  ~ column ${A}.achievement_date NULL allowed`);
  }
  const school = await m.columnInfo(A, "school_code");
  if (school && school.nullable === "NO") {
    await m.db.query(`ALTER TABLE \`${A}\` MODIFY COLUMN \`school_code\` VARCHAR(16) NULL`);
    m.log(`  ~ column ${A}.school_code NULL allowed`);
  }

  // ---- 3. import source -------------------------------------------------------
  await m.addColumn(A, "source", "VARCHAR(16) NULL AFTER `status`");
  await m.addColumn(A, "source_key", "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER `source`");
  await m.addIndex(A, "research_achievements_source_key_uq", "UNIQUE KEY `research_achievements_source_key_uq` (`source_key`)");

  // ---- 4. new tables ----------------------------------------------------------
  const UID = await m.userIdType(T.users);
  await m.createTable(T.achievementLinks, `
  \`id\`             ${UUID} NOT NULL,
  \`achievement_id\` ${UUID} NOT NULL,
  \`slot\`           VARCHAR(40) NOT NULL,
  \`url\`            VARCHAR(1000) NOT NULL,
  \`created_at\`     ${TS},
  PRIMARY KEY (\`id\`),
  KEY \`research_achievement_links_achievement_idx\` (\`achievement_id\`),
  CONSTRAINT \`research_achievement_links_achievement_fk\` FOREIGN KEY (\`achievement_id\`) REFERENCES \`${A}\` (\`id\`) ON DELETE CASCADE`);

  await m.createTable(T.achievementContributors, `
  \`id\`             ${UUID} NOT NULL,
  \`achievement_id\` ${UUID} NOT NULL,
  \`name\`           VARCHAR(200) NOT NULL,
  \`email\`          VARCHAR(191) NULL,
  \`position\`       INT NOT NULL DEFAULT 0,
  PRIMARY KEY (\`id\`),
  KEY \`research_achievement_contributors_achievement_idx\` (\`achievement_id\`),
  KEY \`research_achievement_contributors_email_idx\` (\`email\`),
  CONSTRAINT \`research_achievement_contributors_achievement_fk\` FOREIGN KEY (\`achievement_id\`) REFERENCES \`${A}\` (\`id\`) ON DELETE CASCADE`);

  await m.createTable(T.facultyProfiles, `
  \`user_id\`    ${UID} NOT NULL,
  \`orcid\`      VARCHAR(19) NULL,
  \`updated_at\` ${TSU},
  PRIMARY KEY (\`user_id\`),
  CONSTRAINT \`research_faculty_profiles_user_fk\` FOREIGN KEY (\`user_id\`) REFERENCES \`${T.users}\` (\`id\`) ON DELETE CASCADE,
  CONSTRAINT \`research_faculty_profiles_orcid_ck\` CHECK (\`orcid\` IS NULL OR \`orcid\` REGEXP '^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$')`);
}

export async function down(m) {
  const A = T.achievements;
  for (const t of [T.achievementLinks, T.achievementContributors, T.facultyProfiles]) {
    if ((await m.tableExists(t)) && (await m.count(t)) > 0) throw new Error(`${t} is not empty — refusing to drop; restore from backup instead.`);
  }
  const n = Number((await m.db.one(`SELECT COUNT(*) AS n FROM \`${A}\` WHERE type IN (?) OR source IS NOT NULL OR achievement_date IS NULL OR school_code IS NULL`, [NEW_TYPES])).n);
  if (n > 0) throw new Error(`${n} achievement row(s) use 007 features — restore from backup instead.`);
  for (const t of [T.achievementLinks, T.achievementContributors, T.facultyProfiles]) {
    if (await m.tableExists(t)) { await m.db.query(`DROP TABLE \`${t}\``); m.log(`  - table ${t} (was empty)`); }
  }
  if (await m.indexExists(A, "research_achievements_source_key_uq")) await m.db.query(`ALTER TABLE \`${A}\` DROP INDEX \`research_achievements_source_key_uq\``);
  for (const c of ["source_key", "source"]) if (await m.columnInfo(A, c)) await m.db.query(`ALTER TABLE \`${A}\` DROP COLUMN \`${c}\``);
  await m.db.query(`ALTER TABLE \`${A}\` MODIFY COLUMN \`achievement_date\` DATE NOT NULL`);
  await m.db.query(`ALTER TABLE \`${A}\` MODIFY COLUMN \`school_code\` VARCHAR(16) NOT NULL`);
  const col = await m.columnInfo(A, "type");
  const values = (enumValues(col?.type) || []).filter((v) => !NEW_TYPES.includes(v));
  await m.db.query(`ALTER TABLE \`${A}\` MODIFY COLUMN \`type\` ENUM(${values.map(quote).join(",")}) NOT NULL`);
  m.log(`  ~ ${A} restored to the 006 shape`);
}

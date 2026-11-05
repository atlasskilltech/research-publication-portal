/**
 * 004_author_role — external AUTHOR accounts (AIDC – ATLAS International Design
 * Conference 2026). Additive only:
 *
 *   research_users.baseType        enum gains 'AUTHOR' (appended; existing
 *                                  STUDENT / FACULTY values and rows unchanged)
 *   research_author_profiles       one row per AUTHOR account (phone,
 *                                  organization, current status, designation,
 *                                  location) — FK → research_users ON DELETE CASCADE
 *   research_author_registrations  PENDING author registrations: the form data,
 *                                  held until Google proves the same email
 *                                  (single use, 30-minute expiry, hashed token)
 *   research_oauth_states.author_registration_id
 *                                  nullable link from an OAuth flow to the pending
 *                                  registration it may activate
 *
 * Nothing is dropped, renamed or rewritten. Every step is idempotent.
 * Rollback (`down`) refuses while any AUTHOR account / profile exists.
 */
import { T } from "../../lib/db/tables.mjs";
import { UUID } from "../migrate-helpers.mjs";

export const description = "External AUTHOR accounts (AIDC 2026): baseType AUTHOR, author profiles, pending author registrations";
/** Tables this migration CREATES (collision preflight). */
export const tables = () => [T.authorProfiles, T.authorRegistrations];

export const AUTHOR_STATUS_ENUM = "ENUM('WORKING_PROFESSIONAL','STUDENT','RESEARCHER','INDEPENDENT_RESEARCHER','OTHER')";
const HEX64 = "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin";
const TS = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)";
const TSU = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)";

/** information_schema facts about research_users.baseType. */
async function baseTypeColumn(m) {
  return m.db.one(
    `SELECT column_type AS type, is_nullable AS nullable, column_default AS def
       FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'baseType'`,
    [T.users],
  );
}

/** "enum('STUDENT','FACULTY')" → ["STUDENT","FACULTY"] (null if not an enum). */
export function enumValues(type) {
  const m = /^enum\((.*)\)$/i.exec(String(type || "").trim());
  if (!m) return null;
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}

export async function up(m) {
  // ---- 1. research_users.baseType += 'AUTHOR' (append only) -----------------
  const col = await baseTypeColumn(m);
  if (!col) throw new Error(`${T.users}.baseType not found — refusing to continue. Nothing changed.`);
  const values = enumValues(col.type);
  if (!values) throw new Error(`${T.users}.baseType is ${col.type}, not an ENUM — refusing to guess. Nothing changed.`);
  if (!values.includes("STUDENT") || !values.includes("FACULTY")) {
    throw new Error(`${T.users}.baseType has unexpected values (${col.type}). Nothing changed.`);
  }
  if (!values.includes("AUTHOR")) {
    // Appending a value at the END keeps every existing value's index, so no
    // stored row changes (MySQL 8 / MariaDB do this as a metadata change).
    const list = [...values, "AUTHOR"].map((v) => `'${v.replace(/'/g, "''")}'`).join(",");
    const nullable = col.nullable === "YES" ? "NULL" : "NOT NULL";
    const def = col.def == null ? (col.nullable === "YES" ? " DEFAULT NULL" : "") : ` DEFAULT '${String(col.def).replace(/^'|'$/g, "").replace(/'/g, "''")}'`;
    await m.db.query(`ALTER TABLE \`${T.users}\` MODIFY COLUMN \`baseType\` ENUM(${list}) ${nullable}${def}`);
    m.log(`  ~ column ${T.users}.baseType: ${col.type} → enum(${list})`);
  }

  const UID = await m.userIdType(T.users);
  const U = `REFERENCES \`${T.users}\` (\`id\`)`;

  // ---- 2. Author profile (1:1 with an AUTHOR account) -------------------------
  await m.createTable(T.authorProfiles, `
  \`user_id\`        ${UID} NOT NULL,
  \`phone\`          VARCHAR(32) NOT NULL,
  \`organization\`   VARCHAR(200) NOT NULL,
  \`current_status\` ${AUTHOR_STATUS_ENUM} NOT NULL,
  \`designation\`    VARCHAR(200) NOT NULL,
  \`location\`       VARCHAR(200) NOT NULL,
  \`conference\`     VARCHAR(32) NOT NULL DEFAULT 'AIDC_2026',
  \`created_at\`     ${TS},
  \`updated_at\`     ${TSU},
  PRIMARY KEY (\`user_id\`),
  KEY \`research_author_profiles_conference_idx\` (\`conference\`),
  CONSTRAINT \`research_author_profiles_user_fk\` FOREIGN KEY (\`user_id\`) ${U} ON DELETE CASCADE`);

  // ---- 3. Pending registrations (no account exists until Google matches) -----
  await m.createTable(T.authorRegistrations, `
  \`id\`             ${UUID} NOT NULL,
  \`token_hash\`     ${HEX64} NOT NULL,
  \`email\`          VARCHAR(191) NOT NULL,
  \`name\`           VARCHAR(191) NOT NULL,
  \`phone\`          VARCHAR(32) NOT NULL,
  \`organization\`   VARCHAR(200) NOT NULL,
  \`current_status\` ${AUTHOR_STATUS_ENUM} NOT NULL,
  \`designation\`    VARCHAR(200) NOT NULL,
  \`location\`       VARCHAR(200) NOT NULL,
  \`created_at\`     ${TS},
  \`expires_at\`     DATETIME(3) NOT NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_author_registrations_token_uq\` (\`token_hash\`),
  KEY \`research_author_registrations_email_idx\` (\`email\`),
  KEY \`research_author_registrations_expires_idx\` (\`expires_at\`)`);

  // ---- 4. OAuth flow → pending registration link (nullable) ------------------
  await m.addColumn(T.oauthStates, "author_registration_id", `${UUID} NULL`);
}

export async function down(m) {
  const col = await baseTypeColumn(m);
  const values = enumValues(col?.type) || [];
  if (values.includes("AUTHOR")) {
    const n = Number((await m.db.one(`SELECT COUNT(*) AS n FROM \`${T.users}\` WHERE baseType = 'AUTHOR'`)).n);
    if (n > 0) throw new Error(`${n} AUTHOR account(s) exist — refusing to roll back; restore from backup instead.`);
  }
  for (const t of [T.authorProfiles, T.authorRegistrations]) {
    if ((await m.tableExists(t)) && (await m.count(t)) > 0) throw new Error(`${t} is not empty — refusing to drop; restore from backup instead.`);
  }
  if (await m.columnInfo(T.oauthStates, "author_registration_id")) {
    await m.db.query(`ALTER TABLE \`${T.oauthStates}\` DROP COLUMN \`author_registration_id\``);
    m.log(`  - column ${T.oauthStates}.author_registration_id`);
  }
  for (const t of [T.authorProfiles, T.authorRegistrations]) {
    if (await m.tableExists(t)) { await m.db.query(`DROP TABLE \`${t}\``); m.log(`  - table ${t} (was empty)`); }
  }
  if (values.includes("AUTHOR")) {
    const list = values.filter((v) => v !== "AUTHOR").map((v) => `'${v.replace(/'/g, "''")}'`).join(",");
    const nullable = col.nullable === "YES" ? "NULL" : "NOT NULL";
    const def = col.def == null ? "" : ` DEFAULT '${String(col.def).replace(/^'|'$/g, "").replace(/'/g, "''")}'`;
    await m.db.query(`ALTER TABLE \`${T.users}\` MODIFY COLUMN \`baseType\` ENUM(${list}) ${nullable}${def}`);
    m.log(`  ~ column ${T.users}.baseType: AUTHOR removed`);
  }
}

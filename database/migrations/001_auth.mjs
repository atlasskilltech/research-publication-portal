/**
 * 001_auth — application-managed authentication tables (MySQL).
 *
 *   research_users            accounts (base type, admin flag, status, password hash)
 *   research_sessions         server-side sessions (only the SHA-256 of the cookie token)
 *   research_user_roles       ADMINISTRATOR / SPOC / DESK_REVIEWER / PEER_REVIEWER / EDITOR
 *   research_auth_tokens      single-use email-verification / password-reset tokens (hashed)
 *   research_user_identities  Google `sub` ↔ account links
 *   research_oauth_states     single-use OAuth state / nonce / PKCE verifier rows
 *
 * Shared database: only `research_*` objects are created; nothing else is read
 * or altered. scripts/db-migrate.mjs refuses to run if any of these names
 * already exists without having been created by this migration history.
 * Rollback (`down`): drops these tables only while they are empty.
 */
import { T } from "../../lib/db/tables.mjs";
import { UUID } from "../migrate-helpers.mjs";

export const description = "Auth: users, sessions, roles, tokens, identities, oauth states";
/** Tables this migration owns (used by the collision preflight in scripts/db-migrate.mjs). */
export const tables = () => [T.users, T.sessions, T.userRoles, T.authTokens, T.userIdentities, T.oauthStates];

const UID = "VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci";
const HEX64 = "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin";
const TS = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)";
const U = `REFERENCES \`${T.users}\` (\`id\`)`;

export async function up(m) {
  // Column names of the two account tables keep the portal's original
  // camelCase shape (lib/repos/users.mjs maps them).
  await m.createTable(T.users, `
  \`id\`                ${UID} NOT NULL,
  \`name\`              VARCHAR(191) NOT NULL,
  \`email\`             VARCHAR(191) NOT NULL,
  \`passwordHash\`      VARCHAR(255) NULL,
  \`baseType\`          ENUM('STUDENT','FACULTY') NOT NULL DEFAULT 'STUDENT',
  \`isAdmin\`           TINYINT(1) NOT NULL DEFAULT 0,
  \`status\`            ENUM('ACTIVE','DISABLED') NOT NULL DEFAULT 'ACTIVE',
  \`schoolCode\`        VARCHAR(16) NULL,
  \`rollNo\`            VARCHAR(64) NULL,
  \`applicationNo\`     VARCHAR(64) NULL,
  \`emailVerified\`     DATETIME(3) NULL,
  \`passwordChangedAt\` DATETIME(3) NULL,
  \`lastLoginAt\`       DATETIME(3) NULL,
  \`supabaseId\`        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  \`createdAt\`         ${TS},
  \`updatedAt\`         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_users_email_uq\` (\`email\`),
  UNIQUE KEY \`research_users_application_no_uq\` (\`applicationNo\`),
  UNIQUE KEY \`research_users_supabase_id_uq\` (\`supabaseId\`),
  KEY \`research_users_is_admin_idx\` (\`isAdmin\`)`);

  await m.createTable(T.sessions, `
  \`id\`         VARCHAR(191) NOT NULL,
  \`tokenHash\`  VARCHAR(191) NOT NULL,
  \`userId\`     ${UID} NOT NULL,
  \`expiresAt\`  DATETIME(3) NOT NULL,
  \`createdAt\`  ${TS},
  \`lastSeenAt\` DATETIME(3) NULL,
  \`revokedAt\`  DATETIME(3) NULL,
  \`purpose\`    ENUM('APP','SETUP','RESET') NOT NULL DEFAULT 'APP',
  \`authMethod\` VARCHAR(16) NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_sessions_token_hash_uq\` (\`tokenHash\`),
  KEY \`research_sessions_user_idx\` (\`userId\`),
  KEY \`research_sessions_expires_idx\` (\`expiresAt\`),
  CONSTRAINT \`research_sessions_user_fk\` FOREIGN KEY (\`userId\`) ${U} ON DELETE CASCADE ON UPDATE CASCADE`);

  await m.createTable(T.userRoles, `
  \`user_id\`     ${UID} NOT NULL,
  \`role\`        ENUM('ADMINISTRATOR','SPOC','DESK_REVIEWER','PEER_REVIEWER','EDITOR') NOT NULL,
  \`assigned_by\` ${UID} NULL,
  \`assigned_at\` ${TS},
  PRIMARY KEY (\`user_id\`, \`role\`),
  KEY \`research_user_roles_role_idx\` (\`role\`),
  CONSTRAINT \`research_user_roles_user_fk\` FOREIGN KEY (\`user_id\`) ${U} ON DELETE CASCADE,
  CONSTRAINT \`research_user_roles_assigned_by_fk\` FOREIGN KEY (\`assigned_by\`) ${U} ON DELETE SET NULL`);

  await m.createTable(T.authTokens, `
  \`token_hash\`  ${HEX64} NOT NULL,
  \`user_id\`     ${UID} NOT NULL,
  \`purpose\`     ENUM('INVITE','RECOVERY') NOT NULL,
  \`expires_at\`  DATETIME(3) NOT NULL,
  \`consumed_at\` DATETIME(3) NULL,
  \`created_at\`  ${TS},
  PRIMARY KEY (\`token_hash\`),
  KEY \`research_auth_tokens_user_idx\` (\`user_id\`, \`purpose\`),
  KEY \`research_auth_tokens_expires_idx\` (\`expires_at\`),
  CONSTRAINT \`research_auth_tokens_user_fk\` FOREIGN KEY (\`user_id\`) ${U} ON DELETE CASCADE`);

  await m.createTable(T.userIdentities, `
  \`id\`            ${UUID} NOT NULL,
  \`user_id\`       ${UID} NOT NULL,
  \`provider\`      VARCHAR(32) NOT NULL,
  \`subject\`       VARCHAR(255) NOT NULL,
  \`email\`         VARCHAR(191) NOT NULL,
  \`created_at\`    ${TS},
  \`last_login_at\` DATETIME(3) NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_user_identities_provider_subject_uq\` (\`provider\`, \`subject\`),
  UNIQUE KEY \`research_user_identities_user_provider_uq\` (\`user_id\`, \`provider\`),
  CONSTRAINT \`research_user_identities_user_fk\` FOREIGN KEY (\`user_id\`) ${U} ON DELETE CASCADE`);

  await m.createTable(T.oauthStates, `
  \`state_hash\`    ${HEX64} NOT NULL,
  \`nonce\`         VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`code_verifier\` VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`next_path\`     VARCHAR(512) NOT NULL,
  \`created_at\`    ${TS},
  \`expires_at\`    DATETIME(3) NOT NULL,
  PRIMARY KEY (\`state_hash\`),
  KEY \`research_oauth_states_expires_idx\` (\`expires_at\`)`);
}

const TABLES = () => [T.oauthStates, T.userIdentities, T.authTokens, T.userRoles, T.sessions, T.users];

export async function down(m) {
  for (const t of TABLES()) if ((await m.tableExists(t)) && (await m.count(t)) > 0) throw new Error(`${t} is not empty — refusing to drop; restore from backup instead.`);
  for (const t of TABLES()) if (await m.tableExists(t)) { await m.db.query(`DROP TABLE \`${t}\``); m.log(`  - table ${t} (was empty)`); }
}

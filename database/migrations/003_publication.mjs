/**
 * 003_publication — research_volumes, research_issues, research_publications.
 * The public archive is served only through the whitelisting shapers in
 * lib/publicCatalog.js (fully published chain only).
 *
 * Integrity kept in the database:
 *   unique (year, volume_number), unique (volume_id, issue_number),
 *   unique paper_id (no duplicate publication), unique DOI (case-insensitive
 *   collation), composite FK (issue_id, volume_id) → issues(id, volume_id) so an
 *   issue can never belong to a different volume than its publication.
 * Shared database: only research_* objects are created.
 * Rollback: `down` drops these tables only when all are empty.
 */
import { T } from "../../lib/db/tables.mjs";
import { UUID } from "../migrate-helpers.mjs";

export const description = "Publication tables: volumes, issues, publications";
/** Tables this migration owns (used by the collision preflight in scripts/db-migrate.mjs). */
export const tables = () => [T.volumes, T.issues, T.publications];

const TS = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)";
const TSU = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)";

export async function up(m) {
  const UID = await m.userIdType(T.users);
  const U = `REFERENCES \`${T.users}\` (\`id\`)`;

  await m.createTable(T.volumes, `
  \`id\`            ${UUID} NOT NULL,
  \`volume_number\` INT NOT NULL,
  \`year\`          INT NOT NULL,
  \`title\`         VARCHAR(300) NOT NULL,
  \`description\`   TEXT NOT NULL,
  \`status\`        ENUM('DRAFT','SCHEDULED','PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  \`published_at\`  DATETIME(3) NULL,
  \`created_by\`    ${UID} NULL,
  \`created_at\`    ${TS},
  \`updated_at\`    ${TSU},
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_volumes_year_number_uq\` (\`year\`, \`volume_number\`),
  KEY \`research_volumes_status_idx\` (\`status\`),
  CONSTRAINT \`research_volumes_created_by_fk\` FOREIGN KEY (\`created_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_volumes_number_ck\` CHECK (\`volume_number\` BETWEEN 1 AND 9999),
  CONSTRAINT \`research_volumes_year_ck\` CHECK (\`year\` BETWEEN 1900 AND 2200)`);

  await m.createTable(T.issues, `
  \`id\`               ${UUID} NOT NULL,
  \`volume_id\`        ${UUID} NOT NULL,
  \`issue_number\`     INT NOT NULL,
  \`title\`            VARCHAR(300) NOT NULL,
  \`description\`      TEXT NOT NULL,
  \`publication_date\` DATE NULL,
  \`status\`           ENUM('DRAFT','SCHEDULED','PUBLISHED') NOT NULL DEFAULT 'DRAFT',
  \`published_at\`     DATETIME(3) NULL,
  \`created_by\`       ${UID} NULL,
  \`created_at\`       ${TS},
  \`updated_at\`       ${TSU},
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_issues_volume_number_uq\` (\`volume_id\`, \`issue_number\`),
  UNIQUE KEY \`research_issues_id_volume_uq\` (\`id\`, \`volume_id\`),
  KEY \`research_issues_status_idx\` (\`status\`),
  CONSTRAINT \`research_issues_volume_fk\` FOREIGN KEY (\`volume_id\`) REFERENCES \`${T.volumes}\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`research_issues_created_by_fk\` FOREIGN KEY (\`created_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_issues_number_ck\` CHECK (\`issue_number\` BETWEEN 1 AND 999)`);

  await m.createTable(T.publications, `
  \`id\`                ${UUID} NOT NULL,
  \`paper_id\`          ${UUID} NOT NULL,
  \`volume_id\`         ${UUID} NOT NULL,
  \`issue_id\`          ${UUID} NOT NULL,
  \`title\`             VARCHAR(500) NOT NULL,
  \`abstract\`          TEXT NOT NULL,
  \`authors\`           JSON NOT NULL,
  \`keywords\`          JSON NOT NULL,
  \`page_start\`        INT NULL,
  \`page_end\`          INT NULL,
  \`doi\`               VARCHAR(255) NULL,
  \`publication_date\`  DATE NULL,
  \`manuscript_id\`     ${UUID} NULL,
  \`manuscript_public\` TINYINT(1) NOT NULL DEFAULT 0,
  \`status\`            ENUM('SCHEDULED','PUBLISHED') NOT NULL DEFAULT 'SCHEDULED',
  \`version\`           INT NOT NULL DEFAULT 1,
  \`scheduled_by\`      ${UID} NULL,
  \`scheduled_at\`      ${TS},
  \`published_by\`      ${UID} NULL,
  \`published_at\`      DATETIME(3) NULL,
  \`created_at\`        ${TS},
  \`updated_at\`        ${TSU},
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_publications_paper_uq\` (\`paper_id\`),
  UNIQUE KEY \`research_publications_doi_uq\` (\`doi\`),
  KEY \`research_publications_issue_idx\` (\`issue_id\`, \`volume_id\`),
  KEY \`research_publications_status_idx\` (\`status\`),
  CONSTRAINT \`research_publications_paper_fk\` FOREIGN KEY (\`paper_id\`) REFERENCES \`${T.papers}\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`research_publications_volume_fk\` FOREIGN KEY (\`volume_id\`) REFERENCES \`${T.volumes}\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`research_publications_issue_in_volume_fk\` FOREIGN KEY (\`issue_id\`, \`volume_id\`) REFERENCES \`${T.issues}\` (\`id\`, \`volume_id\`) ON DELETE RESTRICT,
  CONSTRAINT \`research_publications_manuscript_fk\` FOREIGN KEY (\`manuscript_id\`) REFERENCES \`${T.paperManuscripts}\` (\`id\`) ON DELETE RESTRICT,
  CONSTRAINT \`research_publications_scheduled_by_fk\` FOREIGN KEY (\`scheduled_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_publications_published_by_fk\` FOREIGN KEY (\`published_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_publications_pages_ck\` CHECK (\`page_end\` IS NULL OR (\`page_start\` IS NOT NULL AND \`page_end\` >= \`page_start\`)),
  CONSTRAINT \`research_publications_page_start_ck\` CHECK (\`page_start\` IS NULL OR \`page_start\` >= 1),
  CONSTRAINT \`research_publications_published_ck\` CHECK (\`status\` = 'SCHEDULED' OR (\`published_at\` IS NOT NULL AND \`publication_date\` IS NOT NULL))`);
}

export async function down(m) {
  const ts = [T.publications, T.issues, T.volumes];
  for (const t of ts) if ((await m.tableExists(t)) && (await m.count(t)) > 0) throw new Error(`${t} is not empty — refusing to drop; restore from backup instead.`);
  for (const t of ts) if (await m.tableExists(t)) { await m.db.query(`DROP TABLE \`${t}\``); m.log(`  - table ${t} (was empty)`); }
}

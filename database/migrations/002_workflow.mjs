/**
 * 002_workflow — submission, peer review, revision and editorial-decision tables:
 *   research_papers, research_paper_authors, research_paper_manuscripts,
 *   research_paper_assignments (reviewer + editor assignments), research_paper_activity,
 *   research_reviews, research_revisions, research_editorial_decisions
 *
 *   ids          → CHAR(36) ascii (app-generated crypto.randomUUID)
 *   lists/objects → JSON columns       timestamps → DATETIME(3) in UTC
 *   "one corresponding author" / "one open revision per paper" are enforced by
 *     the service layer inside transactions under SELECT … FOR UPDATE on the
 *     paper (MySQL forbids CASCADE FKs on generated-column bases).
 *   authorization → server-side (lib/paperAccess.js etc.); the database is never
 *     exposed to browsers.
 *   state transitions → lib/services/workflow.mjs (one transaction each).
 *   decision immutability → every UPDATE of a decision is guarded by
 *     `released_at IS NULL` (no triggers: they need extra privileges on shared hosts).
 * Shared database: only research_* objects are created.
 * Rollback: `down` drops these tables only when ALL of them are empty.
 */
import { T } from "../../lib/db/tables.mjs";
import { UUID } from "../migrate-helpers.mjs";

export const description = "Workflow tables: papers, authors, manuscripts, assignments, activity, reviews, revisions, decisions";
/** Tables this migration owns (used by the collision preflight in scripts/db-migrate.mjs). */
export const tables = () => [T.papers, T.paperAuthors, T.paperManuscripts, T.paperAssignments, T.paperActivity, T.reviews, T.paperRevisions, T.editorialDecisions];

const TS = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)";
const TSU = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)";

export async function up(m) {
  const UID = await m.userIdType(T.users);
  const U = `REFERENCES \`${T.users}\` (\`id\`)`;
  const P = `REFERENCES \`${T.papers}\` (\`id\`)`;

  await m.createTable(T.papers, `
  \`id\`            ${UUID} NOT NULL,
  \`title\`         VARCHAR(300) NOT NULL,
  \`abstract\`      TEXT NOT NULL,
  \`keywords\`      JSON NOT NULL,
  \`school_code\`   VARCHAR(16) NULL,
  \`status\`        ENUM('SUBMITTED','UNDER_REVIEW','REVISION','ACCEPTED','REJECTED','PUBLISHED','ARCHIVED') NOT NULL DEFAULT 'SUBMITTED',
  \`submitted_by\`  ${UID} NULL,
  \`current_round\` INT NOT NULL DEFAULT 0,
  \`created_at\`    ${TS},
  \`updated_at\`    ${TSU},
  PRIMARY KEY (\`id\`),
  KEY \`research_papers_submitted_by_idx\` (\`submitted_by\`),
  KEY \`research_papers_status_idx\` (\`status\`),
  CONSTRAINT \`research_papers_submitted_by_fk\` FOREIGN KEY (\`submitted_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_papers_round_ck\` CHECK (\`current_round\` >= 0)`);

  await m.createTable(T.paperAuthors, `
  \`id\`               ${UUID} NOT NULL,
  \`paper_id\`         ${UUID} NOT NULL,
  \`full_name\`        VARCHAR(300) NOT NULL,
  \`email\`            VARCHAR(254) NULL,
  \`affiliation\`      VARCHAR(500) NULL,
  \`is_corresponding\` TINYINT(1) NOT NULL DEFAULT 0,
  \`author_order\`     INT NOT NULL,
  \`created_at\`       ${TS},
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_paper_authors_order_uq\` (\`paper_id\`, \`author_order\`),
  CONSTRAINT \`research_paper_authors_paper_fk\` FOREIGN KEY (\`paper_id\`) ${P} ON DELETE CASCADE`);

  await m.createTable(T.paperManuscripts, `
  \`id\`                ${UUID} NOT NULL,
  \`paper_id\`          ${UUID} NOT NULL,
  \`version\`           INT NOT NULL DEFAULT 0,
  \`storage_key\`       VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`original_filename\` VARCHAR(255) NULL,
  \`mime_type\`         VARCHAR(127) NOT NULL,
  \`byte_size\`         BIGINT NOT NULL,
  \`sha256\`            CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`uploaded_by\`       ${UID} NULL,
  \`created_at\`        ${TS},
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_paper_manuscripts_storage_key_uq\` (\`storage_key\`),
  UNIQUE KEY \`research_paper_manuscripts_paper_version_uq\` (\`paper_id\`, \`version\`),
  CONSTRAINT \`research_paper_manuscripts_paper_fk\` FOREIGN KEY (\`paper_id\`) ${P} ON DELETE CASCADE,
  CONSTRAINT \`research_paper_manuscripts_uploader_fk\` FOREIGN KEY (\`uploaded_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_paper_manuscripts_version_ck\` CHECK (\`version\` >= 0)`);

  await m.createTable(T.paperAssignments, `
  \`id\`          ${UUID} NOT NULL,
  \`paper_id\`    ${UUID} NOT NULL,
  \`assignee\`    ${UID} NOT NULL,
  \`role\`        ENUM('SPOC','DESK_REVIEWER','PEER_REVIEWER','EDITOR') NOT NULL,
  \`assigned_by\` ${UID} NULL,
  \`assigned_at\` ${TS},
  \`due_at\`      DATETIME(3) NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_paper_assignments_paper_assignee_role_uq\` (\`paper_id\`, \`assignee\`, \`role\`),
  KEY \`research_paper_assignments_assignee_idx\` (\`assignee\`),
  CONSTRAINT \`research_paper_assignments_paper_fk\` FOREIGN KEY (\`paper_id\`) ${P} ON DELETE CASCADE,
  CONSTRAINT \`research_paper_assignments_assignee_fk\` FOREIGN KEY (\`assignee\`) ${U} ON DELETE CASCADE,
  CONSTRAINT \`research_paper_assignments_assigned_by_fk\` FOREIGN KEY (\`assigned_by\`) ${U} ON DELETE SET NULL`);

  await m.createTable(T.paperActivity, `
  \`id\`         ${UUID} NOT NULL,
  \`paper_id\`   ${UUID} NOT NULL,
  \`actor\`      ${UID} NULL,
  \`action\`     VARCHAR(64) NOT NULL,
  \`detail\`     JSON NOT NULL,
  \`created_at\` ${TS},
  PRIMARY KEY (\`id\`),
  KEY \`research_paper_activity_paper_idx\` (\`paper_id\`, \`created_at\`),
  KEY \`research_paper_activity_created_idx\` (\`created_at\`),
  CONSTRAINT \`research_paper_activity_paper_fk\` FOREIGN KEY (\`paper_id\`) ${P} ON DELETE CASCADE,
  CONSTRAINT \`research_paper_activity_actor_fk\` FOREIGN KEY (\`actor\`) ${U} ON DELETE SET NULL`);

  await m.createTable(T.reviews, `
  \`id\`                     ${UUID} NOT NULL,
  \`paper_id\`               ${UUID} NOT NULL,
  \`reviewer\`               ${UID} NOT NULL,
  \`round\`                  INT NOT NULL DEFAULT 0,
  \`status\`                 ENUM('DRAFT','SUBMITTED') NOT NULL DEFAULT 'DRAFT',
  \`recommendation\`         ENUM('ACCEPT','MINOR_REVISION','MAJOR_REVISION','REJECT') NULL,
  \`technical_quality\`      TINYINT NULL,
  \`originality\`            TINYINT NULL,
  \`methodology\`            TINYINT NULL,
  \`clarity\`                TINYINT NULL,
  \`strengths\`              TEXT NULL,
  \`weaknesses\`             TEXT NULL,
  \`comments_to_author\`     TEXT NULL,
  \`confidential_to_editor\` TEXT NULL,
  \`submitted_at\`           DATETIME(3) NULL,
  \`created_at\`             ${TS},
  \`updated_at\`             ${TSU},
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_reviews_paper_reviewer_round_uq\` (\`paper_id\`, \`reviewer\`, \`round\`),
  KEY \`research_reviews_reviewer_idx\` (\`reviewer\`),
  CONSTRAINT \`research_reviews_paper_fk\` FOREIGN KEY (\`paper_id\`) ${P} ON DELETE CASCADE,
  CONSTRAINT \`research_reviews_reviewer_fk\` FOREIGN KEY (\`reviewer\`) ${U} ON DELETE CASCADE,
  CONSTRAINT \`research_reviews_scores_ck\` CHECK (
    (\`technical_quality\` IS NULL OR \`technical_quality\` BETWEEN 1 AND 5) AND
    (\`originality\` IS NULL OR \`originality\` BETWEEN 1 AND 5) AND
    (\`methodology\` IS NULL OR \`methodology\` BETWEEN 1 AND 5) AND
    (\`clarity\` IS NULL OR \`clarity\` BETWEEN 1 AND 5)),
  CONSTRAINT \`research_reviews_submitted_complete_ck\` CHECK (
    \`status\` = 'DRAFT' OR (\`recommendation\` IS NOT NULL AND \`submitted_at\` IS NOT NULL
      AND \`technical_quality\` IS NOT NULL AND \`originality\` IS NOT NULL
      AND \`methodology\` IS NOT NULL AND \`clarity\` IS NOT NULL)),
  CONSTRAINT \`research_reviews_round_ck\` CHECK (\`round\` >= 0)`);

  await m.createTable(T.paperRevisions, `
  \`id\`                  ${UUID} NOT NULL,
  \`paper_id\`            ${UUID} NOT NULL,
  \`round\`               INT NOT NULL,
  \`revision_type\`       ENUM('MINOR','MAJOR') NOT NULL,
  \`instructions\`        TEXT NOT NULL,
  \`due_at\`              DATETIME(3) NULL,
  \`status\`              ENUM('REVISION_REQUESTED','REVISION_IN_PROGRESS','REVISION_SUBMITTED','REVISION_UNDER_REVIEW') NOT NULL DEFAULT 'REVISION_REQUESTED',
  \`review_ids\`          JSON NOT NULL,
  \`responses\`           JSON NOT NULL,
  \`requested_by\`        ${UID} NULL,
  \`requested_at\`        ${TS},
  \`started_at\`          DATETIME(3) NULL,
  \`submitted_at\`        DATETIME(3) NULL,
  \`submitted_by\`        ${UID} NULL,
  \`rereview_started_at\` DATETIME(3) NULL,
  \`updated_at\`          ${TSU},
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_revisions_round_uq\` (\`paper_id\`, \`round\`),
  CONSTRAINT \`research_revisions_paper_fk\` FOREIGN KEY (\`paper_id\`) ${P} ON DELETE CASCADE,
  CONSTRAINT \`research_revisions_requested_by_fk\` FOREIGN KEY (\`requested_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_revisions_submitted_by_fk\` FOREIGN KEY (\`submitted_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_revisions_round_ck\` CHECK (\`round\` >= 1)`);

  await m.createTable(T.editorialDecisions, `
  \`id\`                ${UUID} NOT NULL,
  \`paper_id\`          ${UUID} NOT NULL,
  \`round\`             INT NOT NULL,
  \`decision\`          ENUM('ACCEPT','MINOR_REVISION','MAJOR_REVISION','REJECT') NOT NULL,
  \`summary\`           TEXT NOT NULL,
  \`confidential_note\` TEXT NULL,
  \`review_ids\`        JSON NOT NULL,
  \`revision_due_at\`   DATETIME(3) NULL,
  \`revision_id\`       ${UUID} NULL,
  \`version\`           INT NOT NULL DEFAULT 1,
  \`decided_by\`        ${UID} NULL,
  \`created_at\`        ${TS},
  \`updated_at\`        ${TSU},
  \`released_at\`       DATETIME(3) NULL,
  \`released_by\`       ${UID} NULL,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`research_editorial_decisions_round_uq\` (\`paper_id\`, \`round\`),
  KEY \`research_editorial_decisions_released_idx\` (\`released_at\`),
  CONSTRAINT \`research_editorial_decisions_paper_fk\` FOREIGN KEY (\`paper_id\`) ${P} ON DELETE CASCADE,
  CONSTRAINT \`research_editorial_decisions_revision_fk\` FOREIGN KEY (\`revision_id\`) REFERENCES \`${T.paperRevisions}\` (\`id\`) ON DELETE SET NULL,
  CONSTRAINT \`research_editorial_decisions_decided_by_fk\` FOREIGN KEY (\`decided_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_editorial_decisions_released_by_fk\` FOREIGN KEY (\`released_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_editorial_decisions_round_ck\` CHECK (\`round\` >= 0)`);
}

const TABLES = () => [T.editorialDecisions, T.paperRevisions, T.reviews, T.paperActivity, T.paperAssignments, T.paperManuscripts, T.paperAuthors, T.papers];

export async function down(m) {
  for (const t of TABLES()) if ((await m.tableExists(t)) && (await m.count(t)) > 0) throw new Error(`${t} is not empty — refusing to drop; restore from backup instead.`);
  for (const t of TABLES()) if (await m.tableExists(t)) { await m.db.query(`DROP TABLE \`${t}\``); m.log(`  - table ${t} (was empty)`); }
}

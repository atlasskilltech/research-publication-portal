/**
 * 005_program_chair — Program Chair final approval. Additive only:
 *
 *   research_user_roles.role      enum gains 'PROGRAM_CHAIR' (appended; existing
 *                                 values and rows unchanged)
 *   research_decision_approvals   one row per "send to Program Chair" request for
 *                                 an Accept / Minor / Major revision decision:
 *                                 PENDING → APPROVED (decision communicated) or
 *                                 RETURNED (back to the editor, with a comment).
 *                                 Reject decisions never need approval.
 *
 * Nothing is dropped, renamed or rewritten. Every step is idempotent.
 * Rollback (`down`) refuses while any PROGRAM_CHAIR role or approval row exists.
 */
import { T } from "../../lib/db/tables.mjs";
import { UUID } from "../migrate-helpers.mjs";
import { enumValues } from "./004_author_role.mjs";

export const description = "Program Chair: role PROGRAM_CHAIR + decision approvals (final approval of Accept / Revision)";
/** Tables this migration CREATES (collision preflight). */
export const tables = () => [T.decisionApprovals];

const TS = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)";
const TSU = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)";
const quote = (v) => `'${v.replace(/'/g, "''")}'`;

async function roleColumn(m) {
  return m.db.one(
    `SELECT column_type AS type, is_nullable AS nullable FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'role'`,
    [T.userRoles],
  );
}

export async function up(m) {
  // ---- 1. research_user_roles.role += 'PROGRAM_CHAIR' (append only) ---------
  const col = await roleColumn(m);
  if (!col) throw new Error(`${T.userRoles}.role not found — refusing to continue. Nothing changed.`);
  const values = enumValues(col.type);
  if (!values) throw new Error(`${T.userRoles}.role is ${col.type}, not an ENUM — refusing to guess. Nothing changed.`);
  if (!values.includes("ADMINISTRATOR") || !values.includes("EDITOR")) {
    throw new Error(`${T.userRoles}.role has unexpected values (${col.type}). Nothing changed.`);
  }
  if (!values.includes("PROGRAM_CHAIR")) {
    // Appending at the END keeps every existing value's index: no stored row changes.
    const list = [...values, "PROGRAM_CHAIR"].map(quote).join(",");
    await m.db.query(`ALTER TABLE \`${T.userRoles}\` MODIFY COLUMN \`role\` ENUM(${list}) ${col.nullable === "YES" ? "NULL" : "NOT NULL"}`);
    m.log(`  ~ column ${T.userRoles}.role: ${col.type} → enum(${list})`);
  }

  // ---- 2. Approval requests ---------------------------------------------------
  const UID = await m.userIdType(T.users);
  const U = `REFERENCES \`${T.users}\` (\`id\`)`;
  await m.createTable(T.decisionApprovals, `
  \`id\`               ${UUID} NOT NULL,
  \`paper_id\`         ${UUID} NOT NULL,
  \`decision_id\`      ${UUID} NOT NULL,
  \`round\`            INT NOT NULL,
  \`decision\`         ENUM('ACCEPT','MINOR_REVISION','MAJOR_REVISION') NOT NULL,
  \`decision_version\` INT NOT NULL,
  \`status\`           ENUM('PENDING','APPROVED','RETURNED') NOT NULL DEFAULT 'PENDING',
  \`requested_by\`     ${UID} NULL,
  \`requested_at\`     ${TS},
  \`acted_by\`         ${UID} NULL,
  \`acted_at\`         DATETIME(3) NULL,
  \`comment\`          TEXT NULL,
  \`updated_at\`       ${TSU},
  PRIMARY KEY (\`id\`),
  KEY \`research_decision_approvals_status_idx\` (\`status\`, \`requested_at\`),
  KEY \`research_decision_approvals_decision_idx\` (\`decision_id\`),
  KEY \`research_decision_approvals_paper_idx\` (\`paper_id\`),
  CONSTRAINT \`research_decision_approvals_paper_fk\` FOREIGN KEY (\`paper_id\`) REFERENCES \`${T.papers}\` (\`id\`) ON DELETE CASCADE,
  CONSTRAINT \`research_decision_approvals_decision_fk\` FOREIGN KEY (\`decision_id\`) REFERENCES \`${T.editorialDecisions}\` (\`id\`) ON DELETE CASCADE,
  CONSTRAINT \`research_decision_approvals_requested_by_fk\` FOREIGN KEY (\`requested_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_decision_approvals_acted_by_fk\` FOREIGN KEY (\`acted_by\`) ${U} ON DELETE SET NULL,
  CONSTRAINT \`research_decision_approvals_round_ck\` CHECK (\`round\` >= 0)`);
}

export async function down(m) {
  const col = await roleColumn(m);
  const values = enumValues(col?.type) || [];
  if (values.includes("PROGRAM_CHAIR")) {
    const n = Number((await m.db.one(`SELECT COUNT(*) AS n FROM \`${T.userRoles}\` WHERE role = 'PROGRAM_CHAIR'`)).n);
    if (n > 0) throw new Error(`${n} PROGRAM_CHAIR role(s) exist — remove them in Users first, or restore from backup.`);
  }
  if ((await m.tableExists(T.decisionApprovals)) && (await m.count(T.decisionApprovals)) > 0) {
    throw new Error(`${T.decisionApprovals} is not empty — refusing to drop; restore from backup instead.`);
  }
  if (await m.tableExists(T.decisionApprovals)) {
    await m.db.query(`DROP TABLE \`${T.decisionApprovals}\``);
    m.log(`  - table ${T.decisionApprovals} (was empty)`);
  }
  if (values.includes("PROGRAM_CHAIR")) {
    const list = values.filter((v) => v !== "PROGRAM_CHAIR").map(quote).join(",");
    await m.db.query(`ALTER TABLE \`${T.userRoles}\` MODIFY COLUMN \`role\` ENUM(${list}) ${col.nullable === "YES" ? "NULL" : "NOT NULL"}`);
    m.log(`  ~ column ${T.userRoles}.role: PROGRAM_CHAIR removed`);
  }
}

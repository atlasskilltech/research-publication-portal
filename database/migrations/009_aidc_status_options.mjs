/**
 * 009_aidc_status_options — AIDC registration "Current status" now offers
 * Student / Academician / Industry Practitioner. Additive only:
 *
 *   research_author_profiles.current_status       enum += ACADEMICIAN, INDUSTRY_PRACTITIONER
 *   research_author_registrations.current_status  enum += ACADEMICIAN, INDUSTRY_PRACTITIONER
 *
 * Values are APPENDED, so every existing row keeps its value (older accounts
 * may still show "Working Professional", "Researcher" … — those labels stay
 * readable in lib/authorRegistration.js). Idempotent.
 * Rollback (`down`) refuses while any row uses a new value.
 */
import { T } from "../../lib/db/tables.mjs";
import { enumValues } from "./004_author_role.mjs";

export const description = "AIDC current status: + Academician, Industry Practitioner";
/** Tables this migration CREATES (none — collision preflight). */
export const tables = () => [];

const NEW_VALUES = ["ACADEMICIAN", "INDUSTRY_PRACTITIONER"];
const quote = (v) => `'${v.replace(/'/g, "''")}'`;

async function statusColumn(m, table) {
  return m.db.one(
    `SELECT column_type AS type, is_nullable AS nullable FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'current_status'`,
    [table],
  );
}

export async function up(m) {
  for (const table of [T.authorProfiles, T.authorRegistrations]) {
    if (!(await m.tableExists(table))) continue;
    const col = await statusColumn(m, table);
    if (!col) throw new Error(`${table}.current_status not found — refusing to continue. Nothing changed.`);
    const values = enumValues(col.type);
    if (!values || !values.includes("STUDENT")) throw new Error(`${table}.current_status is ${col.type} — unexpected. Nothing changed.`);
    const missing = NEW_VALUES.filter((v) => !values.includes(v));
    if (!missing.length) continue;
    const list = [...values, ...missing].map(quote).join(",");
    await m.db.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`current_status\` ENUM(${list}) ${col.nullable === "YES" ? "NULL" : "NOT NULL"}`);
    m.log(`  ~ column ${table}.current_status += ${missing.join(", ")}`);
  }
}

export async function down(m) {
  for (const table of [T.authorProfiles, T.authorRegistrations]) {
    if (!(await m.tableExists(table))) continue;
    const n = Number((await m.db.one(`SELECT COUNT(*) AS n FROM \`${table}\` WHERE current_status IN (?)`, [NEW_VALUES])).n);
    if (n > 0) throw new Error(`${n} row(s) in ${table} use the new statuses — restore from backup instead.`);
  }
  for (const table of [T.authorProfiles, T.authorRegistrations]) {
    if (!(await m.tableExists(table))) continue;
    const col = await statusColumn(m, table);
    const values = (enumValues(col?.type) || []).filter((v) => !NEW_VALUES.includes(v));
    await m.db.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`current_status\` ENUM(${values.map(quote).join(",")}) ${col.nullable === "YES" ? "NULL" : "NOT NULL"}`);
    m.log(`  ~ column ${table}.current_status: new statuses removed`);
  }
}

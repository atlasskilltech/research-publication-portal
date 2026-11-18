/**
 * 008_paper_ref_ids — readable, unique paper reference IDs (ISDI-2026-0001 …).
 * See lib/paperRef.mjs for the format. Additive only:
 *
 *   research_paper_ref_counters   last number used per (prefix, year)
 *   research_papers.ref_id        VARCHAR(32) NULL + UNIQUE index
 *                                 (NULL only for a paper not yet numbered;
 *                                 the submit route always sets it)
 *
 * Backfill: every existing paper without a ref_id gets one, oldest first, in
 * submission order, so the earliest paper of each prefix + year is 0001.
 * Prefix = AIDC when the submitter is an external AUTHOR, else the paper's
 * school, else GEN. Each paper is numbered in its own small transaction
 * (counter + paper together), so a re-run continues where it stopped and
 * never renumbers a paper that already has an ID.
 *
 * Nothing is dropped or rewritten. Every step is idempotent.
 * Rollback (`down`) clears the column/table only on request (`--rollback 008 --yes`).
 */
import { T } from "../../lib/db/tables.mjs";
import { refPrefix, refYear, nextPaperRef } from "../../lib/paperRef.mjs";

export const description = "Paper reference IDs (ISDI-2026-0001 …): ref counters + research_papers.ref_id, backfilled for existing papers";
/** Tables this migration CREATES (collision preflight). */
export const tables = () => [T.paperRefCounters];

const TSU = "DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)";

export async function up(m) {
  await m.createTable(T.paperRefCounters, `
  \`prefix\`      VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`year\`        SMALLINT NOT NULL,
  \`last_number\` INT NOT NULL,
  \`updated_at\`  ${TSU},
  PRIMARY KEY (\`prefix\`, \`year\`),
  CONSTRAINT \`research_paper_ref_counters_number_ck\` CHECK (\`last_number\` >= 1)`);

  await m.addColumn(T.papers, "ref_id", "VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER `id`");
  await m.addIndex(T.papers, "research_papers_ref_id_uq", "UNIQUE KEY `research_papers_ref_id_uq` (`ref_id`)");

  // ---- Backfill existing papers, oldest first ------------------------------
  const rows = await m.db.query(
    `SELECT p.id, p.school_code, p.created_at, u.baseType AS base_type
       FROM \`${T.papers}\` p LEFT JOIN \`${T.users}\` u ON u.id = p.submitted_by
      WHERE p.ref_id IS NULL
      ORDER BY p.created_at ASC, p.id ASC`,
  );
  let done = 0;
  for (const r of rows) {
    await m.db.transaction(async (tx) => {
      const ref = await nextPaperRef(tx, {
        prefix: refPrefix({ baseType: r.base_type, schoolCode: r.school_code }),
        year: refYear(r.created_at),
      });
      const res = await tx.exec(`UPDATE \`${T.papers}\` SET ref_id = ?, updated_at = updated_at WHERE id = ? AND ref_id IS NULL`, [ref, r.id]);
      if (res.affectedRows !== 1) throw new Error(`paper ${r.id} changed during backfill — re-run the migration`);
    });
    done++;
  }
  if (rows.length) m.log(`  ~ ${done} existing paper(s) given a reference ID`);
}

export async function down(m) {
  if (await m.indexExists(T.papers, "research_papers_ref_id_uq")) {
    await m.db.query(`ALTER TABLE \`${T.papers}\` DROP INDEX \`research_papers_ref_id_uq\``);
    m.log(`  - index ${T.papers}.research_papers_ref_id_uq`);
  }
  if (await m.columnInfo(T.papers, "ref_id")) {
    await m.db.query(`ALTER TABLE \`${T.papers}\` DROP COLUMN \`ref_id\``);
    m.log(`  - column ${T.papers}.ref_id`);
  }
  if (await m.tableExists(T.paperRefCounters)) {
    await m.db.query(`DROP TABLE \`${T.paperRefCounters}\``);
    m.log(`  - table ${T.paperRefCounters}`);
  }
}

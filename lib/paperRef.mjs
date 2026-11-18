/**
 * Paper reference IDs — short, readable and unique, e.g. ISDI-2026-0001.
 *
 *   <PREFIX>-<YEAR>-<NNNN>
 *
 *   PREFIX  AIDC   the submitter is an external AUTHOR (AIDC conference)
 *           ISDI / ISME / UGDX / LAW   the school chosen on the submit form
 *           GEN    no school chosen
 *   YEAR    the year the paper was submitted (India time, Asia/Kolkata)
 *   NNNN    running number per PREFIX + YEAR, starting at 0001 every year
 *           (grows to 5+ digits automatically after 9999)
 *
 * Uniqueness: the number is minted by the server inside the submission
 * transaction from research_paper_ref_counters (one row per prefix + year,
 * row-locked by the upsert until COMMIT), and research_papers.ref_id has a
 * UNIQUE index as the final guard. A rolled-back submission also rolls back its
 * counter increment, so numbers are not skipped.
 *
 * `.mjs` so both the Next app and the migration scripts can import it.
 */
import { T } from "./db/tables.mjs";

export const REF_PREFIXES = Object.freeze(["ISDI", "ISME", "UGDX", "LAW", "AIDC", "GEN"]);
const SCHOOL_PREFIX = Object.freeze({ ISDI: "ISDI", ISME: "ISME", UGDX: "UGDX", LAW: "LAW" });
const REF_TZ = "Asia/Kolkata";

/** Prefix for a paper: AIDC for external authors, else its school, else GEN. */
export function refPrefix({ baseType, schoolCode } = {}) {
  if (String(baseType || "").toUpperCase() === "AUTHOR") return "AIDC";
  return SCHOOL_PREFIX[String(schoolCode || "").trim().toUpperCase()] || "GEN";
}

/** Calendar year of `date` in India time (a paper sent at 00:30 IST on 1 Jan counts for the new year). */
export function refYear(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error("refYear: invalid date");
  return Number(new Intl.DateTimeFormat("en-CA", { timeZone: REF_TZ, year: "numeric" }).format(d));
}

export function formatRef(prefix, year, n) {
  return `${prefix}-${year}-${String(n).padStart(4, "0")}`;
}

export const REF_PATTERN = /^(ISDI|ISME|UGDX|LAW|AIDC|GEN)-\d{4}-\d{4,}$/;

/**
 * Mint the next reference ID. MUST be called inside a transaction (`tx`), the
 * same one that inserts/updates the paper: the counter row stays locked until
 * that transaction commits, so concurrent submissions queue for the next number.
 */
export async function nextPaperRef(tx, { prefix, year }) {
  if (!REF_PREFIXES.includes(prefix)) throw new Error(`nextPaperRef: unknown prefix ${prefix}`);
  await tx.exec(
    `INSERT INTO \`${T.paperRefCounters}\` (prefix, year, last_number) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE last_number = last_number + 1`,
    [prefix, year],
  );
  const row = await tx.one(
    `SELECT last_number FROM \`${T.paperRefCounters}\` WHERE prefix = ? AND year = ?`,
    [prefix, year],
  );
  return formatRef(prefix, year, Number(row.last_number));
}

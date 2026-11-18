// Unit tests for lib/paperRef.mjs (no database): prefix, year, format, and the
// counter SQL against an in-memory fake transaction.
import { refPrefix, refYear, formatRef, nextPaperRef, REF_PATTERN } from "../lib/paperRef.mjs";

let fails = 0;
const check = (name, ok) => { console.log(`${ok ? "✓" : "✗"} ${name}`); if (!ok) fails++; };

check("external AUTHOR → AIDC (even with a school)", refPrefix({ baseType: "AUTHOR", schoolCode: "ISDI" }) === "AIDC");
check("ISDI school → ISDI", refPrefix({ baseType: "STUDENT", schoolCode: "ISDI" }) === "ISDI");
check("ISME school → ISME", refPrefix({ baseType: "FACULTY", schoolCode: "ISME" }) === "ISME");
check("uGDX school → UGDX", refPrefix({ baseType: "STUDENT", schoolCode: "uGDX" }) === "UGDX");
check("LAW school → LAW", refPrefix({ baseType: "STUDENT", schoolCode: "LAW" }) === "LAW");
check("no school → GEN", refPrefix({ baseType: "STUDENT", schoolCode: "" }) === "GEN");
check("unknown school / deleted submitter → GEN", refPrefix({ baseType: null, schoolCode: "XYZ" }) === "GEN");

check("year uses India time (31 Dec 19:00 UTC = 1 Jan IST)", refYear(new Date("2025-12-31T19:00:00Z")) === 2026);
check("year from DB ISO string", refYear("2026-03-04T10:00:00.000Z") === 2026);
check("format pads to 4 digits", formatRef("ISDI", 2026, 1) === "ISDI-2026-0001");
check("format grows past 9999", formatRef("GEN", 2026, 12345) === "GEN-2026-12345");
check("pattern accepts IDs", REF_PATTERN.test("AIDC-2026-0042") && !REF_PATTERN.test("isdi-2026-1"));

// Fake tx: emulates the upsert + select on research_paper_ref_counters.
const counters = new Map();
const tx = {
  async exec(sql, [prefix, year]) { const k = `${prefix}:${year}`; counters.set(k, (counters.get(k) || 0) + 1); return { affectedRows: 1 }; },
  async one(sql, [prefix, year]) { return { last_number: counters.get(`${prefix}:${year}`) }; },
};
const a = await nextPaperRef(tx, { prefix: "ISDI", year: 2026 });
const b = await nextPaperRef(tx, { prefix: "ISDI", year: 2026 });
const c = await nextPaperRef(tx, { prefix: "AIDC", year: 2026 });
const d = await nextPaperRef(tx, { prefix: "ISDI", year: 2027 });
check("numbers run per prefix", a === "ISDI-2026-0001" && b === "ISDI-2026-0002" && c === "AIDC-2026-0001");
check("each new year starts again at 0001", d === "ISDI-2027-0001");
let threw = false; try { await nextPaperRef(tx, { prefix: "BAD", year: 2026 }); } catch { threw = true; }
check("unknown prefix refused", threw);

if (fails) { console.error(`\n${fails} failure(s)`); process.exit(1); }
console.log("\nAll paper-ref tests passed.");

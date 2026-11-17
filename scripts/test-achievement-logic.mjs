/**
 * No-network, no-DB unit tests of the Faculty Achievements rules
 * (lib/achievementTypes.js): per-type validation, "Other" handling, date and
 * amount rules, file-slot counts, rupee formatting, academic years and the
 * CSV export (incl. formula-injection guard).
 * Run: node scripts/test-achievement-logic.mjs
 */
import {
  ACHIEVEMENT_TYPES, ACHIEVEMENT_TYPE_KEYS, validateAchievement, validateFileCounts, detailPairs,
  parseIsoDate, parseAmount, formatInr, formatDate, academicYearOf, academicYearRange, recentAcademicYears, achievementsCsv,
} from "../lib/achievementTypes.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const today = "2026-11-17";
const v = (type, input) => validateAchievement(type, input, { today });

console.log("\n=== Faculty achievements unit tests ===\n");

console.log("Type definitions:");
check("five types", ACHIEVEMENT_TYPE_KEYS.length === 5);
for (const k of ACHIEVEMENT_TYPE_KEYS) {
  const d = ACHIEVEMENT_TYPES[k];
  check(`${k}: has exactly one title column and one date column`, d.fields.filter((f) => f.column === "title").length === 1 && d.fields.filter((f) => f.column === "date").length === 1);
  check(`${k}: has at least one file slot`, d.files.length >= 1);
  check(`${k}: field keys unique`, new Set(d.fields.map((f) => f.key)).size === d.fields.length);
}

console.log("\nProfessional:");
let r = v("PROFESSIONAL", { school: "ISDI", affiliation: "YES", values: { role: "Reviewer for Journal", date: "2026-09-12" } });
check("valid entry accepted", r.ok, JSON.stringify(r.issues || ""));
check("title = role", r.ok && r.data.title === "Reviewer for Journal");
check("date column set", r.ok && r.data.achievementDate === "2026-09-12");
check("amount null", r.ok && r.data.amountInr === null);
r = v("PROFESSIONAL", { school: "ISDI", affiliation: "YES", values: { role: "Other", date: "2026-09-12" } });
check("Other without text → issue on role_other", !r.ok && r.issues.role_other);
r = v("PROFESSIONAL", { school: "ISDI", affiliation: "YES", values: { role: "Other", role_other: "Jury, Design Awards", date: "2026-09-12" } });
check("Other with text → title is the text", r.ok && r.data.title === "Jury, Design Awards");
r = v("PROFESSIONAL", { school: "XYZ", affiliation: "MAYBE", values: { role: "Hacker", date: "2030-01-01" } });
check("bad school/affiliation/option/future date all flagged", !r.ok && r.issues.school && r.issues.affiliation && r.issues.role && r.issues.date);
r = v("PROFESSIONAL", { school: "ISDI", affiliation: "YES", values: { role: "Board Member", date: "2026-02-30" } });
check("impossible date rejected", !r.ok && r.issues.date);
r = v("PROFESSIONAL", { school: "ISDI", affiliation: "JOINT", values: { role: "Board Member", date: "2026-02-03" } });
check("JOINT not allowed outside grants", !r.ok && r.issues.affiliation);

console.log("\nConsultancy:");
r = v("CONSULTANCY", { school: "ISME", values: { organisation: "Tata Motors", start_date: "2026-03-01", end_date: "2026-03-18", amount: "1,50,000" } });
check("valid entry, amount with Indian commas parsed", r.ok && r.data.amountInr === 150000, JSON.stringify(r.issues || ""));
check("no affiliation asked → null", r.ok && r.data.affiliation === null);
r = v("CONSULTANCY", { school: "ISME", values: { organisation: "X", start_date: "2026-03-18", end_date: "2026-03-01", amount: "10" } });
check("end before start rejected", !r.ok && r.issues.end_date);
r = v("CONSULTANCY", { school: "ISME", values: { organisation: "X", start_date: "2026-03-01", end_date: "2026-03-02", amount: "-5" } });
check("negative amount rejected", !r.ok && r.issues.amount);

console.log("\nGrant:");
const grant = {
  project_title: "Low-cost assistive wearables", funding_agency: "DST", agency_type: "Central Government", nature: "Research Project Grant",
  amount_sanctioned: "1200000", amount_received: "400000", sanction_date: "2026-07-01", start_date: "2026-08-01", end_date: "2028-07-31",
  role: "Principal Investigator (PI)", co_investigators: "Dr. A\nDr. B",
};
r = v("GRANT", { school: "uGDX", affiliation: "JOINT", values: grant });
check("valid grant (future end date allowed)", r.ok, JSON.stringify(r.issues || ""));
check("amount column = sanctioned", r.ok && r.data.amountInr === 1200000);
check("multi-line co-investigators kept", r.ok && r.data.details.co_investigators === "Dr. A\nDr. B");
r = v("GRANT", { school: "uGDX", affiliation: "YES", values: { ...grant, amount_received: "1300000" } });
check("received > sanctioned rejected", !r.ok && r.issues.amount_received);
r = v("GRANT", { school: "uGDX", affiliation: "YES", values: { ...grant, sanction_date: "2027-01-01" } });
check("future sanction date rejected", !r.ok && r.issues.sanction_date);

console.log("\nAward:");
r = v("AWARD", { school: "LAW", affiliation: "NO", values: { awardee_name: "R. Shah", awardee_type: "Student", award_title: "Best Paper", awarded_by: "ICDI", category: "Best paper", date: "2026-10-02", supporting_link: "javascript:alert(1)" } });
check("non-http link rejected", !r.ok && r.issues.supporting_link);
r = v("AWARD", { school: "LAW", affiliation: "NO", values: { awardee_name: "R. Shah", awardee_type: "Student", award_title: "Best Paper", awarded_by: "ICDI", category: "Best paper", date: "2026-10-02", supporting_link: "https://example.org/x" } });
check("valid award", r.ok, JSON.stringify(r.issues || ""));
r = v("FELLOWSHIP", { school: "ISDI", affiliation: "YES", values: { award_name: "x".repeat(301), agency: "A", date: "2026-01-01" } });
check("over-long text rejected", !r.ok && r.issues.award_name);
check("unknown type rejected", !validateAchievement("NOPE", {}).ok);

console.log("\nFile slots:");
check("missing file flagged", validateFileCounts("PROFESSIONAL", {}).file_proof);
check("one file fine", Object.keys(validateFileCounts("PROFESSIONAL", { proof: 1 })).length === 0);
check("two files in a 1-file slot flagged", !!validateFileCounts("PROFESSIONAL", { proof: 2 }).file_proof);
check("5 certificates fine, 6 flagged", !Object.keys(validateFileCounts("FELLOWSHIP", { certificates: 5 })).length && !!validateFileCounts("FELLOWSHIP", { certificates: 6 }).file_certificates);
check("consultancy needs both letters", !!validateFileCounts("CONSULTANCY", { corporate_letter: 1 }).file_beneficiary_letter);
check("unknown slot flagged", !!validateFileCounts("PROFESSIONAL", { proof: 1, other: 1 }).file_other);

console.log("\nHelpers:");
const pairs0 = () => detailPairs("PROFESSIONAL", { role: "Board Member", date: "2026-09-12" });
check("parseIsoDate leap day", parseIsoDate("2028-02-29") === "2028-02-29" && parseIsoDate("2027-02-29") === null);
check("parseAmount", parseAmount("₹ 12,00,000.50") === 1200000.5 && parseAmount("1e5") === null && parseAmount("1.234") === null);
check("formatInr lakh grouping", formatInr(1200000) === "₹12,00,000" && formatInr(150000) === "₹1,50,000" && formatInr(999) === "₹999" && formatInr(1234.5) === "₹1,234.50");
check("formatDate", formatDate("2026-10-04") === "04 Oct 2026" && pairs0().find((p) => p.key === "date")?.value === "12 Sep 2026");
check("academicYearOf", academicYearOf("2026-08-15") === "2026-27" && academicYearOf("2026-06-30") === "2025-26" && academicYearOf("2026-07-01") === "2026-27");
check("academicYearOf 1999-00", academicYearOf("1999-08-01") === "1999-00");
const range = academicYearRange("2026-27");
check("academicYearRange", range && range.from === "2026-07-01" && range.to === "2027-06-30");
check("academicYearRange rejects mismatch", academicYearRange("2026-28") === null && academicYearRange("x") === null);
check("recentAcademicYears", recentAcademicYears(3, today).join(",") === "2026-27,2025-26,2024-25");
const pairs = detailPairs("GRANT", { ...grant, amount_sanctioned: 1200000, role: "Other", role_other: "Mentor" });
check("detailPairs formats money and resolves Other", pairs.find((p) => p.key === "amount_sanctioned")?.value === "₹12,00,000" && pairs.find((p) => p.key === "role")?.value === "Mentor");

console.log("\nCSV export:");
const row = {
  type: "PROFESSIONAL", ownerName: "=HYPERLINK(\"x\")", ownerEmail: "a@b.c", school: "LAW", title: "Reviewer, \"Journal\"",
  achievementDate: "2026-09-12", amountInr: null, affiliation: "YES", status: "VERIFIED", createdAt: "2026-09-13T00:00:00Z",
  details: { role: "Reviewer for Journal", date: "2026-09-12" }, files: [{ name: "proof.pdf" }],
};
const csv = achievementsCsv([row]);
const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
check("starts with UTF-8 BOM", csv.startsWith("﻿"));
check("single type → type-specific columns", lines[0].includes("Achievement as") && !lines[0].includes(",Details,"));
check("formula injection neutralised", lines[1].includes(`"'=HYPERLINK(""x"")"`));
check("quotes and commas escaped", lines[1].includes(`"Reviewer, ""Journal"""`));
check("school label + academic year", lines[1].includes(",Law,") && lines[1].includes(",2026-27,"));
const mixed = achievementsCsv([row, { ...row, type: "CONSULTANCY", details: { organisation: "Tata" }, amountInr: 150000 }]);
check("mixed types → one Details column", mixed.split("\r\n")[0].includes(",Details,"));

console.log(failures ? `\n✗ ${failures} failure(s)\n` : "\n✓ all achievement logic tests passed\n");
process.exit(failures ? 1 : 0);

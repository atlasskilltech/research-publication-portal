// Faculty Achievements — the five record types that replace the Google Forms
// (Professional Achievements, Fellowship / Financial Support, Research /
// Innovation Awards, Consultancy / Corporate Training, External Grants).
//
// This file is the ONE place the forms are defined. The add-form UI renders
// from it and the API validates against it, so to add a field or a whole new
// type you edit only this file. Pure: no I/O, no env, no framework imports
// (unit-tested by scripts/test-achievement-logic.mjs).
//
// Storage model (database/migrations/006_achievements.mjs): the fields every
// type shares (school, title, main date, amount, ATLAS affiliation) are real
// columns so they can be filtered and counted; everything type-specific goes
// into the `details` JSON column.

export const ACHIEVEMENT_SCHOOLS = ["ISME", "ISDI", "uGDX", "LAW"];
export const SCHOOL_LABEL = { ISME: "ISME", ISDI: "ISDI", uGDX: "uGDX", LAW: "Law" };

export const ACHIEVEMENT_STATUSES = ["SUBMITTED", "VERIFIED", "REJECTED"];
export const STATUS_LABEL = { SUBMITTED: "Awaiting check", VERIFIED: "Verified", REJECTED: "Rejected" };

/** Per-file size cap and the most files any one slot accepts. */
export const ACH_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACH_MAX_FILES_PER_SLOT = 5;

const YES_NO = [
  { value: "YES", label: "Yes" },
  { value: "NO", label: "No" },
];
const AFFILIATION_Q = "Were you affiliated with ATLAS SkillTech University at this time?";
const OTHER = "Other";

/**
 * Field kinds: text | textarea | date | number | select | url.
 *  - `column`: which shared column the value fills ("title" | "date" | "amount");
 *    every other field is stored in `details`.
 *  - select + `other: true`: choosing "Other" requires the companion text field
 *    `<key>_other`, which is what gets displayed.
 *  - `prefill: "name"`: the form pre-fills the signed-in user's name.
 */
export const ACHIEVEMENT_TYPES = {
  PROFESSIONAL: {
    key: "PROFESSIONAL",
    name: "Professional Achievement",
    short: "Professional",
    description: "Reviewer, session chair, board member, speaker, editorial or paper-setter role.",
    fields: [
      {
        key: "role", label: "Achievement as", kind: "select", required: true, column: "title", other: true, full: true,
        options: [
          "Reviewer for Conference",
          "Conference Session Chair",
          "Board Member",
          "Board of Studies",
          "Member of a professional body",
          "Reviewer for Journal",
          "Paper Setter for a recognized University",
          "Chief Guest for a Ceremony at any School / College / University",
          "Editorial Member",
          "Speaker at a recognized platform",
          "Publication in Newspaper, Magazine or any other similar category",
          OTHER,
        ],
      },
      { key: "organisation", label: "Conference / journal / organisation name", kind: "text", required: false, full: true, hint: "Optional, but it helps the team verify the proof." },
      { key: "date", label: "Date", kind: "date", required: true, column: "date" },
    ],
    affiliation: { label: AFFILIATION_Q, options: YES_NO },
    files: [{ slot: "proof", label: "Attach proof", max: 1, types: ["pdf"] }],
  },

  FELLOWSHIP: {
    key: "FELLOWSHIP",
    name: "Fellowship / Financial Support",
    short: "Fellowship",
    description: "National or international fellowship or financial support for advanced studies, research, travel or teaching.",
    fields: [
      { key: "award_name", label: "Name / nature of the award or fellowship", kind: "text", required: true, column: "title", full: true },
      { key: "agency", label: "Awarding agency", kind: "text", required: true },
      { key: "date", label: "Date of the award", kind: "date", required: true, column: "date" },
    ],
    affiliation: { label: AFFILIATION_Q, options: YES_NO },
    files: [{ slot: "certificates", label: "Certificates / award letter", max: 5, types: ["pdf"] }],
  },

  AWARD: {
    key: "AWARD",
    name: "Research / Innovation Award",
    short: "Award",
    description: "Awards for research or innovation received by faculty, research scholars or students while at ATLAS.",
    fields: [
      { key: "awardee_name", label: "Name of the faculty / student who received the award", kind: "text", required: true, prefill: "name" },
      { key: "awardee_type", label: "Award received by", kind: "select", required: true, options: ["Faculty", "Research Scholar", "Student"] },
      { key: "award_title", label: "Title of award", kind: "text", required: true, column: "title" },
      { key: "awarded_by", label: "Awarded by", kind: "text", required: true },
      {
        key: "category", label: "Category of award", kind: "select", required: true, other: true,
        options: ["Innovation", "Technology transfer", "Research", "Best paper", OTHER],
      },
      { key: "date", label: "Date the award was received", kind: "date", required: true, column: "date" },
      { key: "supporting_link", label: "Link to any other supporting document", kind: "url", required: true, full: true, hint: "A Google Drive, website or news link." },
    ],
    affiliation: { label: AFFILIATION_Q, options: YES_NO },
    files: [{ slot: "award_letter", label: "Award letter / certificate issued by the awarding agency", max: 1, types: ["pdf"] }],
  },

  CONSULTANCY: {
    key: "CONSULTANCY",
    name: "Consultancy / Corporate Training",
    short: "Consultancy",
    description: "Revenue generated from consultancy or corporate training given to an organisation.",
    fields: [
      { key: "organisation", label: "Organisation the consultancy or training was provided to", kind: "text", required: true, column: "title", full: true },
      { key: "start_date", label: "Start date", kind: "date", required: true, column: "date" },
      { key: "end_date", label: "End date", kind: "date", required: true, notBefore: "start_date", allowFuture: true },
      { key: "amount", label: "Amount generated (₹ INR)", kind: "number", required: true, column: "amount" },
    ],
    affiliation: null,
    files: [
      { slot: "corporate_letter", label: "Letter from the corporate where training was imparted, with the fee paid", max: 1, types: ["pdf", "docx", "doc"] },
      { slot: "beneficiary_letter", label: "Letter from the beneficiary of the consultancy, with the consultancy fee", max: 1, types: ["pdf", "docx", "doc"] },
    ],
  },

  GRANT: {
    key: "GRANT",
    name: "External Grant / Funding",
    short: "Grant",
    description: "Research project grants from government, international, industry or NGO funding agencies.",
    fields: [
      { key: "project_title", label: "Title of the research project / grant", kind: "text", required: true, column: "title", full: true },
      { key: "funding_agency", label: "Name of the funding agency / organisation", kind: "text", required: true, full: true },
      {
        key: "agency_type", label: "Type of funding agency", kind: "select", required: true, other: true,
        options: ["Central Government", "State Government", "International Government Agency", "International Organisation / Foundation", "Industry / Corporate", "NGO / Trust / Other Institution", OTHER],
      },
      {
        key: "nature", label: "Nature of funding", kind: "select", required: true, other: true,
        options: ["Research Project Grant", "Consultancy / Industry Sponsored Research", "Institutional Research Grant from an External Agency", "International Research Grant", OTHER],
      },
      { key: "amount_sanctioned", label: "Total grant amount sanctioned (₹)", kind: "number", required: true, column: "amount" },
      { key: "amount_received", label: "Amount received / disbursed to date (₹)", kind: "number", required: true, notAbove: "amount_sanctioned" },
      { key: "sanction_date", label: "Date of sanction / award", kind: "date", required: true, column: "date" },
      { key: "start_date", label: "Project start date", kind: "date", required: true, allowFuture: true },
      { key: "end_date", label: "Project end / expected completion date", kind: "date", required: true, notBefore: "start_date", allowFuture: true },
      {
        key: "role", label: "Your role in the project", kind: "select", required: true, other: true,
        options: ["Principal Investigator (PI)", "Co-Principal Investigator (Co-PI)", "Co-Investigator", "Collaborating Researcher", OTHER],
      },
      { key: "co_investigators", label: "Names of co-investigators / collaborating faculty", kind: "textarea", required: true, full: true, hint: "Write “None” if there are none.", max: 1000 },
    ],
    affiliation: {
      label: "Was the grant awarded to ATLAS SkillTech University?",
      options: [
        { value: "YES", label: "Yes" },
        { value: "NO", label: "No, awarded to another institution" },
        { value: "JOINT", label: "Jointly awarded to multiple institutions" },
      ],
    },
    files: [{ slot: "sanction_letter", label: "Grant sanction letter / supporting documents", max: 5, types: ["pdf", "docx", "doc"] }],
  },
};

export const ACHIEVEMENT_TYPE_KEYS = Object.keys(ACHIEVEMENT_TYPES);

export const AFFILIATION_LABEL = { YES: "Yes", NO: "No", JOINT: "Joint" };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_YEAR = 1980;
const MAX_YEAR = 2100;

/** "YYYY-MM-DD" that is a real calendar date → the same string, else null. */
export function parseIsoDate(v) {
  const m = DATE_RE.exec(String(v ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_YEAR || y > MAX_YEAR) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Non-negative rupee amount with at most 2 decimals → Number, else null. */
export function parseAmount(v) {
  const s = String(v ?? "").replace(/[,\s₹]/g, "");
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) return null;
  return Number(s);
}

function cleanText(v) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}
function cleanMultiline(v) {
  return String(v ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function isHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function optionValues(f) {
  return f.options.map((o) => (typeof o === "string" ? o : o.value));
}

/**
 * Validate one submission against its type's definition.
 *
 * @param {string} typeKey   one of ACHIEVEMENT_TYPE_KEYS
 * @param {{ school?: string, affiliation?: string, values?: Record<string, unknown> }} input
 * @param {{ today?: string }} [opts]  today's date "YYYY-MM-DD" (for the not-in-future rule)
 * @returns {{ ok: true, data: { type, school, title, achievementDate, amountInr, affiliation, details } }
 *          | { ok: false, issues: Record<string, string> }}
 */
export function validateAchievement(typeKey, input = {}, opts = {}) {
  const def = ACHIEVEMENT_TYPES[typeKey];
  if (!def) return { ok: false, issues: { type: "Choose a valid achievement type." } };
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const values = input.values && typeof input.values === "object" ? input.values : {};
  const issues = {};
  const details = {};
  const out = { type: def.key, school: null, title: null, achievementDate: null, amountInr: null, affiliation: null };

  // School
  const school = cleanText(input.school);
  if (!ACHIEVEMENT_SCHOOLS.includes(school)) issues.school = "Choose your school.";
  else out.school = school;

  // ATLAS affiliation
  if (def.affiliation) {
    const a = cleanText(input.affiliation);
    if (!def.affiliation.options.some((o) => o.value === a)) issues.affiliation = "Choose an answer.";
    else out.affiliation = a;
  }

  // Type-specific fields
  for (const f of def.fields) {
    const raw = values[f.key];
    const empty = raw == null || String(raw).trim() === "";
    if (empty) {
      if (f.required) issues[f.key] = "This field is required.";
      continue;
    }
    let val;
    switch (f.kind) {
      case "text":
      case "url":
      case "textarea": {
        val = f.kind === "textarea" ? cleanMultiline(raw) : cleanText(raw);
        const max = f.max || (f.kind === "url" ? 1000 : 300);
        if (val.length > max) { issues[f.key] = `Keep this under ${max} characters.`; continue; }
        if (f.kind === "url" && !isHttpUrl(val)) { issues[f.key] = "Enter a full link starting with https://"; continue; }
        break;
      }
      case "date": {
        val = parseIsoDate(raw);
        if (!val) { issues[f.key] = "Enter a valid date."; continue; }
        if (!f.allowFuture && val > today) { issues[f.key] = "This date can't be in the future."; continue; }
        break;
      }
      case "number": {
        val = parseAmount(raw);
        if (val == null) { issues[f.key] = "Enter an amount in rupees, e.g. 150000."; continue; }
        break;
      }
      case "select": {
        val = cleanText(raw);
        if (!optionValues(f).includes(val)) { issues[f.key] = "Choose one of the options."; continue; }
        if (f.other && val === OTHER) {
          const other = cleanText(values[`${f.key}_other`]);
          if (!other) { issues[`${f.key}_other`] = "Please describe “Other”."; continue; }
          if (other.length > 200) { issues[`${f.key}_other`] = "Keep this under 200 characters."; continue; }
          details[`${f.key}_other`] = other;
        }
        break;
      }
      default:
        continue;
    }
    details[f.key] = val;
  }

  // Cross-field rules
  for (const f of def.fields) {
    if (f.notBefore && details[f.key] && details[f.notBefore] && details[f.key] < details[f.notBefore]) {
      issues[f.key] = "This can't be before the start date.";
    }
    if (f.notAbove && details[f.key] != null && details[f.notAbove] != null && details[f.key] > details[f.notAbove]) {
      issues[f.key] = "This can't be more than the sanctioned amount.";
    }
  }

  if (Object.keys(issues).length) return { ok: false, issues };

  // Shared columns
  for (const f of def.fields) {
    if (!f.column || details[f.key] == null) continue;
    if (f.column === "title") out.title = displayValue(f, details).slice(0, 300);
    if (f.column === "date") out.achievementDate = details[f.key];
    if (f.column === "amount") out.amountInr = details[f.key];
  }
  return { ok: true, data: { ...out, details } };
}

/** The value to show for a field (the "Other" text when "Other" was chosen). */
export function displayValue(field, details) {
  const v = details?.[field.key];
  if (v == null || v === "") return "";
  if (field.other && v === OTHER && details[`${field.key}_other`]) return String(details[`${field.key}_other`]);
  return String(v);
}

/** Label/value pairs for a stored record's type-specific details (for detail views and exports). */
export function detailPairs(typeKey, details) {
  const def = ACHIEVEMENT_TYPES[typeKey];
  if (!def) return [];
  return def.fields
    .map((f) => {
      let value = displayValue(f, details);
      if (value && f.kind === "number") value = formatInr(Number(value));
      if (value && f.kind === "date") value = formatDate(value);
      return { key: f.key, label: f.label, value };
    })
    .filter((p) => p.value !== "");
}

/**
 * Check the uploaded files' counts per slot (types/sizes are checked per file
 * by the API with the shared upload validator).
 * @param {string} typeKey
 * @param {Record<string, number>} counts slot → number of files received
 * @returns {Record<string, string>} issues (empty when fine)
 */
export function validateFileCounts(typeKey, counts = {}) {
  const def = ACHIEVEMENT_TYPES[typeKey];
  const issues = {};
  if (!def) return { type: "Choose a valid achievement type." };
  for (const s of def.files) {
    const n = Number(counts[s.slot] || 0);
    if (n < 1) issues[`file_${s.slot}`] = "Attach this document.";
    else if (n > s.max) issues[`file_${s.slot}`] = s.max === 1 ? "Attach only one file here." : `Attach at most ${s.max} files here.`;
  }
  for (const slot of Object.keys(counts)) {
    if (!def.files.some((s) => s.slot === slot) && counts[slot] > 0) issues[`file_${slot}`] = "Unexpected file.";
  }
  return issues;
}

/** Human file-type hint for a slot, e.g. "PDF, max 10 MB". */
export function fileHint(slot) {
  const kinds = slot.types.map((t) => t.toUpperCase()).join(" / ");
  const n = slot.max === 1 ? "1 file" : `Up to ${slot.max} files`;
  return `${n}: ${kinds}, max ${ACH_MAX_FILE_BYTES / (1024 * 1024)} MB each`;
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-04" → "04 Oct 2026" (no locale or time-zone dependence). */
export function formatDate(iso) {
  const d = parseIsoDate(iso);
  if (!d) return String(iso ?? "");
  return `${d.slice(8, 10)} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}

/** Indian rupee formatting with lakh/crore grouping: 1200000 → "₹12,00,000". */
export function formatInr(n) {
  if (n == null || !Number.isFinite(Number(n))) return "";
  const num = Number(n);
  const [int, dec] = Math.abs(num).toFixed(2).split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  const grouped = rest ? `${rest},${last3}` : last3;
  return `${num < 0 ? "-" : ""}₹${grouped}${dec !== "00" ? `.${dec}` : ""}`;
}

/**
 * Academic year (NAAC / AQAR convention, 1 July – 30 June).
 * academicYearOf("2026-08-15") → "2026-27"; academicYearOf("2026-03-01") → "2025-26".
 */
export function academicYearOf(isoDate) {
  const d = parseIsoDate(isoDate);
  if (!d) return null;
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "2026-27" → { from: "2026-07-01", to: "2027-06-30" }, else null. */
export function academicYearRange(label) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(label || ""));
  if (!m) return null;
  const start = Number(m[1]);
  if (start < MIN_YEAR || start >= MAX_YEAR) return null;
  if ((start + 1) % 100 !== Number(m[2])) return null;
  return { from: `${start}-07-01`, to: `${start + 1}-06-30` };
}

/** The last `n` academic years, newest first, relative to `today`. */
export function recentAcademicYears(n = 6, today = new Date().toISOString().slice(0, 10)) {
  const cur = academicYearOf(today);
  const start = Number(cur.slice(0, 4));
  return Array.from({ length: n }, (_, i) => {
    const s = start - i;
    return `${s}-${String((s + 1) % 100).padStart(2, "0")}`;
  });
}

function csvCell(v) {
  let s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection (=, +, -, @, tab, CR at the start).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV (opens directly in Excel) of achievement rows.
 * When every row is one type, that type's fields get their own columns;
 * a mixed export puts the type-specific fields in one "Details" column.
 * Rows: { type, ownerName, ownerEmail, school, title, achievementDate, amountInr,
 *         affiliation, status, createdAt, details, files: [{ name }] }
 */
export function achievementsCsv(rows) {
  const types = [...new Set(rows.map((r) => r.type))];
  const single = types.length === 1 ? ACHIEVEMENT_TYPES[types[0]] : null;
  const head = ["Type", "Name", "Email", "School", "Title", "Date", "Academic year", "Amount (INR)", "Affiliated with ATLAS", "Status", "Submitted on"];
  if (single) head.push(...single.fields.map((f) => f.label));
  else head.push("Details");
  head.push("Proof files");

  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) {
    const def = ACHIEVEMENT_TYPES[r.type];
    const cells = [
      def?.name || r.type,
      r.ownerName,
      r.ownerEmail,
      SCHOOL_LABEL[r.school] || r.school,
      r.title,
      r.achievementDate,
      academicYearOf(r.achievementDate) || "",
      r.amountInr == null ? "" : Number(r.amountInr),
      r.affiliation ? AFFILIATION_LABEL[r.affiliation] || r.affiliation : "",
      STATUS_LABEL[r.status] || r.status,
      r.createdAt ? String(r.createdAt).slice(0, 10) : "",
    ];
    if (single) {
      cells.push(...single.fields.map((f) => displayValue(f, r.details)));
    } else {
      cells.push(detailPairs(r.type, r.details).map((p) => `${p.label}: ${p.value}`).join("; "));
    }
    cells.push((r.files || []).map((f) => f.name).join("; "));
    lines.push(cells.map(csvCell).join(","));
  }
  // BOM so Excel reads UTF-8 (₹, accented names) correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

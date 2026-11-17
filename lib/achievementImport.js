// Import of the old Google-Forms achievement sheets into the portal — the PURE
// part (no I/O): turn the rows of each sheet into achievement records, clean up
// dates / amounts / schools, find the proof links, and match the people named
// on office-submitted entries to email addresses. scripts/import-achievements.mjs
// does the reading, the database writes and the file downloads.
//
// Unit-tested by scripts/test-achievement-import.mjs.
import crypto from "node:crypto";
import { normalizeOrcid } from "./achievementTypes.js";

/** Office mailboxes that submitted entries on behalf of other people. */
export const OFFICE_EMAILS = ["centreofexcellence@atlasuniversity.edu.in", "phd@atlasuniversity.edu.in"];
export const OFFICE_NAMES = {
  "centreofexcellence@atlasuniversity.edu.in": "Centre of Excellence (office)",
  "phd@atlasuniversity.edu.in": "PhD Office",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const EMPTY = new Set(["", "-", "--", ".", ",", "na", "n/a", "n.a.", "n.a", "nil", "none", "not applicable", "not available"]);

/** Trimmed single-line text, or null for blanks and "NA"-style answers. */
export function cleanText(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).replace(/\s+/g, " ").trim();
  return EMPTY.has(s.toLowerCase()) ? null : s;
}

/** Multi-line text kept as entered (blank lines collapsed). */
export function cleanMultiline(v) {
  if (v == null) return null;
  const s = String(v).replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return EMPTY.has(s.toLowerCase()) ? null : s;
}

const pad = (n) => String(n).padStart(2, "0");
const validYmd = (y, m, d) => {
  if (y < 1980 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/**
 * Read a date the way people typed it into the forms.
 * → { date: "YYYY-MM-DD", precision: "day" | "month" | "year" } | null
 * Accepts Date cells, a year (2023 / "2023"), "25/03/2022" (day first),
 * "2023-06-12", "March 25, 2023", "25 March 2023", "April 2026".
 */
export function parseFlexibleDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    const iso = validYmd(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
    return iso ? { date: iso, precision: "day" } : null;
  }
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 1980 && v <= 2100 ? { date: `${v}-01-01`, precision: "year" } : null;
  }
  const s = String(v).trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/\s+/g, " ");
  let m;
  if ((m = /^(\d{4})$/.exec(s))) return parseFlexibleDate(Number(m[1]));
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) {
    const iso = validYmd(+m[1], +m[2], +m[3]);
    return iso ? { date: iso, precision: "day" } : null;
  }
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) {
    const iso = validYmd(+m[3], +m[2], +m[1]);
    return iso ? { date: iso, precision: "day" } : null;
  }
  if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/.exec(s))) {
    const iso = validYmd(2000 + +m[3], +m[2], +m[1]);
    return iso ? { date: iso, precision: "day" } : null;
  }
  const mon = (w) => MONTHS.indexOf(String(w).slice(0, 3)) + 1;
  if ((m = /^([a-z]+)\.? (\d{1,2}),? (\d{4})$/.exec(s)) && mon(m[1]) > 0) {
    const iso = validYmd(+m[3], mon(m[1]), +m[2]);
    return iso ? { date: iso, precision: "day" } : null;
  }
  if ((m = /^(\d{1,2}) ([a-z]+)\.?,? (\d{4})$/.exec(s)) && mon(m[2]) > 0) {
    const iso = validYmd(+m[3], mon(m[2]), +m[1]);
    return iso ? { date: iso, precision: "day" } : null;
  }
  if ((m = /^([a-z]+)\.?,? (\d{4})$/.exec(s)) && mon(m[1]) > 0) {
    const iso = validYmd(+m[2], mon(m[1]), 1);
    return iso ? { date: iso, precision: "month" } : null;
  }
  return null;
}

/**
 * Rupee amount from text like "3,50,000 (Three Lakh Fifty Thousand Only)" or
 * "₹ 12,00,000". Text that isn't a plain amount ("10 % of the fees") → null.
 */
export function parseAmountText(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  const s = String(v).trim();
  if (/%/.test(s)) return null;
  const m = /^(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)(?:\s*\/-)?(?:\s*\(.*\))?\s*(?:only)?$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 && n < 1e12 ? n : null;
}

/** "UGDx", "uGDX School of Technology", "ISME - School of …", "Law" → portal school code. */
export function mapSchool(v) {
  const s = String(v ?? "").toLowerCase();
  if (!s.trim()) return null;
  if (/\bugdx\b|ugdx/.test(s)) return "uGDX";
  if (/\bisme\b/.test(s)) return "ISME";
  if (/\bisdi\b/.test(s)) return "ISDI";
  if (/\blaw\b/.test(s)) return "LAW";
  return null;
}

/** "Yes" → YES, "No…" → NO, "Jointly…" → JOINT, otherwise null. */
export function mapAffiliation(v) {
  const s = String(v ?? "").trim().toLowerCase();
  if (s.startsWith("yes")) return "YES";
  if (s.startsWith("joint")) return "JOINT";
  if (s.startsWith("no")) return "NO";
  return null;
}

/** Every http(s) link in a cell (form uploads put several, comma-separated). */
export function extractUrls(v) {
  if (v == null) return [];
  return [...String(v).matchAll(/https?:\/\/[^\s,;<>"']+/gi)].map((m) => m[0].replace(/[).]+$/, ""));
}

/** Google Drive file id from an "open?id=", "/file/d/<id>/" or "uc?id=" link. */
export function driveFileId(url) {
  const m = /drive\.google\.com\/(?:open\?id=|file\/d\/|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]{20,})/.exec(String(url || ""));
  return m ? m[1] : null;
}

/** Google Sheets stores the form timestamp in the sheet's time zone (IST). */
export function istToUtc(d) {
  return d instanceof Date ? new Date(d.getTime() - 330 * 60 * 1000) : null;
}

// ---- Names ------------------------------------------------------------------------

const TITLES = /\b(dr|mr|mrs|ms|miss|prof|ar|adv|er)\b\.?/gi;
/** Tokens of a person's name without titles or punctuation: "Dr. S.K. Singh" → ["s","k","singh"]. */
export function nameTokens(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(TITLES, " ")
    .replace(/[^a-z\s.]/g, " ")
    .replace(/\./g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const NOT_A_PERSON = /\b(atlas|university|skilltech|ceremony|appreciation|gratitude|honou?r|institute|college|school|committee|team|pvt|ltd)\b/i;

/**
 * Split a "names" cell into people:
 * "1.ATLAS SKILLTECH UNIVERSITY 2. AARIYA SHAH 3.JAI RANJIT" → ["AARIYA SHAH", "JAI RANJIT"].
 */
export function splitNames(cell) {
  return String(cell ?? "")
    .split(/,|;|&|\n|\band\b|\s\d+\s*[.)]\s*|^\d+\s*[.)]\s*/i)
    .map((s) => s.replace(/^\s*\d+\s*[.)]\s*/, "").replace(/\s+/g, " ").trim())
    .filter((s) => s && /[a-z]/i.test(s) && !NOT_A_PERSON.test(s) && nameTokens(s).length >= 1);
}

/** Tidy display name: "AGNIJIT TARAFDAR" → "Agnijit Tarafdar" (mixed case is kept). */
export function displayName(s) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t !== t.toUpperCase()) return t;
  return t.toLowerCase().replace(/(^|[\s.-])([a-z])/g, (m, p, c) => p + c.toUpperCase());
}

/**
 * Name → email index. add() takes a name as written and an email; match()
 * accepts the same name, or the same first + last name ("Dr. Varsha Agarwal" ≈
 * "Varsha Agarwal"; "Jay S Mehta" ≈ "Jay Mehta"). Ambiguous first+last matches
 * (two different emails) return null rather than guessing.
 */
export function createNameIndex() {
  const exact = new Map();
  const firstLast = new Map();
  const key = (t) => t.join(" ");
  return {
    add(name, email) {
      const t = nameTokens(name);
      if (!t.length || !email) return;
      const e = String(email).trim().toLowerCase();
      exact.set(key(t), e);
      if (t.length >= 2) {
        const fl = `${t[0]} ${t[t.length - 1]}`;
        const prev = firstLast.get(fl);
        firstLast.set(fl, prev && prev !== e ? "__ambiguous__" : e);
      }
    },
    match(name) {
      const t = nameTokens(name);
      if (!t.length) return null;
      if (exact.has(key(t))) return exact.get(key(t));
      if (t.length >= 2) {
        const hit = firstLast.get(`${t[0]} ${t[t.length - 1]}`);
        if (hit && hit !== "__ambiguous__") return hit;
      }
      return null;
    },
  };
}

// ---- Sheets ---------------------------------------------------------------------

const H = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * How each sheet maps to the portal. `col` values are header fragments
 * (lower-case "contains" match on the sheet's header row).
 *   fields: details key → header fragment (cleaned text)
 *   multiline: details keys kept multi-line
 *   title / date / amount / school / affiliation / name: special columns
 *   files: proof column → file slot (links become Drive links / downloads)
 *   names: column listing the people (contributors on office entries)
 */
export const SHEETS = [
  {
    match: "research papers", type: "PAPER",
    title: "title of paper", date: "year of publication", school: "school you belong to", affiliation: "were you affiliated",
    names: "name of the author",
    fields: {
      authors: "name of the author", authorship_position: "authorship position", department: "department of the faculty",
      journal: "name of journal", issn: "issn", journal_link: "link to website", article_link: "link to article",
      listing: "listing of journal", impact_factor: "impact factor", doi: "doi link",
    },
    multiline: ["authors"],
    files: { "upload published paper": "paper" },
  },
  {
    match: "books", type: "BOOK",
    title: "title of the book", date: "year of publication", school: "school you belong to", affiliation: "were you affiliated",
    names: "name of the author",
    fields: {
      authors: "name of the author", authorship_position: "authorship position", department: "department of the faculty",
      chapter_title: "title of the paper / chapter", isbn: "isbn", publisher: "name of the publisher", link: "link to book",
      listing: "listing of book", publication_type: "you have published a book",
    },
    multiline: ["authors"],
    files: { "upload published document": "proof" },
  },
  {
    match: "academic events attended", type: "EVENT_ATTENDED",
    date: "start date", school: "school you belong to", affiliation: "were you affiliated", name: "name of the faculty",
    fields: {
      program_type: "type of program", organizer: "organizing body", mode: "mode of attending",
      start_date: "start date", end_date: "end date", comments: "comments", duration_text: "duration",
    },
    multiline: ["comments"],
    titleFrom: (d) => [d.program_type, d.organizer].filter(Boolean).join(" — ") || "Academic event",
    titleKey: "event_name",
    files: { "attach proof": "certificate" },
  },
  {
    match: "awards", type: "AWARD",
    title: "title of award", date: "date on which you received", school: "school you belong to", affiliation: "were you affiliated",
    names: "name of faculty / student",
    fields: {
      awardee_name: "name of faculty / student", awarded_by: "awarded by", category: "category of award",
      supporting_link: "link of any other",
    },
    files: { "attach e- copy": "award_letter" },
  },
  {
    match: "professional achievements", type: "PROFESSIONAL",
    title: "achievement as", date: "date", school: "school you belong to", affiliation: "were you affiliated", name: "name of faculty",
    fields: { role: "achievement as" },
    files: { "attach proof": "proof" },
  },
  {
    match: "patents", type: "PATENT",
    title: "title of patent", date: "date of award", school: "school you belong to", affiliation: "were you affiliated",
    names: "name of the faculty/student author",
    fields: {
      inventors: "name of the faculty/student author", application_no: "application number", status: "status of patent",
      agency: "awarding agency", ip_type: "details are filling", category: "category of patent",
    },
    multiline: ["inventors"],
    files: { "upload supporting documents": "documents" },
  },
  {
    match: "revenue from consultancy", type: "CONSULTANCY",
    title: "organization to which", amount: "amount generated", name: "name of the faculty consultant",
    fields: { duration_text: "dates/duration" },
    dateFromText: "dates/duration",
    files: { "letter from the corporate": "corporate_letter", "letter from the beneficiary": "beneficiary_letter" },
  },
  {
    match: "financial support", type: "FELLOWSHIP",
    title: "name / nature of the award", date: "year of the award", school: "school you belong to", affiliation: "were you affiliated",
    name: "name of the faculty awarded",
    fields: { agency: "awarding agency" },
    files: { "upload certificates": "certificates" },
  },
  {
    match: "additional qualifications", type: "QUALIFICATION",
    title: "description of additional qualification", date: "date", school: "school", name: "faculty name",
    fields: {},
    files: { "attach proof of qualification": "proof" },
  },
  {
    match: "events organized", type: "EVENT_ORGANIZED",
    title: "title of event", date: "event start date",
    fields: { partner: "collaborative partner", start_date: "event start date", end_date: "event end date", category: "category of event" },
    multiline: ["partner"],
    files: { "attach event flyer": "flyer", "attach event report": "report", "attach attendance": "attendance" },
  },
  {
    match: "funding", type: "GRANT",
    title: "title of the research project", date: "date of sanction", school: "school", affiliation: "was the grant awarded",
    amount: "total grant amount sanctioned", name: "faculty name",
    fields: {
      funding_agency: "name of the funding agency", agency_type: "type of funding agency", nature: "nature of funding",
      amount_received: "amount received", start_date: "project start date", end_date: "project end date",
      role: "your role in the project", co_investigators: "names of co-investigators",
    },
    multiline: ["co_investigators"],
    files: { "grant sanction letter": "sanction_letter" },
  },
  { match: "orcid", type: "ORCID" },
];

/** Which mapping applies to a sheet name (or null). */
export function sheetConfig(sheetName) {
  const n = H(sheetName);
  return SHEETS.find((s) => n.startsWith(s.match)) || null;
}

/** Index of the first header containing `fragment` (or -1). */
export function findCol(headers, fragment) {
  if (!fragment) return -1;
  const f = H(fragment);
  return headers.findIndex((h) => H(h).includes(f));
}

const DATE_KEYS = new Set(["start_date", "end_date", "sanction_date"]);
const AMOUNT_KEYS = new Set(["amount_received"]);

/**
 * Turn one sheet into records.
 * → { records: Record[], orcids: [{ email, name, orcid }], skipped: [{ row, reason }] }
 * Record: { sheet, row, type, ownerEmail, ownerName, office, school, title, achievementDate,
 *           amountInr, affiliation, details, links: [{ slot, url }], names: string[], createdAt, sourceKey }
 */
export function mapSheet(sheetName, rows) {
  const cfg = sheetConfig(sheetName);
  const out = { records: [], orcids: [], skipped: [] };
  if (!cfg) return out;
  const headerIdx = rows.findIndex((r) => r.some((c) => H(c) === "timestamp" || H(c) === "email address"));
  if (headerIdx < 0) return out;
  const headers = rows[headerIdx].map((c) => String(c ?? ""));
  const col = (frag) => findCol(headers, frag);
  const emailCol = col("email address");
  const tsCol = col("timestamp");

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    if (!r.some((c) => c != null && String(c).trim() !== "")) continue;
    const rowNo = i + 1;
    const get = (frag) => { const k = col(frag); return k >= 0 ? r[k] : null; };
    const email = String(r[emailCol] ?? "").trim().toLowerCase();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (cfg.type === "ORCID") {
      const orcid = normalizeOrcid(get("16 digit orcid")) || normalizeOrcid(get("orcid profile link"));
      if (!validEmail) { out.skipped.push({ row: rowNo, reason: "no email address" }); continue; }
      if (!orcid) { out.skipped.push({ row: rowNo, reason: "no valid ORCID iD" }); continue; }
      out.orcids.push({ email, name: cleanText(get("faculty name")), orcid, school: mapSchool(get("school")) });
      continue;
    }
    if (!validEmail) { out.skipped.push({ row: rowNo, reason: "no email address" }); continue; }

    const details = {};
    for (const [key, frag] of Object.entries(cfg.fields)) {
      const raw = get(frag);
      if (DATE_KEYS.has(key)) {
        const d = parseFlexibleDate(raw);
        if (d) details[key] = d.date;
        else if (cleanText(raw)) details[`${key}_text`] = cleanText(raw);
        continue;
      }
      if (AMOUNT_KEYS.has(key)) {
        const n = parseAmountText(raw);
        if (n != null) details[key] = n;
        continue;
      }
      const val = (cfg.multiline || []).includes(key) ? cleanMultiline(raw) : cleanText(raw);
      if (val != null) details[key] = key === "authorship_position" && Number(val) >= 6 ? "6 or later" : val;
    }

    // Title
    let title = cleanText(get(cfg.title));
    if (cfg.titleFrom) {
      title = cfg.titleFrom(details);
      if (cfg.titleKey) details[cfg.titleKey] = title;
    } else {
      // the title field's own key, so the detail view shows it
      const titleField = { PAPER: "paper_title", BOOK: "book_title", AWARD: "award_title", PATENT: "ip_title", CONSULTANCY: "organisation",
        FELLOWSHIP: "award_name", QUALIFICATION: "description", EVENT_ORGANIZED: "event_title", GRANT: "project_title" }[cfg.type];
      if (titleField && title) details[titleField] = title;
    }
    if (!title) title = "(no title given)";

    // Date
    let achievementDate = null;
    const dateRaw = cfg.date ? get(cfg.date) : cfg.dateFromText ? get(cfg.dateFromText) : null;
    const d = parseFlexibleDate(dateRaw);
    if (d) {
      achievementDate = d.date;
      if (d.precision !== "day") details.date_precision = d.precision;
      const dateField = { PROFESSIONAL: "date", AWARD: "date", PATENT: "date", QUALIFICATION: "date", FELLOWSHIP: "date",
        PAPER: "year", BOOK: "year", GRANT: "sanction_date" }[cfg.type];
      if (dateField) details[dateField] = dateField === "year" ? Number(d.date.slice(0, 4)) : d.date;
    } else if (cleanText(dateRaw) && !cfg.dateFromText) {
      details.date_text = cleanText(dateRaw);
      // "Volume 30, Issue 4 – Dec 2024", "2023-24" → keep the year when only one is named.
      const years = [...new Set([...String(dateRaw).matchAll(/(?<!\d)(19[89]\d|20\d{2})(?!\d)/g)].map((m) => m[1]))];
      if (years.length === 1 || /^(\d{4})\s*-\s*\d{2}$/.test(String(dateRaw).trim())) {
        achievementDate = `${years[0]}-01-01`;
        details.date_precision = "year";
        if (cfg.type === "PAPER" || cfg.type === "BOOK") details.year = Number(years[0]);
      }
    }

    // Amount
    let amountInr = null;
    if (cfg.amount) {
      const raw = get(cfg.amount);
      amountInr = parseAmountText(raw);
      if (amountInr == null && cleanText(raw)) details.amount_text = cleanText(raw);
      const amountField = { CONSULTANCY: "amount", GRANT: "amount_sanctioned" }[cfg.type];
      if (amountField && amountInr != null) details[amountField] = amountInr;
    }

    // School
    const schoolRaw = cfg.school ? get(cfg.school) : null;
    const school = mapSchool(schoolRaw);
    if (!school && cleanText(schoolRaw)) details.school_text = cleanText(schoolRaw);

    // Name as written (when it isn't already a field)
    if (cfg.name && cleanText(get(cfg.name))) details.submitted_by_name = cleanText(get(cfg.name));

    // Proof links
    const links = [];
    for (const [frag, slot] of Object.entries(cfg.files)) {
      for (const url of extractUrls(get(frag))) links.push({ slot, url });
    }

    const office = OFFICE_EMAILS.includes(email);
    const names = office && cfg.names ? splitNames(get(cfg.names)) : [];
    const ts = tsCol >= 0 && r[tsCol] instanceof Date ? istToUtc(r[tsCol]) : null;

    out.records.push({
      sheet: sheetName,
      row: rowNo,
      type: cfg.type,
      ownerEmail: email,
      ownerName: office ? OFFICE_NAMES[email] : cleanText(get(cfg.name || cfg.names || "name")),
      office,
      school,
      title: title.slice(0, 300),
      achievementDate,
      amountInr,
      affiliation: cfg.affiliation ? mapAffiliation(get(cfg.affiliation)) : null,
      details,
      links,
      names,
      createdAt: ts,
      sourceKey: sourceKeyFor(sheetName, r),
    });
  }
  return out;
}

/** Stable id of a source row (re-running the import skips rows already imported). */
export function sourceKeyFor(sheetName, row) {
  const norm = Array.from(row, (c) => (c instanceof Date ? c.toISOString() : c == null ? "" : String(c).trim()));
  while (norm.length && norm[norm.length - 1] === "") norm.pop();
  return crypto.createHash("sha256").update(`${H(sheetName)}\u0000${JSON.stringify(norm)}`).digest("hex");
}

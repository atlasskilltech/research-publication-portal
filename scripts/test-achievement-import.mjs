/**
 * No-network, no-DB unit tests of the Google-Forms import mapping
 * (lib/achievementImport.js) and the xlsx date conversion.
 * Run: node scripts/test-achievement-import.mjs
 */
import {
  parseFlexibleDate, parseAmountText, mapSchool, mapAffiliation, extractUrls, driveFileId, splitNames, displayName,
  createNameIndex, cleanText, mapSheet, sourceKeyFor, istToUtc,
} from "../lib/achievementImport.js";
import { excelSerialToDate, decodeXml } from "./lib/xlsx.mjs";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };
const pd = (v) => JSON.stringify(parseFlexibleDate(v));

console.log("\n=== Achievement import unit tests ===\n");

console.log("Dates:");
check("Date cell", pd(new Date(Date.UTC(2023, 2, 23))) === '{"date":"2023-03-23","precision":"day"}');
check("year number / string", pd(2023) === '{"date":"2023-01-01","precision":"year"}' && pd("2021") === '{"date":"2021-01-01","precision":"year"}');
check("25/03/2022 is day-first", pd("25/03/2022") === '{"date":"2022-03-25","precision":"day"}');
check("30/12/23 two-digit year", pd("30/12/23") === '{"date":"2023-12-30","precision":"day"}');
check("March 25, 2023", pd("March 25, 2023") === '{"date":"2023-03-25","precision":"day"}');
check("25th March 2023", pd("25th March 2023") === '{"date":"2023-03-25","precision":"day"}');
check("April 2026 → month", pd("April 2026") === '{"date":"2026-04-01","precision":"month"}');
check("ISO", pd("2023-06-12") === '{"date":"2023-06-12","precision":"day"}');
check("nonsense / impossible → null", parseFlexibleDate("1 year") === null && parseFlexibleDate("31/02/2023") === null && parseFlexibleDate("255-08-19") === null && parseFlexibleDate(new Date(Date.UTC(255, 7, 19))) === null);

console.log("\nAmounts, schools, answers:");
check("3,50,000 (Three Lakh…)", parseAmountText("3,50,000 (Three Lakh Fifty Thousand Only)") === 350000);
check("Rs. 5000/-", parseAmountText("Rs. 5000/-") === 5000);
check("percentage is not an amount", parseAmountText("10 % of the Professional fees") === null);
check("schools", mapSchool("UGDx") === "uGDX" && mapSchool("uGDX School of Technology") === "uGDX" && mapSchool("ISME - School of Management") === "ISME" && mapSchool("ISDI") === "ISDI" && mapSchool("Law") === "LAW" && mapSchool("DICE") === null);
check("affiliation", mapAffiliation("Yes") === "YES" && mapAffiliation("No; awarded to another institution") === "NO" && mapAffiliation("Jointly awarded") === "JOINT" && mapAffiliation("") === null);
check("NA-style answers are blank", cleanText("NA") === null && cleanText(" n/a ") === null && cleanText("-") === null && cleanText("Scopus") === "Scopus");

console.log("\nLinks and names:");
const urls = extractUrls("https://drive.google.com/open?id=1abcdefghijklmnopqrstuv, https://drive.google.com/open?id=2abcdefghijklmnopqrstuv");
check("several links in one cell", urls.length === 2);
check("drive id from open?id= and /file/d/", driveFileId(urls[0]) === "1abcdefghijklmnopqrstuv" && driveFileId("https://drive.google.com/file/d/1AYzm6DWabcdefghijklmn/view") === "1AYzm6DWabcdefghijklmn");
check("non-Drive link has no id", driveFileId("https://www.springer.com/journal/894") === null);
check("numbered list with the university first", JSON.stringify(splitNames("1.ATLAS SKILLTECH UNIVERSITY 2. AARIYA SHAH 3.AYUSHRI PUNAMIA 9.JAI RANJIT")) === '["AARIYA SHAH","AYUSHRI PUNAMIA","JAI RANJIT"]');
check("comma list", JSON.stringify(splitNames("ATLAS SKILLTECH UNIVERSITY, ISHA SAVANT, AGNIJIT TARAFDAR")) === '["ISHA SAVANT","AGNIJIT TARAFDAR"]');
check("'&' and 'and'", JSON.stringify(splitNames("Ishi Srivastava & Shalini Gupta and Ria Jain")) === '["Ishi Srivastava","Shalini Gupta","Ria Jain"]');
check("not-a-person entries dropped", splitNames("Guest of HONOR, Opening Bell Ceremony").length === 0 && splitNames("In Appreciation & Gratitude").length === 0);
check("display name of ALL CAPS", displayName("AGNIJIT TARAFDAR") === "Agnijit Tarafdar" && displayName("Dr. Zuleika Homavazir") === "Dr. Zuleika Homavazir");
const idx = createNameIndex();
idx.add("Dr. Varsha Agarwal", "varsha.agarwal@x.in");
idx.add("Jay Mehta", "jay.mehta@x.in");
idx.add("Nikhil Gupta", "a@x.in");
idx.add("Nikhil S Gupta", "b@x.in");
check("titles ignored", idx.match("Varsha Agarwal") === "varsha.agarwal@x.in" && idx.match("DR. VARSHA AGARWAL") === "varsha.agarwal@x.in");
check("middle initial tolerated", idx.match("Jay S Mehta") === "jay.mehta@x.in");
check("ambiguous first+last → no guess", idx.match("Nikhil K Gupta") === null);
check("unknown → null", idx.match("Aariya Shah") === null);

console.log("\nSheet mapping:");
const ts = new Date(Date.UTC(2024, 0, 24, 10, 1, 10));
const patents = mapSheet("Patents & Copyrights", [
  ["S.N.", "Timestamp", "Email Address", "Name of the Faculty/student author of the Patent / Copyright", "School you belong to", "Copyright / Patent Application Number ", "Date of Award / Filing / Publishing", "Status of Patent / Copyright", "Patent / Copyright Awarding Agency ", "Upload Supporting Documents", "Were you affiliated with ATLAS SkillTech University at this time?", "Title of Patent / Copyright", "Details  are filling for here...", "Category of Patent"],
  [1, ts, "centreofexcellence@atlasuniversity.edu.in", "ATLAS SKILLTECH UNIVERSITY, ISHA SAVANT, AGNIJIT TARAFDAR", "ISDI", "L-1/2023", new Date(Date.UTC(2023, 11, 11)), "Granted", "IP India", "https://drive.google.com/open?id=1pm0QngABCDEFGHIJKLMNOP", "Yes", "SPACE", "Copyright", ""],
  [2, ts, "", "X", "ISDI", "L-2", null, "Granted", "", "", "Yes", "No email row", "Patent", ""],
]);
const p = patents.records[0];
check("one record, one skipped (no email)", patents.records.length === 1 && patents.skipped.length === 1);
check("patent fields", p.type === "PATENT" && p.title === "SPACE" && p.details.ip_title === "SPACE" && p.details.application_no === "L-1/2023" && p.details.status === "Granted" && p.details.ip_type === "Copyright");
check("date + school + affiliation", p.achievementDate === "2023-12-11" && p.details.date === "2023-12-11" && p.school === "ISDI" && p.affiliation === "YES");
check("office entry → people named on it", p.office && JSON.stringify(p.names) === '["ISHA SAVANT","AGNIJIT TARAFDAR"]' && p.ownerName === "Centre of Excellence (office)");
check("proof link in the right slot", p.links.length === 1 && p.links[0].slot === "documents");
check("timestamp IST → UTC", p.createdAt.toISOString() === "2024-01-24T04:31:10.000Z" && istToUtc(null) === null);
const papers = mapSheet("Research Papers", [
  ["Timestamp", "Email Address", "\nName of the author/s ", "School you belong to", "Authorship Position", "\nTitle of paper ", "Department of the Faculty", "\nName of journal ", "\nYear of publication ", "\nISSN number ", "\nLink to website of the Journal ", "\nLink to article/paper/abstract of the article", "Listing of Journal", "Impact Factor of Paper If any", "Upload Published Paper", "doi link of paper if available...write NA if not available", "Were you affiliated with ATLAS SkillTech University at this time?"],
  [ts, "Thejus.Kartha@atlasuniversity.edu.in", "U. Abdulkareem, Thejus R Kartha", "UGDx", 7, "Radial distribution", "uGDX School of Technology", "J Mol Model", "Volume 30, Issue 4 – Dec 2024", "0948-5023", "https://www.springer.com/journal/894", "https://link.springer.com/x", "Scopus Indexed", "NA", "https://drive.google.com/open?id=1w1BSiuABCDEFGHIJKLMNOP", "na", "Yes"],
]).records[0];
check("email lower-cased, not an office entry", papers.ownerEmail === "thejus.kartha@atlasuniversity.edu.in" && !papers.office && papers.names.length === 0);
check("year read out of 'Volume 30, Issue 4 – Dec 2024', original kept", papers.achievementDate === "2024-01-01" && papers.details.date_precision === "year" && papers.details.year === 2024 && /Volume 30/.test(papers.details.date_text));
check("position 7 → '6 or later', NA fields dropped, uGDX", papers.details.authorship_position === "6 or later" && papers.details.impact_factor === undefined && papers.details.doi === undefined && papers.school === "uGDX");
const consult = mapSheet("Revenue from consultancy and tr", [
  ["Timestamp", "Email Address", "\nName of the faculty consultant or trainer", "\nOrganization to which consultancy or corporate training provided", "\nDates/duration of consultancy ", "\nAmount generated in INR ", "Letter from the corporate where training was imparted along with the fee paid.", "Letter from the beneficiary of the consultancy along with details of the consultancy fee."],
  [ts, "z@atlasuniversity.edu.in", "Dr. Z", "Terry Fox India Committee", "1 year", "10 % of the Professional fees", "https://drive.google.com/open?id=1aaaaaaaaaaaaaaaaaaaaaaa", "https://drive.google.com/open?id=1bbbbbbbbbbbbbbbbbbbbbbb"],
]).records[0];
check("consultancy: amount text kept, no date, both letters", consult.amountInr === null && consult.details.amount_text === "10 % of the Professional fees" && consult.achievementDate === null && consult.details.duration_text === "1 year" && consult.links.map((l) => l.slot).join() === "corporate_letter,beneficiary_letter");
const orcid = mapSheet("ORCID", [
  ["Timestamp", "Email Address", "Faculty Name", "School", "16 Digit ORCID ", "ORCID Profile Link"],
  [ts, "anwar@isdi.in", "Anwar Khan", "ISDI", "bad", "https://orcid.org/my-orcid?orcid=0000-0002-4963-5344"],
  [ts, "x@isdi.in", "X", "ISDI", "0000-0000-0000-0002", ""],
]);
check("ORCID from the link when the iD cell is bad; bad checksum skipped", orcid.orcids.length === 1 && orcid.orcids[0].orcid === "0000-0002-4963-5344" && orcid.skipped.length === 1);
check("source key stable + row-specific", sourceKeyFor("Awards", ["a", 1]) === sourceKeyFor("Awards", ["a", 1, "", null]) && sourceKeyFor("Awards", ["a", 1]) !== sourceKeyFor("Awards", ["a", 2]));
check("unknown sheet → nothing", mapSheet("Something else", [["Timestamp"]]).records.length === 0);

console.log("\nxlsx helpers:");
check("Excel serial → date", excelSerialToDate(45001.5).toISOString() === "2023-03-16T12:00:00.000Z");
check("XML entities", decodeXml("A &amp; B &lt;x&gt; &#8377; &#x20B9;") === "A & B <x> ₹ ₹");

console.log(failures ? `\n✗ ${failures} failure(s)\n` : "\n✓ all achievement import tests passed\n");
process.exit(failures ? 1 : 0);

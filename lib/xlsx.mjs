/**
 * Minimal, dependency-free .xlsx reader for the achievements import (CLI and admin page) (no new npm
 * package in production). Reads every worksheet into an array of rows (arrays
 * of cell values), using only node:zlib for the zip container:
 *   - shared strings, inline strings, formula strings → string
 *   - numbers → number; numbers in a date/time number format → Date
 *     (the sheet's wall-clock time, returned as a UTC Date)
 *   - booleans → true/false
 * Not supported (not needed for form exports): zip64, encryption.
 */
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("xlsx: not a zip file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("xlsx: bad central directory");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    files.set(name, () => (method === 0 ? raw : method === 8 ? inflateRawSync(raw) : (() => { throw new Error(`xlsx: compression ${method}`); })()));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()];
  });
}
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
};
/** Text of every <t> inside a fragment (rich-text runs joined), skipping phonetic <rPh>. */
const texts = (frag) => decodeXml([...frag.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(""));

const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
function isDateFormat(code) {
  const c = String(code || "").replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
  return /[dmyhs]/i.test(c) && !/^general$/i.test(c);
}

function colIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel serial (1900 system) → Date holding the same wall-clock time in UTC. */
export function excelSerialToDate(v) {
  return new Date(Math.round((v - 25569) * 86400) * 1000);
}

/** → [{ name, rows: any[][] }] — from a file path or a Buffer. */
export function readXlsx(source) {
  const files = unzip(Buffer.isBuffer(source) ? source : readFileSync(source));
  const read = (name) => (files.has(name) ? files.get(name)().toString("utf8") : null);

  const shared = [];
  const sst = read("xl/sharedStrings.xml");
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(texts(m[1]));

  const dateStyles = new Set();
  const styles = read("xl/styles.xml");
  if (styles) {
    const custom = new Map();
    for (const m of styles.matchAll(/<numFmt\b[^>]*\/?>/g)) custom.set(Number(attr(m[0], "numFmtId")), attr(m[0], "formatCode"));
    const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles);
    if (xfs) {
      [...xfs[1].matchAll(/<xf\b[^>]*?(?:\/>|>)/g)].forEach((m, i) => {
        const id = Number(attr(m[0], "numFmtId") || 0);
        if (BUILTIN_DATE_FMTS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)))) dateStyles.add(i);
      });
    }
  }

  const wb = read("xl/workbook.xml");
  const rels = read("xl/_rels/workbook.xml.rels") || "";
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id"), attr(m[0], "Target")]));
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = attr(m[0], "name");
    let t = target.get(attr(m[0], "r:id"));
    if (!t) continue;
    t = t.startsWith("/") ? t.slice(1) : `xl/${t}`;
    const xml = read(t);
    if (!xml) continue;
    const rows = [];
    for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = Number(attr(rm[1], "r")) - 1;
      const row = [];
      for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(cm[1], "r");
        const type = attr(cm[1], "t");
        const style = Number(attr(cm[1], "s") || 0);
        const body = cm[2] || "";
        const vm = /<v>([\s\S]*?)<\/v>/.exec(body);
        let val = null;
        if (type === "s") val = vm ? shared[Number(vm[1])] ?? null : null;
        else if (type === "inlineStr") val = texts(body);
        else if (type === "str" || type === "e") val = vm ? decodeXml(vm[1]) : null;
        else if (type === "b") val = vm ? vm[1] === "1" : null;
        else if (vm) {
          const n = Number(vm[1]);
          val = Number.isFinite(n) && dateStyles.has(style) ? excelSerialToDate(n) : n;
        }
        row[ref ? colIndex(ref) : row.length] = val;
      }
      rows[Number.isFinite(r) ? r : rows.length] = row;
    }
    sheets.push({ name, rows: Array.from(rows, (x) => x || []) });
  }
  return sheets;
}

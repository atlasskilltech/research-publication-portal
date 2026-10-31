/**
 * No-network, no-DB unit test of the manuscript file-handling core
 * (lib/manuscriptFiles.js): signature detection, size + type validation,
 * key safety, and path-traversal resolution. Run: node scripts/test-manuscript-files.mjs
 */
import {
  validateUpload, detectSignature, newStorageKey, isSafeKey, resolveWithinRoot,
  MAX_BYTES,
} from "../lib/manuscriptFiles.js";

let failures = 0;
const check = (l, ok, d = "") => { console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? " — " + d : ""}`); if (!ok) failures++; };

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);       // %PDF-1.7
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);                   // PK.. (docx)
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);        // doc
const TXT = Buffer.from("hello this is plain text not a document");

console.log("\n=== Manuscript file-handling unit tests ===\n");

console.log("Signature detection:");
check("PDF magic → pdf", detectSignature(PDF) === "pdf");
check("ZIP magic → docx", detectSignature(ZIP) === "docx");
check("OLE2 magic → doc", detectSignature(OLE) === "doc");
check("plain text → null", detectSignature(TXT) === null);

console.log("\nUpload validation:");
check("valid PDF accepted", validateUpload({ originalName: "paper.pdf", declaredMime: "application/pdf", size: 1000, buffer: PDF }).ok === true);
check("valid DOCX accepted", validateUpload({ originalName: "p.docx", declaredMime: ALLOWED_DOCX(), size: 1000, buffer: ZIP }).ok === true);
check("valid DOC accepted", validateUpload({ originalName: "p.doc", declaredMime: "application/msword", size: 1000, buffer: OLE }).ok === true);
check("plain text rejected (bad signature)", validateUpload({ originalName: "p.pdf", declaredMime: "application/pdf", size: 1000, buffer: TXT }).ok === false);
check("oversized rejected (server-side 25MB)", validateUpload({ originalName: "p.pdf", declaredMime: "application/pdf", size: MAX_BYTES + 1, buffer: PDF }).ok === false);
check("empty rejected", validateUpload({ originalName: "p.pdf", declaredMime: "application/pdf", size: 0, buffer: PDF }).ok === false);
check("extension spoof rejected (zip bytes, .pdf name)", validateUpload({ originalName: "evil.pdf", declaredMime: "application/pdf", size: 1000, buffer: ZIP }).ok === false);
check("docx content but .doc name rejected", validateUpload({ originalName: "x.doc", declaredMime: "application/msword", size: 1000, buffer: ZIP }).ok === false);

console.log("\nStorage keys & path-traversal:");
const key = newStorageKey("pdf");
check("generated key is safe", isSafeKey(key), key);
check("rejects traversal key", !isSafeKey("../../etc/passwd"));
check("rejects key with slash", !isSafeKey("abc/def.pdf"));
check("rejects wrong ext", !isSafeKey("deadbeefdeadbeefdeadbeefdeadbeef.exe"));
check("resolveWithinRoot returns path for safe key", resolveWithinRoot("/srv/manuscripts", key)?.includes(key));
check("resolveWithinRoot blocks traversal", resolveWithinRoot("/srv/manuscripts", "../../etc/passwd") === null);
check("resolveWithinRoot blocks absolute-ish key", resolveWithinRoot("/srv/manuscripts", "/etc/passwd.pdf") === null);

console.log(`\n${failures === 0 ? "✓ PASS — manuscript file-handling core is sound." : `✗ FAIL — ${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);

function ALLOWED_DOCX() { return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"; }

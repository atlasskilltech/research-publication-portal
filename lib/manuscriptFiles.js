// Pure manuscript file rules: allowed types, size cap, magic-byte signature
// detection, unpredictable storage-key generation, and path-traversal-safe key
// resolution. No I/O, no env, no framework imports — so the security-critical
// logic is unit-testable without a database or filesystem. lib/storage.js uses
// these to actually read/write bytes.

import crypto from "node:crypto";
import path from "node:path";

export const MAX_BYTES = 25 * 1024 * 1024; // 25 MB, enforced server-side

// Accepted formats. `magic` is the leading byte signature we require; the
// declared extension/MIME are NEVER trusted on their own.
export const ALLOWED = {
  pdf: { mime: "application/pdf", magic: [[0x25, 0x50, 0x44, 0x46]] }, // %PDF
  // DOCX is a ZIP container (PK\x03\x04, or empty/spanned PK variants).
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    magic: [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]],
  },
  // Legacy DOC is an OLE2 compound file.
  doc: { mime: "application/msword", magic: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]] },
};

const EXT_BY_MIME = Object.fromEntries(Object.entries(ALLOWED).map(([ext, v]) => [v.mime, ext]));

function matchesMagic(buffer, signatures) {
  return signatures.some((sig) => sig.every((byte, i) => buffer[i] === byte));
}

/**
 * Detect the concrete type from the file's leading bytes alone.
 * Returns 'pdf' | 'docx' | 'doc' | null. NOTE: DOCX and legacy DOC share
 * container formats with other Office/zip files; here we classify by container
 * signature and reconcile with the declared extension in validateUpload.
 */
export function detectSignature(buffer) {
  if (!buffer || buffer.length < 8) return null;
  if (matchesMagic(buffer, ALLOWED.pdf.magic)) return "pdf";
  if (matchesMagic(buffer, ALLOWED.doc.magic)) return "doc";   // OLE2
  if (matchesMagic(buffer, ALLOWED.docx.magic)) return "docx"; // ZIP container
  return null;
}

const SAFE_EXT = /\.([A-Za-z0-9]+)$/;
function extOf(name) {
  const m = SAFE_EXT.exec(String(name || "").trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * Validate an upload. Fail-closed: anything inconsistent is rejected.
 * @returns {{ ok: true, ext: 'pdf'|'docx'|'doc' } | { ok: false, error: string }}
 */
export function validateUpload({ originalName, declaredMime, size, buffer }) {
  if (typeof size !== "number" || size <= 0) return { ok: false, error: "Empty file." };
  if (size > MAX_BYTES) return { ok: false, error: "File exceeds the 25 MB limit." };

  const sig = detectSignature(buffer);
  if (!sig) return { ok: false, error: "Unsupported or malformed file. Only PDF, DOCX and DOC are accepted." };

  const ext = extOf(originalName);
  const mimeExt = EXT_BY_MIME[String(declaredMime || "").toLowerCase()] || null;

  // A ZIP container (docx signature) must be declared as .docx; an OLE2
  // container (doc signature) as .doc. For PDF the signature is authoritative.
  if (sig === "pdf") {
    if (ext && ext !== "pdf") return { ok: false, error: "File content is a PDF but the extension says otherwise." };
    return { ok: true, ext: "pdf" };
  }
  if (sig === "docx") {
    if (ext !== "docx") return { ok: false, error: "This looks like a .docx but the extension/type doesn't match." };
    if (mimeExt && mimeExt !== "docx") return { ok: false, error: "Declared type doesn't match a .docx file." };
    return { ok: true, ext: "docx" };
  }
  // sig === "doc"
  if (ext !== "doc") return { ok: false, error: "This looks like a legacy .doc but the extension/type doesn't match." };
  if (mimeExt && mimeExt !== "doc") return { ok: false, error: "Declared type doesn't match a .doc file." };
  return { ok: true, ext: "doc" };
}

/** Unpredictable, server-generated storage key. Never derived from user input. */
export function newStorageKey(ext) {
  if (!ALLOWED[ext]) throw new Error("newStorageKey: bad ext");
  return `${crypto.randomBytes(16).toString("hex")}.${ext}`;
}

/** A storage key must be exactly 32 hex chars + an allowed extension — nothing else. */
export function isSafeKey(key) {
  return /^[a-f0-9]{32}\.(pdf|docx|doc)$/.test(String(key || ""));
}

/**
 * Resolve a storage key to an absolute path inside `root`, or null if the key
 * is unsafe or would escape the root (path-traversal guard).
 */
export function resolveWithinRoot(root, key) {
  if (!isSafeKey(key)) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, key);
  const rel = path.relative(base, full);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return full;
}

/** Neutral, identity-free download filename for reviewer-facing responses. */
export function neutralDownloadName(paperId, ext) {
  return `manuscript-${String(paperId).slice(0, 8)}.${ext}`;
}

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Content-Type to SERVE for a stored manuscript, derived from the server-made
 * storage key's extension — never from the browser-declared type stored at
 * upload time (which could be e.g. text/html).
 */
export function mimeForStorageKey(storageKey) {
  const ext = String(storageKey || "").split(".").pop().toLowerCase();
  return ALLOWED[ext]?.mime || "application/octet-stream";
}

/**
 * Early size guard from Content-Length, so an oversized body is refused BEFORE
 * request.formData() buffers it in memory. Allows a small multipart overhead.
 */
export const MAX_REQUEST_BYTES = MAX_BYTES + 1024 * 1024;
export function requestTooLarge(headers) {
  const raw = headers?.get?.("content-length");
  // No length (e.g. a chunked upload) can't be bounded before buffering → refuse.
  // Browsers always send Content-Length for form uploads.
  if (raw == null || raw === "") return true;
  const n = Number(raw);
  return !Number.isFinite(n) || n > MAX_REQUEST_BYTES;
}

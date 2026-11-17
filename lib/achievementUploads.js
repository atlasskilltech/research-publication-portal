import "server-only";

// Shared upload handling for achievements: read the `file_<slot>` parts of a
// multipart form, check each file by its leading bytes (shared validator), its
// size and the slot's allowed types/count, then store them under random keys
// in the private store. Used by "create an achievement" and "upload proof to an
// existing achievement".
import { uuid } from "@/lib/auth/crypto.mjs";
import { ACH_MAX_FILE_BYTES } from "@/lib/achievementTypes";
import { validateUpload, newStorageKey, sha256, ALLOWED } from "@/lib/manuscriptFiles";
import { saveManuscript, deleteManuscript, storageErrorReason } from "@/lib/storage";

export const MAX_UPLOAD_REQUEST_BYTES = 5 * ACH_MAX_FILE_BYTES + 1024 * 1024;

/** Content-Length guard before the body is read. → error response body or null */
export function uploadTooLarge(headers) {
  const len = Number(headers.get("content-length"));
  return !Number.isFinite(len) || len <= 0 || len > MAX_UPLOAD_REQUEST_BYTES;
}

/** Collect the non-empty `file_<slot>` parts. → { counts, incoming: [{ slot, file }] } */
export function collectFiles(form) {
  const counts = {};
  const incoming = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("file_") || typeof value?.arrayBuffer !== "function" || !value.size) continue;
    const slot = name.slice(5);
    counts[slot] = (counts[slot] || 0) + 1;
    incoming.push({ slot, file: value });
  }
  return { counts, incoming };
}

/**
 * Validate every file against its slot. → { ok: true, prepared } | { ok: false, error, issues }
 * prepared: [{ id, slot, buffer, ext, mime, name, size, sha }]
 */
export async function prepareFiles(def, incoming) {
  const prepared = [];
  for (const { slot, file } of incoming) {
    const rule = def.files.find((s) => s.slot === slot);
    if (!rule) return { ok: false, error: "Unexpected file.", issues: { [`file_${slot}`]: "Unexpected file." } };
    if (file.size > ACH_MAX_FILE_BYTES) {
      return { ok: false, error: `“${file.name}” is larger than 10 MB.`, issues: { [`file_${slot}`]: "Each file can be at most 10 MB." } };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const verdict = validateUpload({ originalName: file.name, declaredMime: file.type, size: buffer.length, buffer });
    if (!verdict.ok || !rule.types.includes(verdict.ext)) {
      const kinds = rule.types.map((t) => t.toUpperCase()).join(" / ");
      return { ok: false, error: `“${file.name}” isn't an accepted file. Use ${kinds}.`, issues: { [`file_${slot}`]: `Only ${kinds} files are accepted here.` } };
    }
    prepared.push({
      id: uuid(), slot, buffer, ext: verdict.ext, mime: ALLOWED[verdict.ext].mime,
      name: String(file.name || `document.${verdict.ext}`).slice(0, 255), size: buffer.length, sha: sha256(buffer),
    });
  }
  return { ok: true, prepared };
}

/** Store prepared files (sets `key` on each). → { ok: true, keys } | { ok: false, error } — nothing left behind on failure. */
export async function storeFiles(prepared, logTag) {
  const keys = [];
  try {
    for (const p of prepared) {
      p.key = newStorageKey(p.ext);
      await saveManuscript(p.key, p.buffer, p.mime);
      keys.push(p.key);
    }
    return { ok: true, keys };
  } catch (e) {
    for (const k of keys) await deleteManuscript(k);
    const reason = storageErrorReason(e);
    console.error(`${logTag}: storage:`, reason, e?.message);
    return { ok: false, error: `Could not store the documents — ${reason}.` };
  }
}

export async function removeStored(keys) {
  for (const k of keys) await deleteManuscript(k);
}

import "server-only";

import { mkdir, writeFile, unlink, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { manuscriptStorageRoot } from "@/lib/config/env";
import { resolveWithinRoot } from "@/lib/manuscriptFiles";

/**
 * Private manuscript storage on the server filesystem (NEVER Supabase Storage,
 * never public/, never the Git/deploy dir). The root is configured by the
 * server-only MANUSCRIPT_STORAGE_DIR env var; see lib/config/env.js.
 *
 * Keys are the server-generated values from lib/manuscriptFiles.js; every path
 * is re-validated through resolveWithinRoot() so a crafted key can never escape
 * the root. Filesystem paths are never returned to the client.
 */

async function ensureRoot() {
  const root = manuscriptStorageRoot();
  await mkdir(root, { recursive: true });
  return root;
}

/** Write bytes under `key`. Returns the key (never the absolute path). */
export async function saveManuscript(key, buffer) {
  const root = await ensureRoot();
  const full = resolveWithinRoot(root, key);
  if (!full) throw new Error("storage: unsafe key");
  // 'wx' → fail if it somehow already exists (keys are unique/unpredictable).
  await writeFile(full, buffer, { flag: "wx", mode: 0o600 });
  return key;
}

/** Absolute path for reading, or null if the key is unsafe. Server-only use. */
export function manuscriptPath(key) {
  const root = path.resolve(manuscriptStorageRoot());
  return resolveWithinRoot(root, key);
}

/** Open a read stream for a stored manuscript, or throw if the key is unsafe. */
export function manuscriptStream(key) {
  const full = manuscriptPath(key);
  if (!full) throw new Error("storage: unsafe key");
  return createReadStream(full);
}

export async function manuscriptExists(key) {
  const full = manuscriptPath(key);
  if (!full) return false;
  try { await stat(full); return true; } catch { return false; }
}

/** Best-effort delete (used to clean up an orphan after a failed DB write). */
export async function deleteManuscript(key) {
  const full = manuscriptPath(key);
  if (!full) return;
  try { await unlink(full); } catch { /* already gone */ }
}

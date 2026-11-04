import "server-only";

import { mkdir, writeFile, readFile, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { manuscriptStorageRoot, s3StorageConfig } from "@/lib/config/env";
import { resolveWithinRoot, isSafeKey } from "@/lib/manuscriptFiles";

/**
 * Private manuscript storage. Two backends, chosen by server-only env vars:
 *
 *  - Amazon S3 (private bucket) when S3_BUCKET is set — see s3StorageConfig().
 *    Objects are written with no public ACL and server-side encryption; they
 *    are only ever read back through the authenticated download routes.
 *  - Otherwise the server filesystem under MANUSCRIPT_STORAGE_DIR.
 *
 * Keys are the server-generated values from lib/manuscriptFiles.js and are
 * re-validated on every call, so a crafted key can never escape the root /
 * prefix. Paths, bucket names and object keys are never returned to clients.
 */

let s3Client = null;
function s3() {
  const cfg = s3StorageConfig();
  if (!cfg) return null;
  if (!s3Client) {
    // Credentials: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from the env, or
    // the EC2 instance role — the SDK's default provider chain handles both.
    s3Client = new S3Client({ region: cfg.region, ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}) });
  }
  return { client: s3Client, bucket: cfg.bucket, objectKey: (key) => `${cfg.prefix}${key}` };
}

function safeKeyOrThrow(key) {
  if (!isSafeKey(key)) throw new Error("storage: unsafe key");
  return key;
}

async function fsPath(key) {
  const root = manuscriptStorageRoot();
  const full = resolveWithinRoot(root, key);
  if (!full) throw new Error("storage: unsafe key");
  return { root, full };
}

/** Write bytes under `key`. Returns the key (never a path or URL). */
export async function saveManuscript(key, buffer, contentType = "application/octet-stream") {
  safeKeyOrThrow(key);
  const s = s3();
  if (s) {
    await s.client.send(new PutObjectCommand({
      Bucket: s.bucket,
      Key: s.objectKey(key),
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
      IfNoneMatch: "*", // never overwrite (keys are unique/unpredictable)
    }));
    return key;
  }
  const { root, full } = await fsPath(key);
  await mkdir(root, { recursive: true });
  // 'wx' → fail if it somehow already exists.
  await writeFile(full, buffer, { flag: "wx", mode: 0o600 });
  return key;
}

/** Read a stored manuscript into a Buffer, or null if it is missing. Throws on an unsafe key. */
export async function readManuscript(key) {
  safeKeyOrThrow(key);
  const s = s3();
  if (s) {
    try {
      const out = await s.client.send(new GetObjectCommand({ Bucket: s.bucket, Key: s.objectKey(key) }));
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (e) {
      if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
  const { full } = await fsPath(key);
  try { return await readFile(full); } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

export async function manuscriptExists(key) {
  if (!isSafeKey(key)) return false;
  const s = s3();
  if (s) {
    try { await s.client.send(new HeadObjectCommand({ Bucket: s.bucket, Key: s.objectKey(key) })); return true; } catch { return false; }
  }
  try { await stat((await fsPath(key)).full); return true; } catch { return false; }
}

/** Best-effort delete (used to clean up an orphan after a failed DB write). */
export async function deleteManuscript(key) {
  if (!isSafeKey(key)) return;
  const s = s3();
  try {
    if (s) await s.client.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: s.objectKey(key) }));
    else await unlink((await fsPath(key)).full);
  } catch { /* already gone */ }
}

/** Which backend is active (for diagnostics; never includes secrets). */
export function storageBackend() {
  return s3StorageConfig() ? "s3" : "filesystem";
}

// Kept for any caller that still needs a filesystem path (filesystem backend only).
export function manuscriptPath(key) {
  if (s3StorageConfig()) return null;
  return resolveWithinRoot(path.resolve(manuscriptStorageRoot()), key);
}

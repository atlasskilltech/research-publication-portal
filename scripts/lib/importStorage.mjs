/**
 * File storage for the import script — the SAME backend and rules as the app's
 * lib/storage.js (which can't be imported from a plain Node script because it
 * is server-only): Amazon S3 when S3_BUCKET (or an alias) is set, otherwise the
 * private folder MANUSCRIPT_STORAGE_DIR. Keys come from lib/manuscriptFiles.js
 * newStorageKey() and are re-checked here.
 */
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { isSafeKey, resolveWithinRoot } from "../../lib/manuscriptFiles.js";

const pick = (...names) => {
  for (const n of names) { const v = (process.env[n] || "").trim(); if (v) return v; }
  return "";
};

function s3Config() {
  const bucket = pick("S3_BUCKET", "S3_BUCKET_NAME", "AWS_S3_BUCKET", "AWS_S3_BUCKET_NAME", "AWS_BUCKET_NAME", "AWS_BUCKET", "BUCKET_NAME");
  if (!bucket) return null;
  const region = pick("AWS_REGION", "AWS_DEFAULT_REGION", "S3_REGION", "AWS_S3_REGION", "AWS_BUCKET_REGION") || "ap-south-1";
  let prefix = process.env.S3_PREFIX === undefined ? "manuscripts/" : process.env.S3_PREFIX.trim();
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  const endpoint = pick("S3_ENDPOINT", "AWS_S3_ENDPOINT") || null;
  const accessKeyId = pick("AWS_ACCESS_KEY_ID", "AWS_ACCESS_KEY", "S3_ACCESS_KEY_ID", "S3_ACCESS_KEY", "AWS_S3_ACCESS_KEY_ID", "AWS_S3_ACCESS_KEY");
  const secretAccessKey = pick("AWS_SECRET_ACCESS_KEY", "AWS_SECRET_KEY", "S3_SECRET_ACCESS_KEY", "S3_SECRET_KEY", "AWS_S3_SECRET_ACCESS_KEY", "AWS_S3_SECRET_KEY");
  return { bucket, region, prefix, endpoint, credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : null };
}

/** → { backend: "s3" | "filesystem", save(key, buffer, mime), remove(key), describe } — throws when nothing is configured. */
export function createImportStorage() {
  const cfg = s3Config();
  if (cfg) {
    const client = new S3Client({
      region: cfg.region,
      followRegionRedirects: true,
      ...(cfg.credentials ? { credentials: cfg.credentials } : {}),
      ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}),
    });
    return {
      backend: "s3",
      describe: `S3 bucket ${cfg.bucket}, folder ${cfg.prefix || "(root)"}`,
      async save(key, buffer, mime) {
        if (!isSafeKey(key)) throw new Error("unsafe key");
        await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: cfg.prefix + key, Body: buffer, ContentType: mime }));
      },
      async remove(key) {
        if (!isSafeKey(key)) return;
        try { await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: cfg.prefix + key })); } catch { /* best effort */ }
      },
    };
  }
  const root = (process.env.MANUSCRIPT_STORAGE_DIR || "").trim();
  if (!root) throw new Error("No file storage configured: set S3_BUCKET (and AWS keys) or MANUSCRIPT_STORAGE_DIR, as for the app.");
  return {
    backend: "filesystem",
    describe: `folder ${path.resolve(root)}`,
    async save(key, buffer) {
      const full = resolveWithinRoot(root, key);
      if (!full) throw new Error("unsafe key");
      await mkdir(path.resolve(root), { recursive: true });
      await writeFile(full, buffer, { flag: "wx", mode: 0o600 });
    },
    async remove(key) {
      const full = resolveWithinRoot(root, key);
      if (full) { try { await unlink(full); } catch { /* already gone */ } }
    },
  };
}

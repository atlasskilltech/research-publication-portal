/**
 * Check manuscript storage from the server (same env as the app):
 *   npm run storage:check
 * S3 mode (S3_BUCKET set): writes, reads and deletes a tiny test object under
 * the prefix and prints the exact AWS error if a step fails.
 * Folder mode: checks MANUSCRIPT_STORAGE_DIR exists and is writable.
 * Never prints secret values — only whether each variable is set.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const env = process.env;
const set = (n) => (env[n] && env[n].trim() ? "set" : "MISSING");
const bucket = (env.S3_BUCKET || env.AWS_S3_BUCKET || env.AWS_BUCKET_NAME || env.AWS_BUCKET || "").trim();

console.log("Variables:");
for (const n of ["S3_BUCKET", "AWS_S3_BUCKET", "AWS_BUCKET_NAME", "AWS_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_PREFIX", "MANUSCRIPT_STORAGE_DIR"]) {
  console.log(`  ${n.padEnd(24)} ${set(n)}`);
}
const s3Names = Object.keys(env).filter((k) => /S3|AWS|BUCKET/i.test(k));
console.log("  (all S3/AWS-looking names in env:", s3Names.join(", ") || "none", ")");

if (bucket) {
  const region = (env.AWS_REGION || env.AWS_DEFAULT_REGION || env.S3_REGION || "ap-south-1").trim();
  let prefix = env.S3_PREFIX === undefined ? "manuscripts/" : env.S3_PREFIX.trim();
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  console.log(`\nMode: S3  bucket=${bucket} region=${region} prefix=${prefix}`);
  const c = new S3Client({ region, ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT, forcePathStyle: true } : {}) });
  const Key = `${prefix}_storage-check-${Date.now()}.txt`;
  const step = async (name, fn) => {
    try { await fn(); console.log(`  ✓ ${name}`); return true; } catch (e) {
      console.log(`  ✗ ${name}: ${e?.name} (${e?.$metadata?.httpStatusCode || "-"}) ${e?.message}`);
      return false;
    }
  };
  const ok = await step("upload (PutObject)", () => c.send(new PutObjectCommand({ Bucket: bucket, Key, Body: "ok", ContentType: "text/plain", ServerSideEncryption: "AES256", IfNoneMatch: "*" })))
    && await step("download (GetObject)", async () => { const o = await c.send(new GetObjectCommand({ Bucket: bucket, Key })); await o.Body.transformToString(); })
    && await step("delete (DeleteObject)", () => c.send(new DeleteObjectCommand({ Bucket: bucket, Key })));
  console.log(ok ? "\n✓ S3 storage works." : "\n✗ S3 storage is NOT working — see the error above.");
  process.exit(ok ? 0 : 1);
} else {
  const dir = (env.MANUSCRIPT_STORAGE_DIR || "").trim();
  console.log(`\nMode: folder (no S3 bucket variable found)  MANUSCRIPT_STORAGE_DIR=${dir || "(not set)"}`);
  if (!dir) { console.log("✗ Neither S3_BUCKET nor MANUSCRIPT_STORAGE_DIR is set — uploads will fail."); process.exit(1); }
  try {
    await mkdir(dir, { recursive: true });
    const f = path.join(dir, `_storage-check-${Date.now()}`);
    await writeFile(f, "ok"); await unlink(f);
    console.log("✓ Folder storage works.");
  } catch (e) { console.log(`✗ Folder not writable: ${e.code} ${e.message}`); process.exit(1); }
}

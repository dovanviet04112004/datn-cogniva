/**
 * R2 client helpers — wrapper quanh @aws-sdk/client-s3 cho Cloudflare R2.
 *
 * R2 S3-compatible nên dùng AWS SDK với:
 *   - endpoint: https://{accountId}.r2.cloudflarestorage.com
 *   - region: 'auto'
 *   - forcePathStyle: true (R2 yêu cầu)
 *
 * Sử dụng cho:
 *   - Delete file recording khi user xoá (Phase 20 V3)
 *   - Library V1 (2026-05): upload PDF/DOCX/image, presigned URL, public preview
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let _s3: S3Client | null = null;

function getR2Client(): S3Client {
  if (_s3) return _s3;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accessKey || !secret || !accountId) {
    throw new Error(
      'R2 env chưa đủ — cần R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ACCOUNT_ID',
    );
  }
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secret },
    forcePathStyle: true,
  });
  return _s3;
}

/** Bucket cho library docs. Ưu tiên R2_LIBRARY_BUCKET (separate bucket); fallback
 *  R2_BUCKET_NAME (shared với voice recordings) để dev không cần tạo bucket mới.
 *  Export để storage abstraction (lib/storage/r2.ts) dùng đúng 1 bucket. */
export const LIBRARY_BUCKET =
  process.env.R2_LIBRARY_BUCKET ??
  process.env.R2_BUCKET_NAME ??
  'cogniva-library';

/**
 * Xoá 1 object trên R2. Idempotent — không throw nếu key không tồn tại
 * (R2 trả 204 cho cả 2 case).
 */
export async function deleteR2Object(
  storageKey: string,
  bucket: string = process.env.R2_BUCKET_NAME ?? 'cogniva-recordings',
): Promise<void> {
  await getR2Client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }),
  );
}

/**
 * Tạo presigned URL cho client PUT trực tiếp lên R2.
 *
 * Flow:
 *   1. Server validate metadata + dedup hash → tạo unique storageKey
 *   2. Server generate presigned URL (expires 15 min)
 *   3. Client PUT file qua URL → R2 nhận file trực tiếp, server không proxy
 *   4. Client gọi finalize endpoint → server INSERT DB + trigger ingest pipeline
 *
 * @param storageKey vd "lib/{uploaderId}/{docId}.pdf"
 * @param contentType MIME type — phải match khi client PUT
 * @param expiresSeconds default 900 (15 min)
 */
export async function getPresignedUploadUrl(
  storageKey: string,
  contentType: string,
  expiresSeconds = 900,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: LIBRARY_BUCKET,
    Key: storageKey,
    ContentType: contentType,
  });
  // Cast vì 2 @smithy/types version trong dep tree gây type clash — runtime OK
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSignedUrl(getR2Client() as any, cmd as any, { expiresIn: expiresSeconds });
}

/**
 * Tạo presigned URL cho client download (signed GET).
 *
 * Dùng khi:
 *   - User bấm "Tải về" trên detail page (count download stat)
 *   - Workspace import — copy file via signed URL
 *
 * @param expiresSeconds default 3600 (1h) cho download window đủ user click
 */
export async function getPresignedDownloadUrl(
  storageKey: string,
  expiresSeconds = 3600,
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: LIBRARY_BUCKET,
    Key: storageKey,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSignedUrl(getR2Client() as any, cmd as any, { expiresIn: expiresSeconds });
}

/**
 * Public URL cho file đã upload — dùng cho thumbnail/preview KHÔNG nhạy cảm.
 *
 * R2 hỗ trợ public bucket via custom domain. Set env R2_LIBRARY_PUBLIC_URL =
 * 'https://lib.cogniva.dev' để serve files qua CDN không cần signed URL.
 *
 * Fallback: trả presigned URL nếu chưa setup public domain.
 */
export function getPublicUrl(storageKey: string): string {
  const base = process.env.R2_LIBRARY_PUBLIC_URL ?? process.env.R2_PUBLIC_URL;
  if (base) return `${base.replace(/\/$/, '')}/${storageKey}`;
  // Dev fallback — trả R2 direct URL (chỉ work nếu bucket public, hiếm)
  const accountId = process.env.R2_ACCOUNT_ID;
  return `https://${accountId}.r2.cloudflarestorage.com/${LIBRARY_BUCKET}/${storageKey}`;
}

/**
 * Upload buffer trực tiếp từ server (vd BullMQ job generate thumbnail).
 * Khác presigned URL — server giữ buffer, không relay tới client.
 */
export async function putR2Object(
  storageKey: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: LIBRARY_BUCKET,
      Key: storageKey,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/**
 * True nếu object tồn tại trên R2 (HEAD request — không tải body).
 * Dùng cho storage.exists() (health check / dedupe). Trả false khi 404/NotFound.
 */
export async function r2ObjectExists(storageKey: string): Promise<boolean> {
  try {
    await getR2Client().send(
      new HeadObjectCommand({ Bucket: LIBRARY_BUCKET, Key: storageKey }),
    );
    return true;
  } catch (err) {
    const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } });
    if (code.name === 'NotFound' || code.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

/** Download object từ R2 thành Buffer — dùng cho job parse PDF/DOCX. */
export async function getR2Object(storageKey: string): Promise<Buffer> {
  const res = await getR2Client().send(
    new GetObjectCommand({ Bucket: LIBRARY_BUCKET, Key: storageKey }),
  );
  if (!res.Body) throw new Error(`R2 object empty: ${storageKey}`);
  // Streaming → Buffer
  const chunks: Uint8Array[] = [];
  const stream = res.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

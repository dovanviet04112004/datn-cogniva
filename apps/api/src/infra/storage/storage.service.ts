/**
 * StorageService — abstraction lưu/đọc file upload, port gộp từ apps/web:
 *   lib/storage/index.ts (interface + resolve driver) + lib/storage/local.ts
 *   + lib/storage/r2.ts + phần object-ops của lib/r2-client.ts.
 *
 * Driver resolve y hệt bản cũ: env `STORAGE_DRIVER` (local | r2) tường minh,
 * không set thì auto-detect — đủ R2 creds → 'r2', fallback 'local'.
 *
 * Quy ước key:  "<userId>/<documentId>.<ext>"
 *   - tự nhiên scope theo user (xoá user → xoá hết file)
 *   - tránh path traversal vì cả 2 đoạn đều là cuid (vẫn check '..' defensive)
 */
import path from 'node:path';
import fs from 'node:fs/promises';

import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** Interface driver — giữ nguyên contract từ apps/web/src/lib/storage/index.ts. */
interface StorageDriver {
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/* ------------------------------------------------------------------------ */
/* Local driver                                                              */
/* ------------------------------------------------------------------------ */

/**
 * UPLOADS_DIR mặc định trỏ SANG apps/web/uploads (../web/uploads) chứ không
 * phải <cwd>/uploads như bản cũ: api chạy với cwd=apps/api, còn file dev hiện
 * có do Next.js (cwd=apps/web) ghi ra apps/web/uploads — phải đọc/ghi cùng 1
 * chỗ thì strangler-fig mới thấy chung file. Set env UPLOADS_DIR để override.
 */
const UPLOADS_DIR =
  process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), '../web/uploads');

function safeJoin(key: string): string {
  if (key.includes('..')) {
    throw new Error(`[storage] illegal key with '..': ${key}`);
  }
  return path.join(UPLOADS_DIR, key);
}

class LocalDriver implements StorageDriver {
  async put(key: string, body: Buffer | Uint8Array, _contentType: string): Promise<void> {
    const target = safeJoin(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(safeJoin(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(safeJoin(key));
    } catch (err) {
      // Bỏ qua "không tồn tại" — đồng nhất với behavior của object storage
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(safeJoin(key));
      return true;
    } catch {
      return false;
    }
  }
}

/* ------------------------------------------------------------------------ */
/* R2 driver                                                                 */
/* ------------------------------------------------------------------------ */

/** Bucket cho library docs — ưu tiên R2_LIBRARY_BUCKET, fallback R2_BUCKET_NAME
 *  (shared với voice recordings) để dev không cần tạo bucket mới.
 *  NGUỒN CHUẨN ở apps/web/src/lib/r2-client.ts — đổi thì sửa cả 2. */
const LIBRARY_BUCKET =
  process.env.R2_LIBRARY_BUCKET ?? process.env.R2_BUCKET_NAME ?? 'cogniva-library';

class R2Driver implements StorageDriver {
  // Lazy — chỉ throw "thiếu creds" khi thật sự dùng (giống getR2Client cũ)
  private s3: S3Client | null = null;

  private client(): S3Client {
    if (this.s3) return this.s3;
    const accessKey = process.env.R2_ACCESS_KEY_ID;
    const secret = process.env.R2_SECRET_ACCESS_KEY;
    const accountId = process.env.R2_ACCOUNT_ID;
    if (!accessKey || !secret || !accountId) {
      throw new Error(
        'R2 env chưa đủ — cần R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ACCOUNT_ID',
      );
    }
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKey, secretAccessKey: secret },
      forcePathStyle: true, // R2 yêu cầu
    });
    return this.s3;
  }

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    await this.client().send(
      new PutObjectCommand({
        Bucket: LIBRARY_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client().send(
      new GetObjectCommand({ Bucket: LIBRARY_BUCKET, Key: key }),
    );
    if (!res.Body) throw new Error(`R2 object empty: ${key}`);
    const chunks: Uint8Array[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    // Bản cũ: deleteR2Object default bucket recordings nhưng storage truyền
    // tường minh LIBRARY_BUCKET — giữ đúng hành vi đó. Idempotent (R2 trả 204
    // kể cả key không tồn tại).
    await this.client().send(
      new DeleteObjectCommand({ Bucket: LIBRARY_BUCKET, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client().send(
        new HeadObjectCommand({ Bucket: LIBRARY_BUCKET, Key: key }),
      );
      return true;
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }

  /** Presigned PUT cho client upload thẳng lên R2 (Library upload flow). */
  async presignPut(key: string, contentType: string, expiresSeconds: number): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: LIBRARY_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    // Cast vì 2 @smithy/types version trong dep tree gây type clash — runtime OK
    // (giữ y workaround của apps/web/src/lib/r2-client.ts).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getSignedUrl(this.client() as any, cmd as any, { expiresIn: expiresSeconds });
  }

  /** Presigned GET cho client download (signed URL, expire ngắn). */
  async presignGet(key: string, expiresSeconds: number): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: LIBRARY_BUCKET, Key: key });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getSignedUrl(this.client() as any, cmd as any, { expiresIn: expiresSeconds });
  }
}

/* ------------------------------------------------------------------------ */
/* Service                                                                   */
/* ------------------------------------------------------------------------ */

function resolveDriver(): 'local' | 'r2' {
  const explicit = process.env.STORAGE_DRIVER?.toLowerCase();
  if (explicit === 'r2' || explicit === 'local') return explicit;
  const hasR2 =
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY &&
    !!process.env.R2_ACCOUNT_ID;
  return hasR2 ? 'r2' : 'local';
}

@Injectable()
export class StorageService implements StorageDriver {
  private readonly driver: StorageDriver =
    resolveDriver() === 'r2' ? new R2Driver() : new LocalDriver();

  /**
   * Presigned/public URL LUÔN đi R2 bất kể STORAGE_DRIVER — y semantics
   * apps/web/src/lib/r2-client.ts (library routes gọi r2-client trực tiếp,
   * không qua storage abstraction). Lazy client → chỉ throw thiếu creds khi dùng.
   */
  private readonly r2: R2Driver =
    this.driver instanceof R2Driver ? this.driver : new R2Driver();

  /** Upload buffer thành object có tên `key`. Ghi đè nếu đã tồn tại. */
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    return this.driver.put(key, body, contentType);
  }

  /** Đọc toàn bộ object thành Buffer. Throw nếu không tồn tại. */
  get(key: string): Promise<Buffer> {
    return this.driver.get(key);
  }

  /** Xoá object. No-op nếu không tồn tại. */
  delete(key: string): Promise<void> {
    return this.driver.delete(key);
  }

  /** True nếu object tồn tại — dùng cho health check / dedupe. */
  exists(key: string): Promise<boolean> {
    return this.driver.exists(key);
  }

  /**
   * Presigned URL cho client PUT trực tiếp lên R2 — port getPresignedUploadUrl
   * từ apps/web/src/lib/r2-client.ts (bucket LIBRARY_BUCKET, default 15 min).
   */
  getPresignedUploadUrl(
    storageKey: string,
    contentType: string,
    expiresSeconds = 900,
  ): Promise<string> {
    return this.r2.presignPut(storageKey, contentType, expiresSeconds);
  }

  /** Presigned URL download (signed GET) — port getPresignedDownloadUrl r2-client. */
  getPresignedDownloadUrl(storageKey: string, expiresSeconds = 3600): Promise<string> {
    return this.r2.presignGet(storageKey, expiresSeconds);
  }

  /**
   * Public URL cho file đã upload (thumbnail/preview KHÔNG nhạy cảm) — port
   * getPublicUrl r2-client: ưu tiên R2_LIBRARY_PUBLIC_URL/R2_PUBLIC_URL (CDN),
   * fallback R2 direct URL (chỉ work nếu bucket public, hiếm).
   */
  getPublicUrl(storageKey: string): string {
    const base = process.env.R2_LIBRARY_PUBLIC_URL ?? process.env.R2_PUBLIC_URL;
    if (base) return `${base.replace(/\/$/, '')}/${storageKey}`;
    const accountId = process.env.R2_ACCOUNT_ID;
    return `https://${accountId}.r2.cloudflarestorage.com/${LIBRARY_BUCKET}/${storageKey}`;
  }
}

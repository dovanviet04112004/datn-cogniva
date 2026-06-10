/**
 * R2 storage — implementation Cloudflare R2 cho Storage interface.
 *
 * Dùng chung helper ở lib/r2-client.ts (cùng S3Client, cùng LIBRARY_BUCKET)
 * nên mọi file qua getStorage() (workspace docs, flashcard image, group
 * attachment, KYC) nằm cùng bucket với library/recordings — phân tách bằng
 * prefix key ("<userId>/...", "group-attachments/...", "kyc/...", "lib/...").
 *
 * Bật bằng env STORAGE_DRIVER=r2 (xem lib/storage/index.ts). Khác LocalStorage:
 * file không mất khi serverless restart và share giữa nhiều worker → bắt buộc
 * cho production.
 */
import {
  LIBRARY_BUCKET,
  deleteR2Object,
  getR2Object,
  putR2Object,
  r2ObjectExists,
} from '../r2-client';

import type { Storage } from './index';

export class R2Storage implements Storage {
  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    await putR2Object(key, body, contentType);
  }

  async get(key: string): Promise<Buffer> {
    return getR2Object(key);
  }

  async delete(key: string): Promise<void> {
    // Truyền đúng LIBRARY_BUCKET (deleteR2Object mặc định bucket recordings).
    await deleteR2Object(key, LIBRARY_BUCKET);
  }

  async exists(key: string): Promise<boolean> {
    return r2ObjectExists(key);
  }
}

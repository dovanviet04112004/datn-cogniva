/**
 * Local filesystem storage — implementation đơn giản cho dev.
 *
 * Lưu file dưới `<UPLOADS_DIR>/<key>` — UPLOADS_DIR mặc định là
 * `<cwd>/uploads` (tức là apps/web/uploads/ khi dev qua next dev).
 *
 * Lưu ý:
 *  - Tự tạo thư mục con nếu chưa có (key có thể chứa '/').
 *  - KHÔNG cho phép key chứa '..' để tránh path traversal — schema sinh
 *    key dạng "userId/docId.ext" đều an toàn nhưng vẫn check defensive.
 *  - Production phải swap sang R2 (file local biến mất khi serverless
 *    instance restart, không share giữa nhiều worker).
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Storage } from './index';

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');

function safeJoin(key: string): string {
  if (key.includes('..')) {
    throw new Error(`[storage] illegal key with '..': ${key}`);
  }
  return path.join(UPLOADS_DIR, key);
}

export class LocalStorage implements Storage {
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

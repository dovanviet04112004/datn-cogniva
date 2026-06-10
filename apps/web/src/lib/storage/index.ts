/**
 * Storage abstraction — interface chung cho việc lưu/đọc file đã upload.
 *
 * Phase 1 dùng implementation local filesystem (./uploads/). Sau này swap
 * sang Cloudflare R2 chỉ cần thêm `r2.ts` đáp ứng cùng interface và đổi
 * factory bên dưới. Code phía app KHÔNG biết đang chạy local hay cloud.
 *
 * Quy ước key:  "<userId>/<documentId>.<ext>"
 *   - tự nhiên scope theo user (xoá user → xoá hết file)
 *   - tránh path traversal vì cả 2 đoạn đều là cuid (không chứa '..')
 */

export interface Storage {
  /** Upload buffer thành object có tên `key`. Ghi đè nếu đã tồn tại. */
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;

  /** Đọc toàn bộ object thành Buffer. Throw nếu không tồn tại. */
  get(key: string): Promise<Buffer>;

  /** Xoá object. No-op nếu không tồn tại. */
  delete(key: string): Promise<void>;

  /** True nếu object tồn tại — dùng cho health check / dedupe. */
  exists(key: string): Promise<boolean>;
}

import { LocalStorage } from './local';
import { R2Storage } from './r2';

// Singleton — tránh tạo nhiều instance trùng dir base
let _storage: Storage | undefined;

/**
 * Driver được chọn theo env `STORAGE_DRIVER` (local | r2). Nếu không set:
 * auto-detect — có đủ R2 creds → 'r2' (production-safe), không thì 'local'
 * (dev không cần R2). Đặt STORAGE_DRIVER tường minh để ép driver.
 */
function resolveDriver(): 'local' | 'r2' {
  const explicit = process.env.STORAGE_DRIVER?.toLowerCase();
  if (explicit === 'r2' || explicit === 'local') return explicit;
  const hasR2 =
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY &&
    !!process.env.R2_ACCOUNT_ID;
  return hasR2 ? 'r2' : 'local';
}

/**
 * Lấy storage backend cấu hình theo env. Workspace docs, flashcard image,
 * group attachment, KYC đều đi qua đây → đổi driver 1 chỗ là đổi toàn bộ.
 */
export function getStorage(): Storage {
  if (_storage) return _storage;
  _storage = resolveDriver() === 'r2' ? new R2Storage() : new LocalStorage();
  return _storage;
}

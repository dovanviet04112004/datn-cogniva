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

// Singleton — tránh tạo nhiều instance trùng dir base
let _storage: Storage | undefined;

/**
 * Lấy storage backend cấu hình theo env. Hiện tại chỉ có local; thêm R2 sẽ
 * branch theo `STORAGE_DRIVER` env (local | r2).
 */
export function getStorage(): Storage {
  if (_storage) return _storage;
  _storage = new LocalStorage();
  return _storage;
}

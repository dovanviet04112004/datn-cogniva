/**
 * idb-persister — adapter để React Query persist cache xuống IndexedDB.
 *
 * `createAsyncStoragePersister` cần 1 storage kiểu AsyncStorage
 * (getItem/setItem/removeItem trả Promise). Ở đây backing bằng `idb-keyval`
 * (IndexedDB) thay vì localStorage → chứa được NHIỀU dữ liệu (list, tin nhắn…)
 * mà không đụng giới hạn ~5MB của localStorage, và không block main thread.
 *
 * An toàn SSR: idb-keyval chỉ mở IndexedDB khi get/set được GỌI (client), không
 * phải lúc import → import trong client component vẫn an toàn khi Next SSR.
 */
import type { QueryClient } from '@tanstack/react-query';
import { get, set, del } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

const idbStorage = {
  getItem: (key: string) => get<string>(key).then((v) => v ?? null),
  setItem: (key: string, value: string) => set(key, value),
  removeItem: (key: string) => del(key),
};

export const idbPersister = createAsyncStoragePersister({
  storage: idbStorage,
  key: 'cogniva-react-query',
  // Gộp ghi trong 1s để tránh spam IndexedDB khi cache đổi liên tục.
  throttleTime: 1000,
});

/**
 * Purge TOÀN BỘ cache React Query: in-memory (`qc.clear`) + bản persist trong
 * IndexedDB (`removeClient`).
 *
 * Vì sao cần: IndexedDB là per-ORIGIN, KHÔNG per-user. Khi đổi danh tính
 * (sign-out / đăng nhập tài khoản khác trên cùng trình duyệt) mà không xoá, user
 * mới sẽ load lại cache của user cũ → rò rỉ dữ liệu. Gọi hàm này ở đúng 2 chỗ:
 *   - Sign-out (user-menu) — dọn ngay khi thoát.
 *   - CacheUserGuard — lớp phòng thủ khi đổi user mà chưa qua nút Sign out.
 */
export async function purgeQueryCache(qc: QueryClient): Promise<void> {
  qc.clear(); // xoá in-memory NGAY → observer đang mount tự refetch sạch
  await idbPersister.removeClient(); // xoá bản persist (IndexedDB)
}

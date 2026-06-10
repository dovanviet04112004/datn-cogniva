/**
 * CacheUserGuard — chống RÒ RỈ cache React Query giữa các tài khoản trên CÙNG
 * trình duyệt.
 *
 * Vì sao cần: cache React Query được persist xuống IndexedDB (per-ORIGIN, KHÔNG
 * per-user). Nếu user A đăng xuất "không sạch" (đóng tab thay vì bấm Sign out)
 * rồi user B đăng nhập trên cùng máy → B có thể thấy data của A từ cache cũ.
 *
 * Cơ chế: lưu userId đang active vào localStorage. Mỗi lần app mount / đổi user,
 * nếu userId mới KHÁC userId đã lưu (và đã từng có user trước) → purge sạch cache
 * (in-memory + IndexedDB) để B bắt đầu sạch. Sign-out chủ động đã purge sẵn
 * (user-menu); guard này là LỚP PHÒNG THỦ cho case đăng xuất không sạch.
 *
 * Mount trong (app) layout với userId lấy từ session SERVER → không fetch thêm.
 */
'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { purgeQueryCache } from '@/lib/query/idb-persister';

/** Key localStorage giữ userId đang active (single-source, dùng chung user-menu). */
export const ACTIVE_USER_KEY = 'cogniva-cache-user';

export function CacheUserGuard({ userId }: { userId: string }) {
  const qc = useQueryClient();

  React.useEffect(() => {
    if (!userId) return;
    const prev = localStorage.getItem(ACTIVE_USER_KEY);
    if (prev !== userId) {
      // Đổi danh tính: nếu TRƯỚC ĐÓ có user khác mà cache chưa dọn → purge.
      if (prev) void purgeQueryCache(qc);
      localStorage.setItem(ACTIVE_USER_KEY, userId);
    }
  }, [userId, qc]);

  return null;
}

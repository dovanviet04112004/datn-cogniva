/**
 * QueryProvider — lớp data toàn app (TanStack React Query v5).
 *
 * - QueryClient cấu hình mặc định stale-while-revalidate: đổi tab/back trong
 *   `staleTime` không refetch; quá hạn thì hiện cache cũ + revalidate ngầm.
 * - PersistQueryClientProvider: persist cache xuống IndexedDB → mở lại app / F5
 *   thấy dữ liệu NGAY (instant cold-start), rồi revalidate.
 * - Devtools chỉ bật ở dev.
 *
 * Mount 1 lần ở root layout, bọc toàn bộ app.
 */
'use client';

import * as React from 'react';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

import { configureApi } from '@cogniva/shared/api';

import { idbPersister } from '@/lib/query/idb-persister';

// Cấu hình fetcher dùng chung cho web: URL tương đối (/api/*) + cookie Better Auth.
// (Đây cũng là default của shared, khai báo cho rõ + đối xứng với mobile dùng
// baseUrl tuyệt đối + Bearer token.)
configureApi({ baseUrl: '', credentials: 'include' });

// Tăng khi SHAPE dữ liệu cache đổi (migration không tương thích) để bust cache cũ.
// v2 (2026-06-03): đợt migrate React Query đổi shape nhiều query (vd invites trả array
// thay vì object) → cache persist cũ gây `.map is not a function`. Bump để dọn sạch 1 lần.
const PERSIST_BUSTER = 'v2';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  // useState initializer → QueryClient ổn định qua mọi render (không tạo mới).
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000, // 1 phút coi là fresh → đổi tab/back không refetch ngay
            gcTime: 24 * 60 * 60_000, // giữ 24h trong cache + persist
            retry: 1,
            refetchOnWindowFocus: true,
          },
          mutations: { retry: 0 },
        },
      }),
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: idbPersister,
        maxAge: 24 * 60 * 60_000, // cache persist quá 24h thì bỏ
        buster: PERSIST_BUSTER,
        dehydrateOptions: {
          // Chỉ persist query THÀNH CÔNG (đừng lưu trạng thái lỗi/đang load).
          // KHÔNG persist nhánh 'admin' (PII/audit, cần dữ liệu mới); KHÔNG persist
          // 'doc-file' (Blob PDF nặng MB, không JSON-serialize được + phình IndexedDB
          // → chỉ cache in-memory).
          shouldDehydrateQuery: (q) =>
            q.state.status === 'success' &&
            q.queryKey[0] !== 'admin' &&
            q.queryKey[0] !== 'doc-file',
        },
      }}
    >
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      )}
    </PersistQueryClientProvider>
  );
}

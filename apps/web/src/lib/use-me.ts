/**
 * useMe — user hiện tại phía client, thay useSession() của Better Auth.
 *
 * Đọc GET /api/auth/me (NestJS qua proxy same-origin, guard bằng cookie
 * cg_at). 401 = chưa đăng nhập → data null, KHÔNG phải error (caller chỉ
 * cần check null). staleTime 60s — đủ tươi cho avatar/name/email, tránh
 * refetch dồn dập khi nhiều component cùng mount.
 */
'use client';

import { useQuery } from '@tanstack/react-query';

export type Me = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  plan: string | null;
  adminRole: string | null;
};

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['auth', 'me'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error('Không lấy được thông tin tài khoản');
      const data = (await res.json()) as { user?: Me };
      return data.user ?? null;
    },
    staleTime: 60_000,
  });
}

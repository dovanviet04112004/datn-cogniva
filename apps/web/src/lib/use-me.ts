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

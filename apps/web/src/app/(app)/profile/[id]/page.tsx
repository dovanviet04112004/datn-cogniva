/**
 * /profile/[id] — public profile view của user khác.
 *
 * Chỉ show nếu user.isPublic = true (server filter), ngược lại 404.
 * Trang này có thể truy cập không cần login — middleware allow public route.
 */
'use client';

import { use } from 'react';
import Link from 'next/link';
import { Crown, Flame, Trophy, Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import type { PublicProfileDTO } from '@cogniva/shared/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type PageProps = { params: Promise<{ id: string }> };

export default function PublicProfilePage({ params }: PageProps) {
  const { id } = use(params);
  // React Query: cache + revalidate. Lỗi (404/private) → coi như notFound.
  const { data, error } = useQuery({
    queryKey: qk.publicProfile(id),
    queryFn: () => apiGet<PublicProfileDTO>(`/api/profile/${id}`),
    retry: false,
  });
  const notFound = !!error;

  if (notFound) {
    return (
      <div className="mx-auto max-w-md p-12 text-center">
        <h1 className="text-xl font-semibold">Không tìm thấy profile</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          User này chưa công khai profile hoặc không tồn tại.
        </p>
        <Link href="/leaderboard">
          <Button variant="outline" className="mt-4">
            Về Leaderboard
          </Button>
        </Link>
      </div>
    );
  }

  if (!data) {
    return <p className="p-6 text-sm text-muted-foreground">Đang tải...</p>;
  }

  const { user, stats, achievementMeta } = data;
  const unlocked = new Set(stats.achievements);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <Card className="flex items-center gap-4 p-6">
        <Avatar className="h-20 w-20">
          <AvatarImage src={user.image ?? undefined} alt={user.name ?? ''} />
          <AvatarFallback>{(user.name ?? 'U')[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{user.name ?? 'Anonymous'}</h1>
          <p className="text-xs text-muted-foreground">
            Học tại Cogniva từ{' '}
            {new Date(user.createdAt).toLocaleDateString('vi-VN')}
          </p>
        </div>
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
          {user.plan}
        </span>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="space-y-1 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Zap className="h-4 w-4 text-yellow-500" />
            XP
          </div>
          <p className="text-2xl font-bold tabular-nums">
            {stats.xp.toLocaleString('vi-VN')}
          </p>
        </Card>
        <Card className="space-y-1 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Flame className="h-4 w-4 text-orange-500" />
            Streak
          </div>
          <p className="text-2xl font-bold tabular-nums">{stats.currentStreak} ngày</p>
        </Card>
        <Card className="space-y-1 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Trophy className="h-4 w-4 text-amber-600" />
            Streak dài nhất
          </div>
          <p className="text-2xl font-bold tabular-nums">{stats.longestStreak} ngày</p>
        </Card>
      </div>

      <Card className="space-y-3 p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Crown className="h-5 w-5 text-amber-500" />
          Achievements ({unlocked.size}/{achievementMeta.length})
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {achievementMeta.map((a) => {
            const got = unlocked.has(a.id);
            return (
              <div
                key={a.id}
                className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition ${
                  got ? 'bg-card' : 'bg-muted/30 opacity-50 grayscale'
                }`}
                title={a.description}
              >
                <span className="text-3xl">{a.icon}</span>
                <p className="text-xs font-medium">{a.label}</p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

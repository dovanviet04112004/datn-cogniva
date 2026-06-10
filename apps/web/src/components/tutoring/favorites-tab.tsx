/**
 * FavoritesTab — V4 T5 (2026-05-22).
 *
 * Client component fetch /api/tutoring/favorites + render grid TutorCard.
 * Empty state với CTA về tab Tutors.
 */
'use client';

import { Heart, Loader2, Search } from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { TutorCard, type TutorCardData } from './tutor-card';

type FavoriteRow = {
  tutorId: string;
  headline: string;
  hourlyRateVnd: number;
  modality: string;
  avatarUrl: string | null;
  ratingAvg: number | string | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: string;
  instantBookEnabled?: boolean;
  avgResponseMinutes?: number | null;
  tutorName: string | null;
  favoritedAt: string;
};

export function FavoritesTab() {
  const { data: favs = [], isLoading: loading } = useQuery({
    queryKey: qk.tutoringFavorites(),
    queryFn: () =>
      apiGet<{ favorites: FavoriteRow[] }>('/api/tutoring/favorites').then(
        (d) => d.favorites ?? [],
      ),
  });

  if (loading) {
    return (
      <Card className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Đang tải…
      </Card>
    );
  }

  if (favs.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
          <Heart className="h-6 w-6" />
        </span>
        <div>
          <p className="text-sm font-semibold">Chưa có gia sư yêu thích</p>
          <p className="mt-1 max-w-[320px] text-[12px] text-muted-foreground">
            Bấm ♥ trên card gia sư để lưu lại. Quay lại dễ dàng + nhận alert khi
            tutor có pack giảm giá mới.
          </p>
        </div>
        {/* Browse gia sư — primary qua <Button asChild> (tự có shadow-primary) */}
        <Button asChild>
          <Link href="/tutoring?tab=tutors">
            <Search className="h-3.5 w-3.5" />
            Browse gia sư
          </Link>
        </Button>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {favs.map((f) => {
        const tutor: TutorCardData = {
          id: f.tutorId,
          headline: f.headline,
          hourlyRateVnd: f.hourlyRateVnd,
          modality: f.modality,
          avatarUrl: f.avatarUrl,
          name: f.tutorName,
          ratingAvg: f.ratingAvg != null ? Number(f.ratingAvg) : null,
          ratingCount: f.ratingCount,
          sessionsCompleted: f.sessionsCompleted,
          verificationStatus: f.verificationStatus,
          instantBookEnabled: f.instantBookEnabled,
          avgResponseMinutes: f.avgResponseMinutes,
          subjects: [], // Favorites endpoint chưa join subjects — V4.1 add
        };
        return <TutorCard key={f.tutorId} tutor={tutor} initialFavorited />;
      })}
    </div>
  );
}

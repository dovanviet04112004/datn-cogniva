'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Star, X, Zap } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const MODALITY_LABEL: Record<string, string> = {
  ONLINE: 'Online',
  OFFLINE_HN: 'Offline HN',
  OFFLINE_HCM: 'Offline HCM',
  HYBRID: 'Hybrid',
};

type CompareRow = {
  id: string;
  name: string | null;
  headline: string;
  avatarUrl: string | null;
  hourlyRateVnd: number;
  ratingAvg: number | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: string;
  modality: string;
  instantBookEnabled: boolean;
  avgResponseMinutes: number | null;
  responseRatePct: number | null;
  subjects: Array<{ slug: string; level: string; verified: boolean }>;
  bestPack: {
    sessionCount: number;
    totalVnd: number;
    ratePerSessionVnd: number;
    discountPct: number;
  } | null;
  nextSlot: string | null;
};

export function CompareClient({ ids }: { ids: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: tutors = [], isLoading: loading } = useQuery({
    queryKey: qk.tutoringCompare(ids.join(',')),
    queryFn: () =>
      apiSend<{ tutors: CompareRow[] }>('/api/tutoring/compare', 'POST', {
        tutorIds: ids,
      }).then((d) => d.tutors ?? []),
    enabled: ids.length > 0,
  });

  const remove = (id: string) => {
    const remaining = ids.filter((x) => x !== id);
    if (remaining.length < 2) {
      router.push('/tutoring');
      return;
    }
    const sp = new URLSearchParams(searchParams);
    sp.set('ids', remaining.join(','));
    router.replace(`/tutoring/compare?${sp.toString()}`);
  };

  if (loading) {
    return (
      <Card className="text-muted-foreground flex items-center justify-center gap-2 p-12 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        Đang tải so sánh…
      </Card>
    );
  }

  if (tutors.length === 0) {
    return (
      <Card className="text-muted-foreground p-8 text-center text-sm">Không tìm thấy gia sư.</Card>
    );
  }

  const minRate = Math.min(...tutors.map((t) => t.hourlyRateVnd));
  const maxRating = Math.max(...tutors.map((t) => t.ratingAvg ?? 0));
  const maxSessions = Math.max(...tutors.map((t) => t.sessionsCompleted));
  const minResponse = Math.min(
    ...tutors.filter((t) => t.avgResponseMinutes != null).map((t) => t.avgResponseMinutes!),
  );

  const isBest = (key: 'rate' | 'rating' | 'sessions' | 'response', val: number) => {
    if (key === 'rate') return val === minRate;
    if (key === 'rating') return val === maxRating && val > 0;
    if (key === 'sessions') return val === maxSessions && val > 0;
    if (key === 'response') return val === minResponse;
    return false;
  };

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[700px] border-collapse">
        <thead>
          <tr className="border-divider bg-muted/20 border-b">
            <th className="bg-muted/20 text-muted-foreground sticky left-0 z-10 px-4 py-3 text-left text-[11px] uppercase tracking-wider">
              Tiêu chí
            </th>
            {tutors.map((t) => (
              <th key={t.id} className="border-divider min-w-[200px] border-l px-3 py-3 text-left">
                <div className="flex items-start gap-2">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarImage src={t.avatarUrl ?? undefined} />
                    <AvatarFallback className="text-[10px]">
                      {(t.name ?? 'T')[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{t.name ?? 'Anonymous'}</p>
                    <p className="text-muted-foreground truncate text-[11px]">{t.headline}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(t.id)}
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Xoá khỏi compare"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-sm">
          <Row label="Giá / giờ">
            {tutors.map((t) => (
              <td
                key={t.id}
                className={cn(
                  'border-divider border-l px-3 py-3 font-mono tabular-nums',
                  isBest('rate', t.hourlyRateVnd) &&
                    'bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-300',
                )}
              >
                {t.hourlyRateVnd.toLocaleString('vi-VN')}đ
              </td>
            ))}
          </Row>
          <Row label="Pack tốt nhất">
            {tutors.map((t) => (
              <td key={t.id} className="border-divider border-l px-3 py-3 text-[12.5px]">
                {t.bestPack ? (
                  <span>
                    <span className="font-mono font-semibold tabular-nums">
                      {t.bestPack.totalVnd.toLocaleString('vi-VN')}đ
                    </span>
                    <span className="text-muted-foreground"> / {t.bestPack.sessionCount} buổi</span>
                    {t.bestPack.discountPct > 0 && (
                      <span className="bg-discovery-500/15 text-discovery-700 dark:text-discovery-300 ml-1 rounded px-1 text-[11px] font-semibold">
                        -{t.bestPack.discountPct}%
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            ))}
          </Row>
          <Row label="Đánh giá">
            {tutors.map((t) => (
              <td
                key={t.id}
                className={cn(
                  'border-divider border-l px-3 py-3',
                  t.ratingAvg && isBest('rating', t.ratingAvg) && 'bg-emerald-500/10 font-semibold',
                )}
              >
                {t.ratingAvg != null ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                    <span className="font-mono tabular-nums">{t.ratingAvg.toFixed(1)}</span>
                    <span className="text-muted-foreground text-[11px]">({t.ratingCount})</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            ))}
          </Row>
          <Row label="Đã hoàn thành">
            {tutors.map((t) => (
              <td
                key={t.id}
                className={cn(
                  'border-divider border-l px-3 py-3 font-mono tabular-nums',
                  isBest('sessions', t.sessionsCompleted) && 'bg-emerald-500/10 font-semibold',
                )}
              >
                {t.sessionsCompleted} buổi
              </td>
            ))}
          </Row>
          <Row label="Phản hồi">
            {tutors.map((t) => (
              <td
                key={t.id}
                className={cn(
                  'border-divider border-l px-3 py-3',
                  t.avgResponseMinutes != null &&
                    isBest('response', t.avgResponseMinutes) &&
                    'bg-emerald-500/10 font-semibold',
                )}
              >
                {t.avgResponseMinutes != null ? (
                  <span>
                    <span className="font-mono tabular-nums">{t.avgResponseMinutes}</span>
                    <span className="text-muted-foreground"> phút</span>
                    {t.responseRatePct != null && (
                      <span className="text-muted-foreground ml-1 text-[11px]">
                        ({t.responseRatePct}%)
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            ))}
          </Row>
          <Row label="Hình thức">
            {tutors.map((t) => (
              <td key={t.id} className="border-divider border-l px-3 py-3">
                {MODALITY_LABEL[t.modality] ?? t.modality}
              </td>
            ))}
          </Row>
          <Row label="Verified">
            {tutors.map((t) => (
              <td key={t.id} className="border-divider border-l px-3 py-3">
                {t.verificationStatus === 'KYC_VERIFIED' ? (
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                    ✓ KYC
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            ))}
          </Row>
          <Row label="Slot gần nhất">
            {tutors.map((t) => (
              <td key={t.id} className="border-divider border-l px-3 py-3">
                {t.nextSlot ? (
                  <span className="inline-flex items-center gap-1 text-[12px]">
                    {t.instantBookEnabled && <Zap className="text-discovery-500 h-3 w-3" />}
                    {new Date(t.nextSlot).toLocaleString('vi-VN', {
                      weekday: 'short',
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            ))}
          </Row>
          <Row label="Hành động">
            {tutors.map((t) => (
              <td key={t.id} className="border-divider border-l px-3 py-3">
                <Button asChild size="sm">
                  <Link href={`/tutors/${t.id}`}>Đặt buổi</Link>
                </Button>
              </td>
            ))}
          </Row>
        </tbody>
      </table>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-divider border-b">
      <td className="bg-background text-muted-foreground sticky left-0 z-10 px-4 py-3 text-[11.5px] font-semibold uppercase tracking-wider">
        {label}
      </td>
      {children}
    </tr>
  );
}

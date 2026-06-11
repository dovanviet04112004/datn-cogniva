'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/utils';

type Match = {
  tutorId: string;
  headline: string;
  hourlyRateVnd: number;
  modality: string;
  avatarUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: string;
  name: string | null;
  score: number;
};

export function AiMatches({ requestId }: { requestId: string }) {
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [matches, setMatches] = React.useState<Match[] | null>(null);

  const fetchMatches = async () => {
    setLoading(true);
    setOpen(true);
    try {
      const res = await fetch(`/api/tutoring/matches?requestId=${encodeURIComponent(requestId)}`);
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'AI match lỗi');
      }
      const data = (await res.json()) as { matches: Match[] };
      setMatches(data.matches);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <div className="border-primary/20 from-primary/5 rounded-2xl border bg-gradient-to-br to-transparent p-5 text-center">
        <Sparkles className="text-primary mx-auto mb-2 h-5 w-5" />
        <p className="text-sm font-semibold tracking-tight">Tìm gia sư phù hợp bằng AI</p>
        <p className="text-muted-foreground mx-auto mt-1 max-w-md text-xs">
          AI sẽ match yêu cầu của bạn với gia sư có chuyên môn gần nhất (dùng vector embedding
          cosine).
        </p>
        <div className="mt-3">
          <Button type="button" onClick={fetchMatches}>
            <Sparkles className="mr-1 h-4 w-4" />
            Gợi ý AI cho mình
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SectionHeading className="mb-0">AI gợi ý</SectionHeading>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="text-muted-foreground h-5 w-5 animate-spin" />
        </div>
      ) : !matches || matches.length === 0 ? (
        <div className="border-divider bg-card/40 rounded-2xl border border-dashed p-6 text-center">
          <p className="text-muted-foreground text-xs">
            Chưa tìm thấy match phù hợp. Browse /tutoring để tìm thủ công nhé.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {matches.map((m) => {
            const priceK = Math.round(m.hourlyRateVnd / 1000);
            return (
              <li key={m.tutorId}>
                <Link
                  href={`/tutors/${m.tutorId}`}
                  className="group/m bg-card shadow-soft hover:shadow-elevated flex items-center gap-3 rounded-xl p-4 transition-all hover:-translate-y-0.5"
                >
                  <Avatar className="ring-primary/15 h-11 w-11 ring-2">
                    <AvatarImage src={m.avatarUrl ?? undefined} />
                    <AvatarFallback>{(m.name ?? '?')[0]?.toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold tracking-tight">
                        {m.name ?? 'Anonymous'}
                      </p>
                      <span
                        className={cn(
                          'rounded-full px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums',
                          m.score > 0.7
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                            : m.score > 0.5
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {Math.round(m.score * 100)}% match
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[11px]">
                      {m.headline}
                    </p>
                    <p className="text-text-muted mt-0.5 text-[11px]">
                      <span className="font-mono tabular-nums">{priceK}K/giờ</span> ·{' '}
                      {m.sessionsCompleted} buổi
                      {m.ratingAvg !== null && ` · ★${m.ratingAvg.toFixed(1)}`}
                    </p>
                  </div>
                  <ChevronRight className="text-muted-foreground/40 group-hover/m:text-foreground h-4 w-4" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

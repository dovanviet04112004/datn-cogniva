'use client';

import * as React from 'react';
import Link from 'next/link';
import { CheckCircle2, Heart, MessageCircle, Star, Verified, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { MODALITY_NAMES } from '@cogniva/db/taxonomy';

export type TutorCardData = {
  id: string;
  headline: string;
  hourlyRateVnd: number;
  modality: string;
  avatarUrl: string | null;
  name: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: string;
  instantBookEnabled?: boolean;
  trialSessionEnabled?: boolean;
  avgResponseMinutes?: number | null;
  subjects: Array<{
    slug: string;
    level: string;
    verified: boolean;
    name: string;
    emoji: string;
  }>;
};

function formatResponseTime(minutes: number): {
  text: string;
  classes: string;
} {
  if (minutes < 30) {
    return {
      text: `Phản hồi < 30p`,
      classes: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    };
  }
  if (minutes < 120) {
    return {
      text: `Phản hồi ~${minutes}p`,
      classes: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    };
  }
  const hours = Math.round(minutes / 60);
  return {
    text: `Phản hồi ~${hours}h`,
    classes: 'bg-muted text-muted-foreground',
  };
}

const COMPARE_CART_KEY = 'cogniva.tutoring.compareCart';
const COMPARE_CART_EVENT = 'cogniva:compare-cart-change';

function readCompareCart(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(COMPARE_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeCompareCart(ids: string[]) {
  try {
    localStorage.setItem(COMPARE_CART_KEY, JSON.stringify(ids));
    window.dispatchEvent(new Event(COMPARE_CART_EVENT));
  } catch {}
}

export { readCompareCart, writeCompareCart, COMPARE_CART_EVENT };

export function TutorCard({
  tutor: t,
  initialFavorited = false,
  hideCompare = false,
}: {
  tutor: TutorCardData;
  initialFavorited?: boolean;
  hideCompare?: boolean;
}) {
  const isVerified = t.verificationStatus === 'KYC_VERIFIED';
  const priceK = Math.round(t.hourlyRateVnd / 1000);

  const [favorited, setFavorited] = React.useState(initialFavorited);
  const [favBusy, setFavBusy] = React.useState(false);
  const [compared, setCompared] = React.useState(false);

  React.useEffect(() => {
    const sync = () => setCompared(readCompareCart().includes(t.id));
    sync();
    window.addEventListener(COMPARE_CART_EVENT, sync);
    return () => window.removeEventListener(COMPARE_CART_EVENT, sync);
  }, [t.id]);

  const toggleFav = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (favBusy) return;
    setFavBusy(true);
    const prev = favorited;
    setFavorited(!prev);
    try {
      const res = await fetch(`/api/tutors/${t.id}/favorite`, { method: 'POST' });
      if (!res.ok) throw new Error('Toggle lỗi');
      const data = (await res.json()) as { favorited: boolean };
      setFavorited(data.favorited);
      toast.success(data.favorited ? 'Đã thêm vào yêu thích' : 'Đã bỏ yêu thích');
    } catch (err) {
      setFavorited(prev);
      toast.error((err as Error).message);
    } finally {
      setFavBusy(false);
    }
  };

  const toggleCompare = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const cart = readCompareCart();
    const next = cart.includes(t.id)
      ? cart.filter((x) => x !== t.id)
      : cart.length >= 4
        ? cart
        : [...cart, t.id];
    if (cart.length >= 4 && !cart.includes(t.id)) {
      toast.error('Chỉ so sánh được tối đa 4 gia sư');
      return;
    }
    writeCompareCart(next);
    setCompared(next.includes(t.id));
  };

  return (
    <Link
      href={`/tutors/${t.id}`}
      className="group/t border-divider bg-card shadow-soft duration-base ease-expo-out hover:border-primary/30 hover:shadow-elevated relative flex flex-col gap-3 overflow-hidden rounded-2xl border p-4 transition-all hover:-translate-y-0.5 sm:p-5"
    >
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        {!hideCompare && (
          <button
            type="button"
            onClick={toggleCompare}
            aria-label={compared ? 'Bỏ so sánh' : 'Thêm so sánh'}
            className={cn(
              'group/cmp bg-card/80 flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold backdrop-blur-sm transition-all',
              compared
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-divider text-muted-foreground hover:border-primary/40 hover:text-primary',
            )}
            title={compared ? 'Bỏ so sánh' : 'Thêm vào so sánh'}
          >
            {compared ? '✓' : '⇄'}
          </button>
        )}
        <button
          type="button"
          onClick={toggleFav}
          disabled={favBusy}
          aria-label={favorited ? 'Bỏ yêu thích' : 'Thêm yêu thích'}
          className={cn(
            'bg-card/80 flex h-7 w-7 items-center justify-center rounded-full border backdrop-blur-sm transition-all',
            favorited
              ? 'border-rose-500/40 text-rose-500'
              : 'border-divider text-muted-foreground hover:border-rose-500/40 hover:text-rose-500',
          )}
          title={favorited ? 'Bỏ yêu thích' : 'Thêm yêu thích'}
        >
          <Heart className={cn('h-3.5 w-3.5', favorited && 'fill-current')} />
        </button>
      </div>

      <div className="flex items-start gap-3 pr-16">
        <div className="relative shrink-0">
          <Avatar className="ring-primary/15 h-14 w-14 ring-2 transition-transform group-hover/t:scale-105">
            <AvatarImage src={t.avatarUrl ?? undefined} alt={t.name ?? ''} />
            <AvatarFallback className="text-base font-semibold">
              {(t.name ?? '?')[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {isVerified && (
            <div
              title="Đã xác thực CCCD"
              className="bg-card absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full"
            >
              <CheckCircle2
                className="fill-primary text-primary-foreground h-4 w-4"
                strokeWidth={2}
              />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight">{t.name ?? 'Anonymous'}</p>
          <p className="text-text-muted mt-0.5 text-[11px]">
            {MODALITY_NAMES[t.modality] ?? t.modality}
          </p>
          {t.ratingAvg !== null && t.ratingCount > 0 ? (
            <p className="mt-1 inline-flex items-center gap-0.5 text-[11px]">
              <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
              <span className="text-foreground/80 font-mono font-semibold tabular-nums">
                {t.ratingAvg.toFixed(1)}
              </span>
              <span className="text-muted-foreground">({t.ratingCount})</span>
            </p>
          ) : (
            <p className="text-text-muted mt-1 text-[11px] italic">Mới</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {t.instantBookEnabled && (
          <span className="bg-discovery-500/10 text-discovery-700 dark:text-discovery-300 inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold">
            <Zap className="h-2.5 w-2.5" />
            Đặt ngay
          </span>
        )}
        {t.trialSessionEnabled && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
            🎁 Buổi thử
          </span>
        )}
        {t.avgResponseMinutes != null &&
          (() => {
            const r = formatResponseTime(t.avgResponseMinutes);
            return (
              <span
                className={cn(
                  'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                  r.classes,
                )}
              >
                <MessageCircle className="h-2.5 w-2.5" />
                {r.text}
              </span>
            );
          })()}
        {t.sessionsCompleted >= 100 && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
            🏆 {t.sessionsCompleted}+ buổi
          </span>
        )}
      </div>

      <p className="text-foreground/85 line-clamp-2 text-[13px] leading-relaxed">{t.headline}</p>

      {t.subjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {t.subjects.slice(0, 3).map((s) => (
            <span
              key={s.slug + s.level}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
                s.verified
                  ? 'bg-primary/10 text-primary ring-primary/20 ring-1 ring-inset'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <span>{s.emoji}</span>
              {s.name}
              {s.verified && <Verified className="h-2.5 w-2.5" />}
            </span>
          ))}
          {t.subjects.length > 3 && (
            <span className="bg-muted/60 text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[11px]">
              +{t.subjects.length - 3} môn
            </span>
          )}
        </div>
      )}

      <div className="border-divider mt-auto flex items-center justify-between border-t pt-3">
        <div>
          <p className="font-mono text-base font-semibold tabular-nums tracking-tight">
            {priceK}K
            <span className="text-muted-foreground ml-0.5 text-[11px] font-normal">/giờ</span>
          </p>
          <p className="text-muted-foreground text-[11px]">
            <span className="text-foreground/70 font-mono font-semibold tabular-nums">
              {t.sessionsCompleted}
            </span>{' '}
            buổi đã dạy
          </p>
        </div>
        <span className="bg-primary/10 text-primary group-hover/t:bg-primary group-hover/t:text-primary-foreground inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-colors">
          Xem profile →
        </span>
      </div>
    </Link>
  );
}

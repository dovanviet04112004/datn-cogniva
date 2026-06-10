/**
 * TutorCard — V4 (2026-05-22).
 *
 * Card preview tutor trong /tutors browse grid với:
 *   - Favorite heart icon (♥) — toggle qua /api/tutors/[id]/favorite
 *   - Compare checkbox — push tutor id vào compare cart (localStorage)
 *   - Trust badge row: instant book ⚡ / response time 💬 / verified ✓
 *   - Hover state lift + shadow elevated + photo zoom
 *
 * Spec: docs/plans/tutoring-v4.md §7.2 component spec.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Heart,
  MessageCircle,
  Star,
  Verified,
  Zap,
} from 'lucide-react';
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
  /** V4 T2 — Instant book + response metrics. Optional vì legacy data thiếu. */
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

/** Format response time màu theo độ nhanh — pattern Airbnb host quality. */
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

/** Helper read/write compare cart in localStorage. */
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
  } catch {
    /* ignore */
  }
}

/** Public helpers cho compare cart (export để CompareFloatingBar dùng). */
export { readCompareCart, writeCompareCart, COMPARE_CART_EVENT };

export function TutorCard({
  tutor: t,
  /** V4 T5: initial favorite state — server SSR có thể pass; default false. */
  initialFavorited = false,
  /** Hide compare checkbox (vd: favorites tab — đã có rồi). */
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

  // Sync compare cart on mount + listen event from siblings
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
    setFavorited(!prev); // optimistic
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
      className="group/t relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-divider bg-card p-4 shadow-soft transition-all duration-base ease-expo-out hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elevated sm:p-5"
    >
      {/* Top actions overlay */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1">
        {!hideCompare && (
          <button
            type="button"
            onClick={toggleCompare}
            aria-label={compared ? 'Bỏ so sánh' : 'Thêm so sánh'}
            className={cn(
              'group/cmp flex h-7 w-7 items-center justify-center rounded-full border bg-card/80 text-[10px] font-bold backdrop-blur-sm transition-all',
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
            'flex h-7 w-7 items-center justify-center rounded-full border bg-card/80 backdrop-blur-sm transition-all',
            favorited
              ? 'border-rose-500/40 text-rose-500'
              : 'border-divider text-muted-foreground hover:border-rose-500/40 hover:text-rose-500',
          )}
          title={favorited ? 'Bỏ yêu thích' : 'Thêm yêu thích'}
        >
          <Heart className={cn('h-3.5 w-3.5', favorited && 'fill-current')} />
        </button>
      </div>

      {/* Header — avatar + name + price */}
      <div className="flex items-start gap-3 pr-16">
        <div className="relative shrink-0">
          <Avatar className="h-14 w-14 ring-2 ring-primary/15 transition-transform group-hover/t:scale-105">
            <AvatarImage src={t.avatarUrl ?? undefined} alt={t.name ?? ''} />
            <AvatarFallback className="text-base font-semibold">
              {(t.name ?? '?')[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          {isVerified && (
            <div
              title="Đã xác thực CCCD"
              className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-card"
            >
              <CheckCircle2
                className="h-4 w-4 fill-primary text-primary-foreground"
                strokeWidth={2}
              />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold tracking-tight">
            {t.name ?? 'Anonymous'}
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">
            {MODALITY_NAMES[t.modality] ?? t.modality}
          </p>
          {t.ratingAvg !== null && t.ratingCount > 0 ? (
            <p className="mt-1 inline-flex items-center gap-0.5 text-[11px]">
              <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
              <span className="font-mono font-semibold tabular-nums text-foreground/80">
                {t.ratingAvg.toFixed(1)}
              </span>
              <span className="text-muted-foreground">({t.ratingCount})</span>
            </p>
          ) : (
            <p className="mt-1 text-[11px] italic text-text-muted">Mới</p>
          )}
        </div>
      </div>

      {/* Trust badge row — V4 T2 + V5 polish */}
      <div className="flex flex-wrap gap-1.5">
        {t.instantBookEnabled && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-discovery-500/10 px-2 py-0.5 text-[11px] font-semibold text-discovery-700 dark:text-discovery-300">
            <Zap className="h-2.5 w-2.5" />
            Đặt ngay
          </span>
        )}
        {t.trialSessionEnabled && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
            🎁 Buổi thử
          </span>
        )}
        {t.avgResponseMinutes != null && (() => {
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

      {/* Headline */}
      <p className="line-clamp-2 text-[13px] leading-relaxed text-foreground/85">
        {t.headline}
      </p>

      {/* Subject pills */}
      {t.subjects.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {t.subjects.slice(0, 3).map((s) => (
            <span
              key={s.slug + s.level}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
                s.verified
                  ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/20'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <span>{s.emoji}</span>
              {s.name}
              {s.verified && <Verified className="h-2.5 w-2.5" />}
            </span>
          ))}
          {t.subjects.length > 3 && (
            <span className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground">
              +{t.subjects.length - 3} môn
            </span>
          )}
        </div>
      )}

      {/* Footer — giá + CTA */}
      <div className="mt-auto flex items-center justify-between border-t border-divider pt-3">
        <div>
          <p className="font-mono text-base font-semibold tabular-nums tracking-tight">
            {priceK}K
            <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">
              /giờ
            </span>
          </p>
          <p className="text-[11px] text-muted-foreground">
            <span className="font-mono tabular-nums font-semibold text-foreground/70">
              {t.sessionsCompleted}
            </span>{' '}
            buổi đã dạy
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary transition-colors group-hover/t:bg-primary group-hover/t:text-primary-foreground">
          Xem profile →
        </span>
      </div>
    </Link>
  );
}

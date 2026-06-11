'use client';

import * as React from 'react';
import { MapPin, Star } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

import type { TutorMatch } from './concierge-panel';

const MODALITY_LABEL: Record<string, string> = {
  ONLINE: 'Online',
  OFFLINE_HN: 'Offline HN',
  OFFLINE_HCM: 'Offline HCM',
  HYBRID: 'Hybrid',
};

type Props = {
  tutor: TutorMatch;
  rank: number;
  onOpen: () => void;
};

export function TutorMatchCard({ tutor, rank, onOpen }: Props) {
  const name = tutor.headline?.split('—')[0]?.trim() ?? tutor.headline;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="border-divider bg-card hover:border-discovery-500/30 hover:shadow-elevated group block w-full overflow-hidden rounded-xl border text-left transition-all hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-3 p-3">
        <div className="relative shrink-0">
          <Avatar className="h-11 w-11">
            <AvatarImage src={tutor.avatarUrl ?? undefined} />
            <AvatarFallback className="text-xs font-semibold">
              {name[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <span className="bg-discovery-500 absolute -left-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full font-mono text-[9px] font-bold text-white">
            {rank + 1}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{name}</p>
          <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-[10.5px]">
            {tutor.ratingAvg != null && (
              <span className="inline-flex items-center gap-0.5">
                <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />
                <span className="text-foreground font-medium tabular-nums">
                  {tutor.ratingAvg.toFixed(1)}
                </span>
                <span>({tutor.ratingCount})</span>
              </span>
            )}
            {tutor.sessionsCompleted > 0 && <span>· {tutor.sessionsCompleted} buổi</span>}
            <span className="ml-auto inline-flex items-center gap-0.5">
              <MapPin className="h-2.5 w-2.5" />
              {MODALITY_LABEL[tutor.modality] ?? tutor.modality}
            </span>
          </div>
          {tutor.matchReason && (
            <p
              className={cn(
                'bg-discovery-500/5 mt-1 line-clamp-2 rounded-md px-2 py-1 text-[11px] leading-snug',
                'text-discovery-700 dark:text-discovery-300',
              )}
            >
              <span className="font-semibold">💡 </span>
              {tutor.matchReason}
            </p>
          )}
        </div>
      </div>
      <div className="border-divider bg-muted/20 flex items-center justify-between border-t px-3 py-1.5">
        <span className="text-[12.5px]">
          <span className="font-mono font-semibold tabular-nums">
            {(tutor.hourlyRateVnd / 1000).toFixed(0)}k
          </span>
          <span className="text-muted-foreground"> /giờ</span>
        </span>
        <span className="text-discovery-700 group-hover:text-discovery-800 dark:text-discovery-300 text-[10.5px] font-medium">
          Xem profile →
        </span>
      </div>
    </button>
  );
}

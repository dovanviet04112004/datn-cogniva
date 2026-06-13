'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronRight, Inbox, MessageSquare, Star, X } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeading } from '@/components/ui/section-heading';
import { useConfirm } from '@/lib/use-confirm';
import { cn } from '@/lib/utils';

type Application = {
  id: string;
  tutorId: string;
  message: string;
  proposedRateVnd: number;
  status: string;
  createdAt: Date;
  tutorHeadline: string;
  tutorRating: string | null;
  tutorRatingCount: number;
  tutorSessions: number;
  tutorAvatarUrl: string | null;
  tutorUserId: string;
};

export function ApplicationsList({
  applications,
  onChanged,
}: {
  applications: Application[];
  onChanged?: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const decide = async (appId: string, status: 'ACCEPTED' | 'REJECTED') => {
    if (status === 'ACCEPTED') {
      const ok = await confirm({
        title: 'Chấp nhận gia sư này?',
        description: 'Các ứng tuyển khác sẽ tự động bị từ chối và yêu cầu sẽ đóng.',
        confirmLabel: 'Chấp nhận',
      });
      if (!ok) return;
    }
    setPendingId(appId);
    try {
      const res = await fetch(`/api/tutoring/applications/${appId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'Thao tác fail');
      }
      toast.success(status === 'ACCEPTED' ? 'Đã chấp nhận' : 'Đã từ chối');
      router.refresh();
      onChanged?.();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setPendingId(null);
    }
  };

  const contactTutor = async (tutorUserId: string) => {
    try {
      const res = await fetch('/api/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerUserId: tutorUserId }),
      });
      if (!res.ok) throw new Error('Không tạo được DM');
      const data = (await res.json()) as { thread: { id: string } };
      router.push(`/messages/${data.thread.id}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <section>
      <SectionHeading count={applications.length}>Gia sư đã apply</SectionHeading>

      {applications.length === 0 ? (
        <EmptyState
          compact
          icon={Inbox}
          title="Chưa có gia sư nào apply"
          description="Đợi vài giờ — gia sư sẽ thấy yêu cầu mới."
        />
      ) : (
        <ul className="space-y-3">
          {applications.map((a) => {
            const isPending = a.status === 'PENDING';
            const isAccepted = a.status === 'ACCEPTED';
            const isRejected = a.status === 'REJECTED';
            const proposedK = Math.round(a.proposedRateVnd / 1000);
            const rating = a.tutorRating ? Number(a.tutorRating) : null;
            const busy = pendingId === a.id;
            return (
              <li
                key={a.id}
                className={cn(
                  'bg-card shadow-soft rounded-2xl p-5',
                  isAccepted && 'ring-primary/30 ring-1',
                  isRejected && 'opacity-60',
                )}
              >
                <div className="flex items-start gap-4">
                  <Avatar className="h-12 w-12 shrink-0">
                    <AvatarImage src={a.tutorAvatarUrl ?? undefined} />
                    <AvatarFallback>T</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <Link
                        href={`/tutors/${a.tutorId}`}
                        className="text-sm font-semibold tracking-tight hover:underline"
                      >
                        {a.tutorHeadline}
                      </Link>
                      {isAccepted && (
                        <span className="bg-primary/15 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
                          <Check className="h-3 w-3" />
                          Đã chọn
                        </span>
                      )}
                      {isRejected && (
                        <span className="bg-muted/60 text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                          Từ chối
                        </span>
                      )}
                    </div>

                    <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-3 text-[11px]">
                      {rating !== null && a.tutorRatingCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                          <span className="text-foreground/80 font-mono font-semibold tabular-nums">
                            {rating.toFixed(1)}
                          </span>
                          <span className="font-mono tabular-nums">({a.tutorRatingCount})</span>
                        </span>
                      )}
                      <span>
                        <span className="text-foreground/80 font-mono font-semibold tabular-nums">
                          {a.tutorSessions}
                        </span>{' '}
                        buổi đã dạy
                      </span>
                      <span>
                        Đề xuất:{' '}
                        <span className="text-foreground/80 font-mono font-semibold tabular-nums">
                          {proposedK}K
                        </span>{' '}
                        vnd/giờ
                      </span>
                    </div>

                    <p className="text-foreground/85 mt-3 whitespace-pre-wrap text-sm leading-relaxed">
                      {a.message}
                    </p>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Link
                        href={`/tutors/${a.tutorId}`}
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs transition-colors"
                      >
                        Xem profile
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => contactTutor(a.tutorUserId)}
                        className="bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors"
                      >
                        <MessageSquare className="h-3 w-3" />
                        Chat
                      </button>
                      {isPending && (
                        <div className="ml-auto flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => decide(a.id, 'REJECTED')}
                            disabled={busy}
                          >
                            <X className="h-3 w-3" />
                            Từ chối
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => decide(a.id, 'ACCEPTED')}
                            disabled={busy}
                          >
                            <Check className="h-3 w-3" />
                            Chấp nhận
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

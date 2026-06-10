/**
 * EndorseSection — Phase 3 Tutor Endorsement UI (2026-05-27).
 *
 * Hai phần:
 *   1. List endorsers (avatar + headline + note nếu có) — visible cho mọi user
 *   2. "Endorse doc này" button — chỉ hiện khi user là tutor verified
 *
 * Side effect endorse: gọi /api/library/docs/[id]/endorse POST → quality
 * recompute auto-grant badge educator_approved.
 *
 * Spec: docs/plans/library-share.md §Phase 3 tutor endorsement.
 */
'use client';

import * as React from 'react';
import { CheckCircle2, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/lib/use-confirm';
import { useT } from '@/lib/i18n/context';

type Endorsement = {
  id: string;
  note: string | null;
  createdAt: string;
  tutorId: string;
  tutorHeadline: string | null;
  tutorAvatar: string | null;
  tutorName: string | null;
  verificationStatus: string | null;
};

type TutorEligibility = {
  isTutor: boolean;
  isVerified: boolean;
  isPublished: boolean;
  hasEndorsed: boolean;
};

export function EndorseSection({ docId }: { docId: string }) {
  const t = useT();
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  type EndorseData = { endorsements: Endorsement[]; viewer: TutorEligibility };
  const { data, isLoading: loading, refetch } = useQuery({
    queryKey: qk.libraryDocEndorse(docId),
    queryFn: () =>
      apiGet<EndorseData>(`/api/library/docs/${docId}/endorse`),
    enabled: !!docId,
  });
  const endorsements = data?.endorsements ?? [];
  const eligibility = data?.viewer ?? null;

  const submit = async () => {
    setSubmitting(true);
    try {
      await apiSend(`/api/library/docs/${docId}/endorse`, 'POST', {
        note: note.trim() || undefined,
      });
      toast.success(t('library.endorse.thanks'));
      setFormOpen(false);
      setNote('');
      void refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const revoke = async () => {
    const ok = await confirm({ title: t('library.endorse.revoke_confirm') });
    if (!ok) return;
    try {
      await apiSend(`/api/library/docs/${docId}/endorse`, 'DELETE');
      toast.success(t('library.endorse.revoked'));
      void refetch();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (loading && endorsements.length === 0) {
    return null; // hidden lúc đầu để không gây flash UI
  }

  const canEndorse =
    eligibility?.isTutor &&
    eligibility.isVerified &&
    eligibility.isPublished &&
    !eligibility.hasEndorsed;
  const hasEndorsed = eligibility?.hasEndorsed ?? false;

  // Hide section nếu không có endorsement AND không phải tutor verified
  if (endorsements.length === 0 && !canEndorse && !hasEndorsed) return null;

  return (
    <section className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3" />
          {t('library.endorse.title')} ({endorsements.length})
        </p>
        {canEndorse && (
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="text-[10.5px] font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
          >
            {t('library.endorse.add')}
          </button>
        )}
        {hasEndorsed && (
          <button
            type="button"
            onClick={revoke}
            className="text-[10px] text-muted-foreground hover:text-rose-600"
          >
            {t('library.endorse.revoke')}
          </button>
        )}
      </div>

      {endorsements.length === 0 ? (
        <p className="text-[11.5px] text-muted-foreground">
          {t('library.endorse.empty')}
        </p>
      ) : (
        <ul className="space-y-2">
          {endorsements.slice(0, 4).map((e) => (
            <li key={e.id} className="flex items-start gap-2">
              <Avatar className="h-6 w-6">
                <AvatarImage src={e.tutorAvatar ?? undefined} />
                <AvatarFallback className="text-[9px]">
                  {(e.tutorName ?? '?')[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-semibold leading-tight">
                  {e.tutorName ?? t('library.endorse.tutor')}{' '}
                  <span className="font-normal text-emerald-700 dark:text-emerald-300">
                    ✓ KYC
                  </span>
                </p>
                <p className="line-clamp-1 text-[10.5px] text-muted-foreground">
                  {e.tutorHeadline}
                </p>
                {e.note && (
                  <p className="mt-1 rounded bg-background/60 px-2 py-1 text-[11px] italic text-foreground/85">
                    &quot;{e.note}&quot;
                  </p>
                )}
              </div>
            </li>
          ))}
          {endorsements.length > 4 && (
            <li className="text-[10.5px] text-muted-foreground">
              {t('library.endorse.others_prefix')} {endorsements.length - 4} {t('library.endorse.others_suffix')}
            </li>
          )}
        </ul>
      )}

      {/* Endorse form */}
      {formOpen && (
        <div className="mt-2.5 rounded-lg border border-emerald-500/30 bg-background p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1 text-[11.5px] font-semibold">
              <Sparkles className="h-3 w-3 text-emerald-600" />
              {t('library.endorse.endorse_this')}
            </p>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="rounded p-0.5 hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('library.endorse.note_placeholder')}
            rows={2}
            maxLength={500}
            className="resize-none text-[12px]"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              {t('library.endorse.button')}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

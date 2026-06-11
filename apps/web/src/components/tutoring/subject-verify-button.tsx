'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, Verified } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';

export function SubjectVerifyButton({
  tutorId,
  subjectId,
  isVerified,
  verifyScore,
}: {
  tutorId: string;
  subjectId: string;
  isVerified: boolean;
  verifyScore: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);

  if (isVerified) {
    return (
      <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
        <Verified className="h-3 w-3" />
        Verified
        {verifyScore !== null && <span className="font-mono tabular-nums">{verifyScore}%</span>}
      </span>
    );
  }

  const startVerify = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/tutors/${tutorId}/subjects/${subjectId}/verify-quiz`, {
        method: 'POST',
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(typeof e?.error === 'string' ? e.error : 'AI gen lỗi');
      }
      const data = (await res.json()) as { quizId: string };
      toast.success('Đã tạo quiz — làm bài để verify môn này');
      router.push(`/quiz/${data.quizId}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={startVerify}
      disabled={busy}
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400',
        busy && 'pointer-events-none opacity-60',
      )}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      Verify môn này
    </button>
  );
}

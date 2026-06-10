/**
 * /quiz/[id]/attempt — load quiz + questions (NO answers) rồi render
 * QuizAttemptSession. Sau khi submit, results hiển thị in-place.
 */
'use client';

import { use } from 'react';
import { Loader2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import type { QuizAttemptDTO } from '@cogniva/shared/types';
import { QuizAttemptSession } from '@/components/quiz/quiz-attempt-session';

type PageProps = {
  params: Promise<{ id: string }>;
};

export default function QuizAttemptPage({ params }: PageProps) {
  const { id } = use(params);
  const { data, error } = useQuery({
    queryKey: qk.quiz(id),
    queryFn: () => apiGet<QuizAttemptDTO>(`/api/quiz/${id}`),
  });

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center text-sm text-muted-foreground">
        Lỗi: {(error as Error).message}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto flex max-w-2xl items-center justify-center p-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Đang tải quiz...
      </div>
    );
  }

  return <QuizAttemptSession quiz={data.quiz} questions={data.questions} />;
}

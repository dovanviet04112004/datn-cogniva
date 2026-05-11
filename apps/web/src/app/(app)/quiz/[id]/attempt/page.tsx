/**
 * /quiz/[id]/attempt — load quiz + questions (NO answers) rồi render
 * QuizAttemptSession. Sau khi submit, results hiển thị in-place.
 */
'use client';

import * as React from 'react';
import { use } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { QuizAttemptSession } from '@/components/quiz/quiz-attempt-session';

type PageProps = {
  params: Promise<{ id: string }>;
};

type Question = {
  id: string;
  type: 'MCQ' | 'TRUE_FALSE' | 'SHORT';
  prompt: string;
  options: string[] | null;
  difficulty: number;
};

type Quiz = {
  id: string;
  title: string;
};

export default function QuizAttemptPage({ params }: PageProps) {
  const { id } = use(params);
  const [data, setData] = React.useState<{ quiz: Quiz; questions: Question[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetch(`/api/quiz/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`status ${r.status}`);
        return (await r.json()) as { quiz: Quiz; questions: Question[] };
      })
      .then(setData)
      .catch((err: Error) => {
        setError(err.message);
        toast.error('Không load được quiz: ' + err.message);
      });
  }, [id]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center text-sm text-muted-foreground">
        Lỗi: {error}
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

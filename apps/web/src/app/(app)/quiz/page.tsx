/**
 * /quiz — danh sách quizzes + action AI generate.
 *
 * Tương tự /flashcards: list cards click vào → attempt page. Có nút xoá.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Trash2, Play } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

import { QuizGenerateDialog } from '@/components/quiz/quiz-generate-dialog';
import { MasteryPanel } from '@/components/mastery/mastery-panel';
import { RecommendationsPanel } from '@/components/mastery/recommendations-panel';

type Quiz = {
  id: string;
  title: string;
  config: { types?: string[]; questionCount?: number };
  createdAt: string;
  questionCount: number;
};

export default function QuizzesPage() {
  const [quizzes, setQuizzes] = React.useState<Quiz[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    fetch('/api/quiz?limit=100')
      .then((r) => r.json())
      .then((d: { quizzes: Quiz[] }) => setQuizzes(d.quizzes))
      .finally(() => setLoading(false));
  }, [refresh]);

  const deleteQuiz = async (id: string) => {
    try {
      const res = await fetch(`/api/quiz/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setQuizzes((qs) => qs.filter((q) => q.id !== id));
      toast.success('Đã xoá');
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Quizzes</h1>
        <p className="text-sm text-muted-foreground">
          AI sinh đề kiểm tra (MCQ/đúng-sai/trả lời ngắn), chấm tự động + cập nhật
          mastery cho từng concept.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <QuizGenerateDialog />
        <Button variant="outline" onClick={() => setRefresh((r) => r + 1)}>
          Làm mới
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <RecommendationsPanel />
        <MasteryPanel />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Danh sách ({quizzes.length})</h2>
        {loading && <p className="text-sm text-muted-foreground">Đang tải...</p>}
        {!loading && quizzes.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            Chưa có quiz nào. Bấm <strong>AI generate</strong> để tạo.
          </Card>
        )}
        {quizzes.map((q) => (
          <Card key={q.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{q.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {q.questionCount} câu · {new Date(q.createdAt).toLocaleString('vi-VN')}
              </p>
            </div>
            <Link href={`/quiz/${q.id}/attempt`}>
              <Button size="sm" variant="default">
                <Play className="mr-1 h-3.5 w-3.5" />
                Làm bài
              </Button>
            </Link>
            <button
              onClick={() => deleteQuiz(q.id)}
              className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Xoá"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}

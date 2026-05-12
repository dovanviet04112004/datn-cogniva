/**
 * /exams — danh sách exam của user (owner-only ở Phase 16).
 *
 * Phase 17+ sẽ thêm tab "Được assign" cho student xem exam classroom.
 * Hiện tại chỉ list exam user tạo + button tạo mới.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Play, Pencil, Trash2, Clock, BarChart3 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton-list';

interface ExamRow {
  id: string;
  title: string;
  description: string | null;
  mode: string;
  status: 'DRAFT' | 'PUBLISHED' | 'IN_PROGRESS' | 'ENDED';
  durationSeconds: number | null;
  maxScore: number;
  maxAttempts: number;
  createdAt: string;
  publishedAt: string | null;
}

const MODE_LABEL: Record<string, string> = {
  PRACTICE: 'Luyện tập',
  TIMED: 'Có giờ',
  LIVE: 'Trực tiếp',
  ASYNC: 'Không đồng bộ',
  ADAPTIVE: 'Thích ứng',
  TOURNAMENT: 'Giải đấu',
};

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  PUBLISHED: 'bg-green-100 text-green-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  ENDED: 'bg-gray-100 text-gray-700',
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Nháp',
  PUBLISHED: 'Đã publish',
  IN_PROGRESS: 'Đang chạy',
  ENDED: 'Đã kết thúc',
};

export default function ExamsPage() {
  const [exams, setExams] = React.useState<ExamRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refresh, setRefresh] = React.useState(0);

  React.useEffect(() => {
    fetch('/api/exams')
      .then((r) => r.json())
      .then((d: { exams: ExamRow[] }) => setExams(d.exams))
      .catch(() => toast.error('Không load được exams'))
      .finally(() => setLoading(false));
  }, [refresh]);

  const deleteExam = async (id: string) => {
    if (!confirm('Xoá exam này? Tất cả attempt + response sẽ mất theo.')) return;
    try {
      const res = await fetch(`/api/exams/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setExams((xs) => xs.filter((x) => x.id !== id));
      toast.success('Đã xoá');
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Exams</h1>
          <p className="text-sm text-muted-foreground">
            Bài kiểm tra có lifecycle DRAFT → PUBLISHED, hỗ trợ Practice/Timed
            mode, auto-grade + AI grade. Khác Quiz V1: nhiều câu hỏi loại + anti-cheat.
          </p>
        </div>
        <Link href="/exams/new">
          <Button>
            <Plus className="mr-1 h-4 w-4" /> Tạo exam
          </Button>
        </Link>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Của bạn ({exams.length})</h2>
        {loading && <SkeletonList rows={4} />}
        {!loading && exams.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            Chưa có exam nào. Bấm <strong>Tạo exam</strong> để bắt đầu.
          </Card>
        )}
        {exams.map((e) => (
          <Card key={e.id} className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Link href={`/exams/${e.id}`} className="truncate text-sm font-medium hover:underline">
                  {e.title}
                </Link>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_COLOR[e.status] ?? ''}`}
                >
                  {STATUS_LABEL[e.status] ?? e.status}
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                <span>{MODE_LABEL[e.mode] ?? e.mode}</span>
                {e.durationSeconds && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {Math.round(e.durationSeconds / 60)} phút
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <BarChart3 className="h-3 w-3" />
                  {e.maxScore} điểm
                </span>
                <span>{new Date(e.createdAt).toLocaleDateString('vi-VN')}</span>
              </p>
            </div>
            {e.status === 'DRAFT' && (
              <Link href={`/exams/${e.id}`}>
                <Button size="sm" variant="outline">
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Soạn
                </Button>
              </Link>
            )}
            {e.status === 'PUBLISHED' && (
              <Link href={`/exams/${e.id}`}>
                <Button size="sm">
                  <Play className="mr-1 h-3.5 w-3.5" /> Làm bài
                </Button>
              </Link>
            )}
            <button
              onClick={() => deleteExam(e.id)}
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

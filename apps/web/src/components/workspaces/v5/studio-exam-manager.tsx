'use client';

import * as React from 'react';
import { ClipboardList, KeyRound, Loader2, Plus, Sparkles, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CreateExamDialog } from '@/components/exams/create-exam-dialog';
import { useExamPreview } from './exam-preview-context';

type ExamSummary = {
  id: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED' | 'IN_PROGRESS' | 'ENDED';
  mode: string;
};

type Props = {
  workspaceId: string;
  onBack: () => void;
};

type Tab = 'own' | 'join';

export function StudioExamManager({ workspaceId, onBack }: Props) {
  const examPreview = useExamPreview();
  const [tab, setTab] = React.useState<Tab>('own');
  const [createOpen, setCreateOpen] = React.useState(false);

  const examsVersion = examPreview?.examsVersion ?? 0;

  const { data: exams = [], isLoading: loading } = useQuery({
    queryKey: qk.workspaceExams(workspaceId, examsVersion),
    queryFn: () =>
      apiGet<{ owned: ExamSummary[] }>(`/api/exams?workspaceId=${workspaceId}`).then(
        (d) => d.owned ?? [],
      ),
  });

  return (
    <aside className="bg-card flex h-full flex-col overflow-hidden border-l">
      <header className="shrink-0 border-b px-3 py-2.5">
        <div className="flex items-center gap-2">
          <ClipboardList className="text-primary h-3.5 w-3.5" />
          <h2 className="flex-1 text-[13px] font-semibold tracking-tight">Bài thi</h2>
          <button
            type="button"
            onClick={onBack}
            aria-label="Quay lại Studio"
            title="Quay lại Studio"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="bg-muted/30 mt-2 inline-flex w-full rounded-md border p-0.5 text-[11px]">
          <TabButton
            active={tab === 'own'}
            onClick={() => setTab('own')}
            icon={<Users className="h-3 w-3" />}
            label="Của tôi"
          />
          <TabButton
            active={tab === 'join'}
            onClick={() => setTab('join')}
            icon={<KeyRound className="h-3 w-3" />}
            label="Nhập code"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-2.5">
        {tab === 'own' ? (
          <OwnExamsTab
            loading={loading}
            exams={exams}
            onCreate={() => setCreateOpen(true)}
            onOpen={(id) => examPreview?.open(id)}
          />
        ) : (
          <JoinTab onResolved={(id) => examPreview?.open(id)} />
        )}
      </div>

      <CreateExamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaceId={workspaceId}
        onCreated={(newExamId) => {
          setCreateOpen(false);
          examPreview?.bumpExamsVersion();
          examPreview?.open(newExamId);
        }}
      />
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function OwnExamsTab({
  loading,
  exams,
  onCreate,
  onOpen,
}: {
  loading: boolean;
  exams: ExamSummary[];
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        onClick={onCreate}
        className="border-primary/40 bg-primary/5 text-primary hover:bg-primary/10 mb-3 flex w-full items-center gap-2 rounded-lg border border-dashed p-2.5 text-left text-[12px] font-medium transition-colors"
      >
        <Plus className="h-4 w-4 shrink-0" />
        Tạo bài thi mới
      </button>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
        </div>
      ) : exams.length === 0 ? (
        <p className="text-muted-foreground px-2 py-4 text-center text-[11px]">
          Chưa có bài thi nào. Tạo mới ở trên ↑
        </p>
      ) : (
        <ul className="space-y-1">
          {exams.slice(0, 30).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => onOpen(e.id)}
                className="border-divider bg-card hover:border-primary/30 hover:bg-primary/5 flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors"
                title={e.title}
              >
                <ClipboardList className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{e.title}</p>
                  <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[11px]">
                    <span
                      className={cn(
                        'rounded px-1 py-0.5 font-semibold',
                        e.status === 'DRAFT'
                          ? 'bg-warning/10 text-warning'
                          : 'bg-success/10 text-success',
                      )}
                    >
                      {e.status}
                    </span>
                    <span className="bg-muted rounded px-1 py-0.5">{e.mode}</span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function JoinTab({ onResolved }: { onResolved: (examId: string) => void }) {
  const [code, setCode] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = code.trim().toUpperCase();
    if (cleaned.length < 4) {
      toast.error('Code phải có ít nhất 4 ký tự');
      return;
    }
    setSubmitting(true);
    try {
      const data = await apiSend<{ examId: string }>('/api/exams/join', 'POST', {
        code: cleaned,
      });
      toast.success('Đã vào exam');
      onResolved(data.examId);
      setCode('');
    } catch (err) {
      toast.error('Vào exam lỗi: ' + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="bg-muted/20 rounded-lg border p-3">
        <div className="mb-2 flex items-center gap-1.5">
          <Sparkles className="text-primary h-3 w-3" />
          <h3 className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider">
            Tham gia bài thi
          </h3>
        </div>
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          Nhập 6 ký tự code do giáo viên cung cấp. Exam sẽ mở trực tiếp ở Studio bên dưới — không
          rời workspace.
        </p>
      </div>

      <div>
        <label
          htmlFor="exam-code"
          className="text-muted-foreground mb-1 block text-[11px] font-medium"
        >
          Mã bài thi
        </label>
        <input
          id="exam-code"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABCDEF"
          maxLength={12}
          autoComplete="off"
          autoCapitalize="characters"
          className="border-input bg-background focus-visible:ring-ring block w-full rounded-md border px-3 py-2.5 text-center font-mono text-xl tracking-widest focus-visible:outline-none focus-visible:ring-1"
        />
      </div>

      <Button
        type="submit"
        size="sm"
        disabled={submitting || code.trim().length < 4}
        className="w-full"
      >
        {submitting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <KeyRound className="h-3.5 w-3.5" />
        )}
        {submitting ? 'Đang vào…' : 'Vào bài thi'}
      </Button>

      <p className="text-muted-foreground text-center text-[11px]">
        Hoặc click link chia sẻ giáo viên gửi — sẽ tự auto-redirect.
      </p>
    </form>
  );
}

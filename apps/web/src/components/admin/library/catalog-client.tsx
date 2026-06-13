'use client';

import * as React from 'react';
import {
  Check,
  GraduationCap,
  Loader2,
  Pencil,
  Plus,
  School,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { ALL_SUBJECTS } from '@cogniva/db/taxonomy';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/lib/use-confirm';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Tab = 'universities' | 'courses';

type University = {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  docCount: number;
  approved: boolean;
  createdAt: string;
};

type Course = {
  id: string;
  universityId: string | null;
  code: string | null;
  name: string;
  slug: string;
  subjectArea: string | null;
  docCount: number;
  approved: boolean;
  createdAt: string;
  universityName: string | null;
  universityShort: string | null;
};

const SUBJECT_LABEL: Record<string, string> = Object.fromEntries(
  ALL_SUBJECTS.map((s) => [s.slug, `${s.emoji} ${s.name}`]),
);

export function LibraryCatalogClient() {
  const [tab, setTab] = React.useState<Tab>('universities');

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Library catalog</h1>
        <p className="text-sm text-slate-400">
          Quản trị danh mục trường &amp; môn học. Mục do người dùng đề xuất hiện ở trạng thái “Chờ
          duyệt” — duyệt để đưa vào danh mục chung.
        </p>
      </header>

      <div className="flex items-center gap-1.5">
        <TabChip active={tab === 'universities'} onClick={() => setTab('universities')}>
          <School className="h-3.5 w-3.5" />
          Trường
        </TabChip>
        <TabChip active={tab === 'courses'} onClick={() => setTab('courses')}>
          <GraduationCap className="h-3.5 w-3.5" />
          Môn học
        </TabChip>
      </div>

      {tab === 'universities' ? <UniversitiesTab /> : <CoursesTab />}
    </div>
  );
}

function useDebouncedQ(value: string) {
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 300);
    return () => clearTimeout(t);
  }, [value]);
  return debounced;
}

function useUniversitiesQuery(debouncedQ: string) {
  return useQuery({
    queryKey: qk.adminLibraryUniversities(debouncedQ, true),
    queryFn: () =>
      apiGet<{ universities: University[] }>(
        `/api/admin/library/universities${debouncedQ ? `?q=${encodeURIComponent(debouncedQ)}` : ''}`,
      ),
  });
}

function UniversitiesTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = React.useState('');
  const debouncedQ = useDebouncedQ(q);
  const [dialog, setDialog] = React.useState<{ open: boolean; editing: University | null }>({
    open: false,
    editing: null,
  });

  const { data, isLoading } = useUniversitiesQuery(debouncedQ);
  const rows = data?.universities ?? [];

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin', 'library'] });

  const approve = async (u: University) => {
    try {
      await apiSend(`/api/admin/library/universities/${u.id}`, 'PATCH', { approved: true });
      toast.success(`Đã duyệt “${u.name}”`);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (u: University) => {
    const ok = await confirm({
      title: `Xoá trường “${u.name}”?`,
      description: 'Không thể hoàn tác. Chỉ xoá được khi trường không còn tài liệu hoặc môn học.',
      confirmLabel: 'Xoá',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiSend(`/api/admin/library/universities/${u.id}`, 'DELETE');
      toast.success(`Đã xoá “${u.name}”`);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <Toolbar
        q={q}
        setQ={setQ}
        placeholder="Tìm theo tên trường…"
        onAdd={() => setDialog({ open: true, editing: null })}
      />

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2.5">Tên</th>
              <th className="px-3 py-2.5">Số tài liệu</th>
              <th className="px-3 py-2.5">Trạng thái</th>
              <th className="px-3 py-2.5 text-right">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <LoadingRow colSpan={4} />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={4}>Không có trường khớp filter.</EmptyRow>
            ) : (
              rows.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-slate-800/60 transition-colors hover:bg-slate-800/40"
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-col leading-tight">
                      <span className="text-[13px] font-medium text-slate-100">{u.name}</span>
                      {u.shortName && (
                        <span className="font-mono text-[10.5px] text-slate-500">
                          {u.shortName}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-400">
                    {u.docCount.toLocaleString('vi-VN')}
                  </td>
                  <td className="px-3 py-2">
                    <ApprovedPill approved={u.approved} />
                  </td>
                  <td className="px-3 py-2">
                    <RowActions
                      pending={!u.approved}
                      onApprove={() => void approve(u)}
                      onEdit={() => setDialog({ open: true, editing: u })}
                      onDelete={() => void remove(u)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <UniversityDialog
        open={dialog.open}
        editing={dialog.editing}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSaved={() => {
          setDialog({ open: false, editing: null });
          invalidate();
        }}
      />
    </>
  );
}

function CoursesTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = React.useState('');
  const debouncedQ = useDebouncedQ(q);
  const [universityId, setUniversityId] = React.useState<string | null>(null);
  const [dialog, setDialog] = React.useState<{ open: boolean; editing: Course | null }>({
    open: false,
    editing: null,
  });

  const universitiesQuery = useUniversitiesQuery('');
  const universities = universitiesQuery.data?.universities ?? [];

  const { data, isLoading } = useQuery({
    queryKey: qk.adminLibraryCourses(debouncedQ, universityId, true),
    queryFn: () => {
      const p = new URLSearchParams();
      if (debouncedQ) p.set('q', debouncedQ);
      if (universityId) p.set('universityId', universityId);
      const qs = p.toString();
      return apiGet<{ courses: Course[] }>(`/api/admin/library/courses${qs ? `?${qs}` : ''}`);
    },
  });
  const rows = data?.courses ?? [];

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['admin', 'library'] });

  const approve = async (c: Course) => {
    try {
      await apiSend(`/api/admin/library/courses/${c.id}`, 'PATCH', { approved: true });
      toast.success(`Đã duyệt “${c.name}”`);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (c: Course) => {
    const ok = await confirm({
      title: `Xoá môn “${c.name}”?`,
      description: 'Không thể hoàn tác. Chỉ xoá được khi môn học không còn tài liệu.',
      confirmLabel: 'Xoá',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiSend(`/api/admin/library/courses/${c.id}`, 'DELETE');
      toast.success(`Đã xoá “${c.name}”`);
      invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Toolbar
          q={q}
          setQ={setQ}
          placeholder="Tìm theo tên môn…"
          onAdd={() => setDialog({ open: true, editing: null })}
        />
        <select
          value={universityId ?? ''}
          onChange={(e) => setUniversityId(e.target.value || null)}
          className="h-9 cursor-pointer rounded-md border border-slate-800 bg-slate-900 px-3 text-sm text-slate-100 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
        >
          <option value="">Mọi trường</option>
          {universities.map((u) => (
            <option key={u.id} value={u.id}>
              {u.shortName ?? u.name}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/30">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 bg-slate-900/80 backdrop-blur">
            <tr className="border-b border-slate-800 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              <th className="px-3 py-2.5">Tên</th>
              <th className="px-3 py-2.5">Trường</th>
              <th className="px-3 py-2.5">Lĩnh vực</th>
              <th className="px-3 py-2.5">Số tài liệu</th>
              <th className="px-3 py-2.5">Trạng thái</th>
              <th className="px-3 py-2.5 text-right">Hành động</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <LoadingRow colSpan={6} />
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={6}>Không có môn học khớp filter.</EmptyRow>
            ) : (
              rows.map((c) => (
                <tr
                  key={c.id}
                  className="border-b border-slate-800/60 transition-colors hover:bg-slate-800/40"
                >
                  <td className="px-3 py-2">
                    <div className="flex flex-col leading-tight">
                      <span className="text-[13px] font-medium text-slate-100">{c.name}</span>
                      {c.code && (
                        <span className="font-mono text-[10.5px] text-slate-500">{c.code}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[12px] text-slate-400">
                    {c.universityShort ?? c.universityName ?? (
                      <span className="text-slate-600">— Chung —</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-[12px] text-slate-400">
                    {c.subjectArea ? (
                      (SUBJECT_LABEL[c.subjectArea] ?? c.subjectArea)
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-slate-400">
                    {c.docCount.toLocaleString('vi-VN')}
                  </td>
                  <td className="px-3 py-2">
                    <ApprovedPill approved={c.approved} />
                  </td>
                  <td className="px-3 py-2">
                    <RowActions
                      pending={!c.approved}
                      onApprove={() => void approve(c)}
                      onEdit={() => setDialog({ open: true, editing: c })}
                      onDelete={() => void remove(c)}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <CourseDialog
        open={dialog.open}
        editing={dialog.editing}
        universities={universities}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        onSaved={() => {
          setDialog({ open: false, editing: null });
          invalidate();
        }}
      />
    </>
  );
}

function Toolbar({
  q,
  setQ,
  placeholder,
  onAdd,
}: {
  q: string;
  setQ: (v: string) => void;
  placeholder: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[200px] max-w-md flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full rounded-md border border-slate-800 bg-slate-900 pl-8 pr-7 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-sm p-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-3 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20"
      >
        <Plus className="h-3.5 w-3.5" />
        Thêm
      </button>
    </div>
  );
}

function RowActions({
  pending,
  onApprove,
  onEdit,
  onDelete,
}: {
  pending: boolean;
  onApprove: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-1">
      {pending && (
        <button
          type="button"
          onClick={onApprove}
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20"
        >
          <Check className="h-3 w-3" />
          Duyệt
        </button>
      )}
      <button
        type="button"
        onClick={onEdit}
        aria-label="Sửa"
        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Xoá"
        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ApprovedPill({ approved }: { approved: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
        approved
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      )}
    >
      {approved ? 'Đã duyệt' : 'Chờ duyệt'}
    </span>
  );
}

function TabChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
        active
          ? 'border-red-500/40 bg-red-500/10 text-red-300'
          : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-700 hover:text-slate-200',
      )}
    >
      {children}
    </button>
  );
}

function LoadingRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center text-slate-500">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </td>
    </tr>
  );
}

function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center text-xs text-slate-500">
        {children}
      </td>
    </tr>
  );
}

const fieldClass =
  'mt-1 h-9 w-full rounded-md border border-slate-800 bg-slate-950 px-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-500/40 focus:outline-none focus:ring-2 focus:ring-red-500/20';
const labelClass = 'block text-[11px] font-medium text-slate-300';

function UniversityDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: University | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState('');
  const [shortName, setShortName] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setShortName(editing?.shortName ?? '');
    }
  }, [open, editing]);

  const submit = async () => {
    if (name.trim().length < 2) {
      toast.error('Tên trường cần ≥ 2 ký tự');
      return;
    }
    setLoading(true);
    try {
      const body = {
        name: name.trim(),
        shortName: shortName.trim() || undefined,
        approved: true,
      };
      if (editing) {
        await apiSend(`/api/admin/library/universities/${editing.id}`, 'PATCH', body);
        toast.success(`Đã cập nhật “${body.name}”`);
      } else {
        await apiSend('/api/admin/library/universities', 'POST', body);
        toast.success(`Đã tạo “${body.name}”`);
      }
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Sửa trường' : 'Thêm trường'}</DialogTitle>
          <DialogDescription className="text-xs">
            Trường được duyệt sẽ xuất hiện trong danh mục chung khi người dùng tải tài liệu.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className={labelClass}>
              Tên <span className="text-red-400">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="vd: Đại học Bách khoa Hà Nội"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>Tên viết tắt</label>
            <input
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              placeholder="vd: HUST"
              className={fieldClass}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Huỷ
          </Button>
          <Button
            onClick={submit}
            disabled={loading}
            className="bg-red-500 text-white hover:bg-red-600"
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Đang lưu…
              </>
            ) : (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                {editing ? 'Lưu' : 'Tạo'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CourseDialog({
  open,
  editing,
  universities,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: Course | null;
  universities: University[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [universityId, setUniversityId] = React.useState('');
  const [subjectArea, setSubjectArea] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setCode(editing?.code ?? '');
      setUniversityId(editing?.universityId ?? '');
      setSubjectArea(editing?.subjectArea ?? '');
    }
  }, [open, editing]);

  const submit = async () => {
    if (name.trim().length < 2) {
      toast.error('Tên môn cần ≥ 2 ký tự');
      return;
    }
    setLoading(true);
    try {
      const body = {
        name: name.trim(),
        code: code.trim() || undefined,
        universityId: universityId || undefined,
        subjectArea: subjectArea || undefined,
        approved: true,
      };
      if (editing) {
        await apiSend(`/api/admin/library/courses/${editing.id}`, 'PATCH', body);
        toast.success(`Đã cập nhật “${body.name}”`);
      } else {
        await apiSend('/api/admin/library/courses', 'POST', body);
        toast.success(`Đã tạo “${body.name}”`);
      }
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Sửa môn học' : 'Thêm môn học'}</DialogTitle>
          <DialogDescription className="text-xs">
            Gắn môn vào một trường, hoặc để “Môn chung” nếu không thuộc trường nào.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className={labelClass}>
              Tên <span className="text-red-400">*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="vd: Giải tích 1"
              className={fieldClass}
            />
          </div>
          <div>
            <label className={labelClass}>Mã môn</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="vd: MI1111"
              className={cn(fieldClass, 'font-mono')}
            />
          </div>
          <div>
            <label className={labelClass}>Trường</label>
            <select
              value={universityId}
              onChange={(e) => setUniversityId(e.target.value)}
              className={cn(fieldClass, 'cursor-pointer')}
            >
              <option value="">— Môn chung (không thuộc trường) —</option>
              {universities.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.shortName ? ` (${u.shortName})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Lĩnh vực</label>
            <select
              value={subjectArea}
              onChange={(e) => setSubjectArea(e.target.value)}
              className={cn(fieldClass, 'cursor-pointer')}
            >
              <option value="">— Không —</option>
              {ALL_SUBJECTS.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.emoji} {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Huỷ
          </Button>
          <Button
            onClick={submit}
            disabled={loading}
            className="bg-red-500 text-white hover:bg-red-600"
          >
            {loading ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Đang lưu…
              </>
            ) : (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                {editing ? 'Lưu' : 'Tạo'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

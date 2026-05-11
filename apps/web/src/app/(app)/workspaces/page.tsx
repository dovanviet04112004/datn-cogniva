/**
 * /workspaces — list workspace + tạo + rename + delete.
 *
 * Mỗi workspace card:
 *   - Tên + description
 *   - Số document
 *   - Edit/Delete buttons
 *
 * "Default" workspace tự tạo khi user upload PDF đầu tiên (xem lib/workspace.ts).
 */
'use client';

import * as React from 'react';
import { BookOpen, Edit2, FileText, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

type Workspace = {
  id: string;
  name: string;
  description: string | null;
  documentCount: number;
  createdAt: string;
};

export default function WorkspacesPage() {
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showForm, setShowForm] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');

  const refresh = React.useCallback(() => {
    setLoading(true);
    fetch('/api/workspaces')
      .then((r) => r.json())
      .then((d: { workspaces: Workspace[] }) => setWorkspaces(d.workspaces))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const createWs = async () => {
    if (!name.trim()) return toast.error('Cần tên workspace');
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setName('');
      setDescription('');
      setShowForm(false);
      refresh();
      toast.success('Đã tạo');
    } catch (err) {
      toast.error('Tạo thất bại: ' + (err as Error).message);
    }
  };

  const saveRename = async (id: string) => {
    if (!editName.trim()) return;
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setEditingId(null);
      refresh();
    } catch (err) {
      toast.error('Rename thất bại: ' + (err as Error).message);
    }
  };

  const deleteWs = async (id: string) => {
    if (!confirm('Xoá workspace này? Mọi document bên trong sẽ bị xoá theo.'))
      return;
    try {
      const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `status ${res.status}`);
      }
      refresh();
      toast.success('Đã xoá');
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <BookOpen className="h-6 w-6" />
            Workspaces
          </h1>
          <p className="text-sm text-muted-foreground">
            Gom document theo môn / dự án. Chat &amp; quiz có thể scope theo
            workspace để retrieval chính xác hơn.
          </p>
        </div>
        <Button onClick={() => setShowForm((s) => !s)}>
          {showForm ? <X className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
          {showForm ? 'Đóng' : 'Workspace mới'}
        </Button>
      </div>

      {showForm && (
        <Card className="space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="wname">Tên workspace</Label>
            <input
              id="wname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vd: Hệ phân tán, Toán cao cấp, ..."
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wdesc">Mô tả (optional)</Label>
            <textarea
              id="wdesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <Button onClick={createWs} className="w-full">
            Tạo
          </Button>
        </Card>
      )}

      {loading && <p className="text-sm text-muted-foreground">Đang tải...</p>}
      {!loading && workspaces.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Chưa có workspace. Upload 1 PDF sẽ tự tạo &ldquo;Default&rdquo;.
        </Card>
      )}

      <div className="space-y-2">
        {workspaces.map((w) => (
          <Card key={w.id} className="p-4">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-0.5">
                {editingId === w.id ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename(w.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="flex-1 rounded-md border bg-background px-2 py-1 text-sm font-medium"
                    />
                    <Button size="sm" onClick={() => saveRename(w.id)}>
                      Lưu
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Hủy
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm font-medium">{w.name}</p>
                )}
                {w.description && (
                  <p className="text-xs text-muted-foreground">{w.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {w.documentCount} document · tạo{' '}
                  {new Date(w.createdAt).toLocaleDateString('vi-VN')}
                </p>
              </div>
              {editingId !== w.id && (
                <>
                  <button
                    onClick={() => {
                      setEditingId(w.id);
                      setEditName(w.name);
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label="Rename"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => deleteWs(w.id)}
                    className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label="Xoá"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * /groups — list groups của user + form tạo mới + join by code.
 *
 * Mỗi group card → /groups/[id] xem chi tiết + members.
 * Phase 9 v1: chỉ list + invite code visible; chưa share workspace.
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Plus, Users, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

type Group = {
  id: string;
  name: string;
  description: string | null;
  inviteCode: string;
  myRole: 'OWNER' | 'MEMBER';
  memberCount: number;
  createdAt: string;
};

export default function GroupsPage() {
  const [groups, setGroups] = React.useState<Group[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [joinCode, setJoinCode] = React.useState('');

  const refresh = React.useCallback(() => {
    setLoading(true);
    fetch('/api/groups')
      .then((r) => r.json())
      .then((d: { groups: Group[] }) => setGroups(d.groups))
      .finally(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const createGroup = async () => {
    if (!name.trim()) {
      toast.error('Cần tên group');
      return;
    }
    try {
      const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      toast.success('Tạo group thành công');
      setName('');
      setDescription('');
      setShowCreate(false);
      refresh();
    } catch (err) {
      toast.error('Tạo thất bại: ' + (err as Error).message);
    }
  };

  const joinGroup = async () => {
    if (!joinCode.trim()) return;
    try {
      const res = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: joinCode.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? `status ${res.status}`);
      }
      toast.success('Joined!');
      setJoinCode('');
      refresh();
    } catch (err) {
      toast.error('Join thất bại: ' + (err as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Users className="h-6 w-6" />
            Study Groups
          </h1>
          <p className="text-sm text-muted-foreground">
            Tham gia hoặc tạo nhóm học để cùng theo dõi tiến độ. (Phase 9: list +
            invite; share workspace ở Phase 10+)
          </p>
        </div>
        <Button onClick={() => setShowCreate((s) => !s)}>
          {showCreate ? <X className="mr-1 h-4 w-4" /> : <Plus className="mr-1 h-4 w-4" />}
          {showCreate ? 'Đóng' : 'Group mới'}
        </Button>
      </div>

      {showCreate && (
        <Card className="space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="gname">Tên group</Label>
            <input
              id="gname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vd: Lớp Hệ phân tán K65"
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gdesc">Mô tả (optional)</Label>
            <textarea
              id="gdesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            />
          </div>
          <Button onClick={createGroup} className="w-full">
            Tạo
          </Button>
        </Card>
      )}

      <Card className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
        <Label htmlFor="join" className="sm:w-auto">
          Join bằng code
        </Label>
        <input
          id="join"
          value={joinCode}
          onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          placeholder="ABCD1234"
          className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm font-mono uppercase"
        />
        <Button onClick={joinGroup} disabled={!joinCode.trim()} size="sm">
          Join
        </Button>
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Group của bạn ({groups.length})</h2>
        {loading && <p className="text-sm text-muted-foreground">Đang tải...</p>}
        {!loading && groups.length === 0 && (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Chưa có group nào. Tạo mới hoặc join bằng invite code.
          </Card>
        )}
        {groups.map((g) => (
          <Card key={g.id} className="p-3">
            <Link href={`/groups/${g.id}`} className="block hover:opacity-80">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{g.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {g.memberCount} thành viên · Code:{' '}
                    <span className="font-mono">{g.inviteCode}</span> ·{' '}
                    {g.myRole === 'OWNER' ? 'Bạn là Owner' : 'Member'}
                  </p>
                </div>
              </div>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}

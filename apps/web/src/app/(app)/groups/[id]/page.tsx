/**
 * /groups/[id] — chi tiết group + danh sách thành viên + invite code copy.
 *
 * Quyền:
 *   - MEMBER: xem info + members
 *   - OWNER: thêm xoá group
 */
'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Loader2, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type PageProps = { params: Promise<{ id: string }> };

type Member = {
  userId: string;
  name: string | null;
  image: string | null;
  role: 'OWNER' | 'MEMBER';
  joinedAt: string;
};

type GroupData = {
  group: {
    id: string;
    name: string;
    description: string | null;
    inviteCode: string;
    ownerUserId: string;
    createdAt: string;
  };
  members: Member[];
  myRole: 'OWNER' | 'MEMBER';
};

export default function GroupDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const router = useRouter();
  const [data, setData] = React.useState<GroupData | null>(null);

  React.useEffect(() => {
    fetch(`/api/groups/${id}`).then(async (r) => {
      if (!r.ok) {
        toast.error('Không xem được group');
        router.push('/groups');
        return;
      }
      setData(await r.json());
    });
  }, [id, router]);

  const copyInvite = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.group.inviteCode);
    toast.success('Đã copy invite code');
  };

  const deleteGroup = async () => {
    if (!confirm('Xoá group này? Hành động không thể hoàn tác.')) return;
    try {
      const res = await fetch(`/api/groups/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      toast.success('Đã xoá');
      router.push('/groups');
    } catch (err) {
      toast.error('Xoá thất bại: ' + (err as Error).message);
    }
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center p-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Đang tải...
      </div>
    );
  }

  const { group, members, myRole } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <Link href="/groups">
        <Button variant="ghost" size="sm">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Về danh sách
        </Button>
      </Link>

      <Card className="space-y-3 p-6">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <Users className="h-5 w-5" />
              {group.name}
            </h1>
            {group.description && (
              <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
            )}
          </div>
          {myRole === 'OWNER' && (
            <Button onClick={deleteGroup} variant="destructive" size="sm">
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Xoá group
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
          <span className="text-xs text-muted-foreground">Invite code:</span>
          <code className="font-mono text-sm font-bold">{group.inviteCode}</code>
          <Button onClick={copyInvite} size="sm" variant="ghost" className="ml-auto h-7 px-2">
            <Copy className="mr-1 h-3 w-3" />
            Copy
          </Button>
        </div>
      </Card>

      <Card className="space-y-2 p-4">
        <h2 className="text-sm font-semibold">Thành viên ({members.length})</h2>
        <ul className="space-y-1">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 rounded-md p-2 hover:bg-muted/50">
              <Avatar className="h-8 w-8">
                <AvatarImage src={m.image ?? undefined} alt={m.name ?? ''} />
                <AvatarFallback>{(m.name ?? 'U')[0]?.toUpperCase()}</AvatarFallback>
              </Avatar>
              <Link
                href={`/profile/${m.userId}`}
                className="flex-1 truncate text-sm font-medium hover:underline"
              >
                {m.name ?? 'Anonymous'}
              </Link>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                  m.role === 'OWNER'
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {m.role}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

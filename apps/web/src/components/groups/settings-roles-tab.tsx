'use client';

import * as React from 'react';
import {
  ChevronRight,
  Hash,
  Loader2,
  Plus,
  Save,
  Shield,
  Sparkles,
  Trash2,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  ALL_PERMISSION_KEYS,
  type PermissionKey,
  type PermissionMap,
} from '@/lib/group/permission-keys';
import { useConfirm } from '@/lib/use-confirm';

type Role = {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: PermissionMap;
  hoisted: boolean;
  mentionable: boolean;
  isManaged: boolean;
  legacyRole: string | null;
  memberCount: number;
};

type PermissionGroup = {
  title: string;
  icon: typeof Shield;
  keys: { key: PermissionKey; label: string; desc: string }[];
};

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'Quản trị',
    icon: Shield,
    keys: [
      { key: 'manageGroup', label: 'Quản lý group', desc: 'Sửa tên, mô tả, icon' },
      { key: 'manageRoles', label: 'Quản lý role', desc: 'Tạo / sửa / xoá role' },
      { key: 'manageChannels', label: 'Quản lý channel', desc: 'Tạo / sửa / xoá channel' },
      { key: 'viewAuditLog', label: 'Xem audit log', desc: 'Lịch sử mod action' },
    ],
  },
  {
    title: 'Thành viên',
    icon: Users,
    keys: [
      { key: 'kickMembers', label: 'Kick member', desc: 'Đuổi member ra khỏi group' },
      { key: 'banMembers', label: 'Ban member', desc: 'Cấm vĩnh viễn' },
      { key: 'inviteMembers', label: 'Tạo invite link', desc: 'Phát hành mã mời' },
      { key: 'changeNickname', label: 'Đổi nickname', desc: 'Đặt biệt danh cho member' },
    ],
  },
  {
    title: 'Text channel',
    icon: Hash,
    keys: [
      { key: 'viewChannel', label: 'Xem channel', desc: 'Thấy channel trong sidebar' },
      { key: 'sendMessages', label: 'Gửi tin nhắn', desc: 'Chat trong channel' },
      { key: 'sendMessagesInThreads', label: 'Gửi trong thread', desc: 'Reply thread' },
      { key: 'embedLinks', label: 'Embed link', desc: 'Hiện preview link' },
      { key: 'attachFiles', label: 'Đính kèm file', desc: 'Upload file/ảnh' },
      { key: 'addReactions', label: 'Reaction', desc: 'Thả emoji vào tin nhắn' },
      { key: 'useExternalEmoji', label: 'External emoji', desc: 'Dùng emoji ngoài server' },
      { key: 'mentionEveryone', label: 'Mention @everyone', desc: 'Ping tất cả member' },
      { key: 'manageMessages', label: 'Quản lý tin nhắn', desc: 'Xoá / pin tin của người khác' },
      { key: 'manageThreads', label: 'Quản lý thread', desc: 'Đóng / archive thread' },
    ],
  },
  {
    title: 'Voice channel',
    icon: Volume2,
    keys: [
      { key: 'connect', label: 'Kết nối voice', desc: 'Join voice channel' },
      { key: 'speak', label: 'Nói', desc: 'Bật mic được' },
      { key: 'video', label: 'Bật cam', desc: 'Chia sẻ camera' },
      { key: 'screenShare', label: 'Share màn hình', desc: 'Stream desktop' },
      { key: 'muteMembers', label: 'Mute người khác', desc: 'Tắt mic member khác' },
      { key: 'deafenMembers', label: 'Deafen', desc: 'Bịt tai member' },
      { key: 'moveMembers', label: 'Move / kick voice', desc: 'Đuổi khỏi voice channel' },
    ],
  },
  {
    title: 'Stage',
    icon: Sparkles,
    keys: [
      { key: 'requestToSpeak', label: 'Xin nói (stage)', desc: 'Raise hand trong stage' },
      { key: 'moderateStage', label: 'Mod stage', desc: 'Promote speaker' },
    ],
  },
];

const COLOR_PRESETS = [
  '#9aa3af',
  '#ef4444',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#14b8a6',
  '#f97316',
];

export function SettingsRolesTab({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<Role | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);

  const {
    data,
    isLoading: loading,
    error,
  } = useQuery({
    queryKey: qk.groupRoles(groupId),
    queryFn: () =>
      apiGet<{ roles: Role[] }>(`/api/groups/${groupId}/roles`).then((d) => d.roles ?? []),
  });
  const roles = data ?? [];

  React.useEffect(() => {
    if (error) toast.error('Load roles lỗi');
  }, [error]);

  const refresh = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.groupRoles(groupId) });
  }, [qc, groupId]);

  return (
    <div className="space-y-3">
      <Card className="flex items-center justify-between p-3">
        <div>
          <h3 className="text-sm font-semibold">Roles</h3>
          <p className="text-muted-foreground text-xs">
            Tạo role tuỳ chỉnh với màu + quyền hạn riêng. Role mặc định (Chủ nhóm / Quản trị / Điều
            hành / Thành viên) không xoá được.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="mr-1 h-3.5 w-3.5" />
          Tạo role
        </Button>
      </Card>

      {loading ? (
        <Card className="text-muted-foreground flex items-center justify-center gap-2 p-8 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải...
        </Card>
      ) : (
        <Card className="divide-y p-0">
          {roles.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setEditing(r)}
              className="hover:bg-muted/40 flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors"
            >
              <span
                className="ring-background h-3 w-3 shrink-0 rounded-full ring-2"
                style={{ backgroundColor: r.color }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: r.color }}>
                  {r.name}
                </p>
                <p className="text-muted-foreground text-[10.5px]">
                  {r.memberCount} member · position {r.position}
                  {r.hoisted && ' · hoisted'}
                  {r.mentionable && ' · mentionable'}
                </p>
              </div>
              {r.isManaged && (
                <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Mặc định
                </span>
              )}
              <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
            </button>
          ))}
        </Card>
      )}

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        groupId={groupId}
        onCreated={(role) => {
          qc.setQueryData<Role[]>(qk.groupRoles(groupId), (prev) =>
            [role, ...(prev ?? [])].sort((a, b) => b.position - a.position),
          );
          setCreateOpen(false);
          setEditing(role);
        }}
      />

      {editing && (
        <RoleEditor
          groupId={groupId}
          role={editing}
          onClose={() => setEditing(null)}
          onChange={refresh}
        />
      )}
    </div>
  );
}

function CreateRoleDialog({
  open,
  onOpenChange,
  groupId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groupId: string;
  onCreated: (role: Role) => void;
}) {
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('#9aa3af');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      setName('');
      setColor('#9aa3af');
    }
  }, [open]);

  const create = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), color }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const { role } = (await res.json()) as { role: Role };
      toast.success('Đã tạo role');
      onCreated({ ...role, memberCount: 0 });
    } catch (err) {
      toast.error('Tạo lỗi: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tạo role mới</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="role-name">Tên role</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Vd: Học sinh giỏi, Trợ giảng…"
              maxLength={50}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Màu sắc</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    'ring-background h-7 w-7 rounded-full ring-2 transition-all',
                    color === c ? 'ring-foreground/40 scale-110' : 'opacity-80 hover:opacity-100',
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Màu ${c}`}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-7 w-7 cursor-pointer rounded-full border-0 bg-transparent p-0"
                aria-label="Custom color"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button onClick={create} disabled={saving || !name.trim()}>
            {saving ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1 h-3.5 w-3.5" />
            )}
            Tạo role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleEditor({
  groupId,
  role,
  onClose,
  onChange,
}: {
  groupId: string;
  role: Role;
  onClose: () => void;
  onChange: () => void;
}) {
  const confirm = useConfirm();
  const [name, setName] = React.useState(role.name);
  const [color, setColor] = React.useState(role.color);
  const [hoisted, setHoisted] = React.useState(role.hoisted);
  const [mentionable, setMentionable] = React.useState(role.mentionable);
  const [perms, setPerms] = React.useState<PermissionMap>(role.permissions ?? {});
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const toggle = (k: PermissionKey) => {
    setPerms((prev) => ({ ...prev, [k]: !prev[k] }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const cleanPerms: PermissionMap = {};
      for (const k of ALL_PERMISSION_KEYS) {
        if (perms[k]) cleanPerms[k] = true;
      }
      const body: Record<string, unknown> = {
        color,
        hoisted,
        mentionable,
        permissions: cleanPerms,
      };
      if (!role.isManaged) body.name = name.trim();
      const res = await fetch(`/api/groups/${groupId}/roles/${role.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      toast.success('Đã lưu');
      onChange();
      onClose();
    } catch (err) {
      toast.error('Lưu lỗi: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Xoá role "${role.name}"?`,
      description:
        'Members đang giữ role này sẽ mất quyền tương ứng. Channel permission override gắn với role cũng bị xoá.',
      confirmLabel: 'Xoá role',
      variant: 'destructive',
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/roles/${role.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      toast.success('Đã xoá');
      onChange();
      onClose();
    } catch (err) {
      toast.error('Xoá lỗi: ' + (err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-[92vw] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-5 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            <span
              className="ring-background h-3 w-3 rounded-full ring-2"
              style={{ backgroundColor: color }}
            />
            Sửa role: <span style={{ color }}>{role.name}</span>
            {role.isManaged && (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                Mặc định
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-5 grid gap-4 sm:grid-cols-[2fr_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="r-name">Tên</Label>
              <Input
                id="r-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={role.isManaged}
                maxLength={50}
              />
              {role.isManaged && (
                <p className="text-muted-foreground text-[10.5px]">
                  Role mặc định không đổi tên được.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Màu</Label>
              <div className="flex flex-wrap gap-1.5">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      'ring-background h-6 w-6 rounded-full ring-2 transition-all',
                      color === c ? 'ring-foreground/40 scale-110' : 'opacity-80 hover:opacity-100',
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-6 w-6 cursor-pointer rounded-full border-0 bg-transparent p-0"
                />
              </div>
            </div>
          </div>

          <div className="mb-5 grid gap-2 sm:grid-cols-2">
            <label className="hover:bg-muted/30 flex cursor-pointer items-start gap-2 rounded-md border p-3">
              <input
                type="checkbox"
                checked={hoisted}
                onChange={(e) => setHoisted(e.target.checked)}
                className="mt-1"
              />
              <div className="text-xs">
                <div className="font-medium">Hoisted</div>
                <div className="text-muted-foreground text-[10.5px]">
                  Member group này hiện tách riêng trong member list
                </div>
              </div>
            </label>
            <label className="hover:bg-muted/30 flex cursor-pointer items-start gap-2 rounded-md border p-3">
              <input
                type="checkbox"
                checked={mentionable}
                onChange={(e) => setMentionable(e.target.checked)}
                className="mt-1"
              />
              <div className="text-xs">
                <div className="font-medium">Mentionable</div>
                <div className="text-muted-foreground text-[10.5px]">
                  Member khác có thể @role này
                </div>
              </div>
            </label>
          </div>

          <div className="space-y-4">
            {PERMISSION_GROUPS.map((g) => {
              const Icon = g.icon;
              return (
                <div key={g.title}>
                  <div className="text-muted-foreground mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider">
                    <Icon className="h-3 w-3" />
                    {g.title}
                  </div>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {g.keys.map((k) => (
                      <PermissionToggle
                        key={k.key}
                        label={k.label}
                        desc={k.desc}
                        checked={Boolean(perms[k.key])}
                        onChange={() => toggle(k.key)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="bg-muted/20 flex shrink-0 items-center justify-between gap-2 border-t px-5 py-3">
          {!role.isManaged && (
            <Button
              variant="outline"
              onClick={remove}
              disabled={deleting}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {deleting ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3.5 w-3.5" />
              )}
              Xoá role
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={onClose}>
              <X className="mr-1 h-3.5 w-3.5" />
              Huỷ
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 h-3.5 w-3.5" />
              )}
              Lưu
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function PermissionToggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-md border p-2.5 transition-colors',
        checked ? 'border-primary/30 bg-primary/5' : 'border-divider hover:bg-muted/30',
      )}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium leading-tight">{label}</p>
        <p className="text-muted-foreground mt-0.5 line-clamp-1 text-[10.5px]">{desc}</p>
      </div>
    </label>
  );
}

/**
 * GroupSettings — client tabs (Overview / Channels / Members / Invites).
 *
 * Layout: full-width inside main column (đã có 3-col layout từ group/[id]/layout).
 * Mỗi tab self-fetch data riêng để không lock toàn page khi 1 endpoint chậm.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  ChevronDown,
  Copy,
  Folder,
  FolderOpen,
  Hash,
  History,
  Info,
  Link2,
  Loader2,
  ShieldCheck,
  Trash2,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiSend } from '@cogniva/shared/api';
import { qk } from '@cogniva/shared/query';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { GroupRole } from '@/lib/group/permissions';
import { useConfirm, usePrompt } from '@/lib/use-confirm';
import { SettingsRolesTab } from './settings-roles-tab';

type Props = {
  groupId: string;
  myRole: 'OWNER' | 'ADMIN';
  currentUserId: string;
  /**
   * Chế độ MODAL (overlay) — parent giữ state mở/đóng. Khi truyền, đóng modal
   * KHÔNG điều hướng route → channel/tin nhắn phía dưới giữ nguyên (không reload).
   * Khi KHÔNG truyền (mở qua route /groups/[id]/settings cho deep-link), đóng =
   * router.push về group như cũ.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Tab mở sẵn khi bật modal (vd quick-action "Category" → 'categories'). */
  initialTab?: TabKey;
};

type TabKey =
  | 'overview'
  | 'roles'
  | 'channels'
  | 'categories'
  | 'members'
  | 'invites'
  | 'audit';

const TAB_SECTIONS: Array<{
  group: string;
  items: Array<{
    key: TabKey;
    label: string;
    description: string;
    icon: typeof Info;
  }>;
}> = [
  {
    group: 'Cấu hình nhóm',
    items: [
      { key: 'overview', label: 'Tổng quan', description: 'Tên, mô tả, log recording', icon: Info },
      { key: 'roles', label: 'Vai trò', description: 'Quản lý role tuỳ chỉnh + quyền', icon: ShieldCheck },
      { key: 'categories', label: 'Danh mục', description: 'Gom channel theo chủ đề', icon: Folder },
      { key: 'channels', label: 'Channels', description: 'Danh sách channel + xoá', icon: Hash },
    ],
  },
  {
    group: 'Cộng đồng',
    items: [
      { key: 'members', label: 'Thành viên', description: 'Role, mute, kick', icon: Users },
      { key: 'invites', label: 'Lời mời', description: 'Tạo + revoke invite code', icon: Link2 },
    ],
  },
  {
    group: 'Theo dõi',
    items: [
      { key: 'audit', label: 'Lịch sử hoạt động', description: 'Mod actions audit log', icon: History },
    ],
  },
];

export function GroupSettings({
  groupId,
  myRole,
  currentUserId,
  open,
  onOpenChange,
  initialTab,
}: Props) {
  const router = useRouter();
  const [active, setActive] = React.useState<TabKey>(initialTab ?? 'overview');

  // Đồng bộ tab khi parent đổi initialTab lúc mở lại modal (vd bấm "Category"
  // mở thẳng tab Danh mục thay vì Tổng quan).
  React.useEffect(() => {
    if (open && initialTab) setActive(initialTab);
  }, [open, initialTab]);

  // Mở như "trang đè lên" giống recipe overlay của workspace: Dialog to bo góc +
  // backdrop blur, KHÔNG edge-to-edge. DialogContent tự lo nút X / Esc / click-nền.
  // 2 chế độ đóng:
  //  - MODAL (parent truyền onOpenChange): đóng = onOpenChange(false), KHÔNG đổi
  //    route → channel phía dưới không unmount, KHÔNG reload tin nhắn (Discord-style).
  //  - ROUTE (deep-link /groups/[id]/settings): open mặc định true, đóng = về group.
  const controlled = onOpenChange !== undefined;
  const isOpen = controlled ? open ?? false : true;
  const handleOpenChange = (o: boolean) => {
    if (controlled) {
      onOpenChange!(o);
      return;
    }
    if (!o) router.push(`/groups/${groupId}`);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[88vh] w-[92vw] max-w-5xl flex-col gap-0 overflow-hidden rounded-2xl p-0">
        <DialogTitle className="sr-only">Cài đặt nhóm</DialogTitle>

        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-divider px-4 pr-14 sm:px-6 sm:pr-14">
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold tracking-tight">Cài đặt nhóm</h1>
            <p className="hidden text-[11px] text-text-muted sm:block">
              Quản trị viên: tinh chỉnh nhóm, role, thành viên, audit log
            </p>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
        {/* Sidebar tabs — desktop only */}
        <aside className="hidden w-[220px] shrink-0 border-r border-divider bg-surface-secondary/40 md:block">
          <nav className="flex flex-col gap-4 p-3">
            {TAB_SECTIONS.map((section) => (
              <div key={section.group} className="space-y-0.5">
                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  {section.group}
                </p>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = active === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => setActive(item.key)}
                      className={cn(
                        'group/tab relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                        isActive
                          ? 'bg-primary/10 text-foreground'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      {isActive && (
                        <span
                          aria-hidden
                          className="absolute -left-1 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary"
                        />
                      )}
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0',
                          isActive ? 'text-primary' : 'text-text-muted',
                        )}
                        strokeWidth={isActive ? 2.25 : 1.75}
                      />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        {/* Mobile: horizontal scroll tabs */}
        <div className="flex w-full min-w-0 flex-col">
          <div className="border-b border-divider bg-surface-secondary/40 px-3 py-2 md:hidden">
            <div className="flex gap-1 overflow-x-auto pb-1 [&::-webkit-scrollbar]:hidden">
              {TAB_SECTIONS.flatMap((s) => s.items).map((item) => {
                const Icon = item.icon;
                const isActive = active === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActive(item.key)}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                      isActive
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-transparent bg-muted/40 text-muted-foreground hover:bg-muted',
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content area */}
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6 lg:py-8">
              <SectionHeader active={active} />
              {active === 'overview' && <OverviewTab groupId={groupId} myRole={myRole} />}
              {active === 'roles' && <SettingsRolesTab groupId={groupId} />}
              {active === 'channels' && <ChannelsTab groupId={groupId} />}
              {active === 'categories' && <CategoriesTab groupId={groupId} />}
              {active === 'members' && (
                <MembersTab groupId={groupId} myRole={myRole} currentUserId={currentUserId} />
              )}
              {active === 'invites' && <InvitesTab groupId={groupId} myRole={myRole} />}
              {active === 'audit' && <AuditTab groupId={groupId} />}
            </div>
          </div>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Page heading riêng cho từng tab — section title + description rõ ràng. */
function SectionHeader({ active }: { active: TabKey }) {
  const meta = TAB_SECTIONS.flatMap((s) => s.items).find((i) => i.key === active);
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <header className="space-y-1 border-b border-divider pb-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-lg font-semibold tracking-tight">{meta.label}</h2>
      </div>
      <p className="text-[12.5px] text-text-muted">{meta.description}</p>
    </header>
  );
}

// ───────────── Overview tab — name/description + delete ─────────────
type GroupDetailData = {
  group?: {
    name?: string;
    description?: string | null;
    recordingLogChannelId?: string | null;
  } | null;
  channels?: Array<{ id: string; name: string; type: string }>;
};

function OverviewTab({ groupId, myRole }: { groupId: string; myRole: 'OWNER' | 'ADMIN' }) {
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [recordingLogChannelId, setRecordingLogChannelId] = React.useState<string>('');
  const [ready, setReady] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  // Group detail qua React Query.
  const { data } = useQuery({
    queryKey: qk.groupDetail(groupId),
    queryFn: () => apiGet<GroupDetailData>(`/api/groups/${groupId}`),
  });

  // Seed form 1 lần khi data về (không re-seed lúc refetch để không đè edit của user).
  React.useEffect(() => {
    if (data && !ready) {
      setName(data.group?.name ?? '');
      setDescription(data.group?.description ?? '');
      setRecordingLogChannelId(data.group?.recordingLogChannelId ?? '');
      setReady(true);
    }
  }, [data, ready]);

  // Lọc TEXT/ANNOUNCEMENT cho dropdown — recording log phải post được message.
  const textChannels = React.useMemo(
    () =>
      (data?.channels ?? []).filter(
        (c) => c.type === 'TEXT' || c.type === 'ANNOUNCEMENT',
      ),
    [data],
  );

  const save = async () => {
    setSaving(true);
    try {
      await apiSend(`/api/groups/${groupId}`, 'PUT', {
        name: name.trim(),
        description: description.trim() || null,
        recordingLogChannelId: recordingLogChannelId || null,
      });
      toast.success('Đã lưu');
      void qc.invalidateQueries({ queryKey: qk.groupDetail(groupId) });
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async () => {
    const ok = await confirm({
      title: 'Xoá group?',
      description:
        'Tất cả channel, tin nhắn, thành viên và lịch sử sẽ bị xoá vĩnh viễn. Hành động này không hoàn tác được.',
      confirmLabel: 'Xoá group',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiSend(`/api/groups/${groupId}`, 'DELETE');
      toast.success('Đã xoá');
      router.push('/groups');
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!ready) return <CardLoading />;

  return (
    <div className="space-y-6">
      {/* Section: Thông tin nhóm */}
      <SectionCard
        title="Thông tin nhóm"
        description="Tên + mô tả hiển thị cho thành viên trong sidebar và search."
      >
        <FieldRow>
          <Label htmlFor="g-name" className="text-[12.5px]">
            Tên group
          </Label>
          <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FieldRow>
        <FieldRow>
          <Label htmlFor="g-desc" className="text-[12.5px]">
            Mô tả
          </Label>
          <Input
            id="g-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ngắn gọn — hiện ở thẻ group + invite link"
          />
        </FieldRow>
      </SectionCard>

      {/* Section: Recording log */}
      <SectionCard
        title="Log recording"
        description="Channel nhận link + tóm tắt khi voice channel ghi xong."
      >
        <FieldRow>
          <Label htmlFor="g-rec-log" className="text-[12.5px]">
            Channel đích
          </Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                id="g-rec-log"
                className="flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors hover:bg-muted"
              >
                <span className="truncate">
                  {recordingLogChannelId
                    ? `#${textChannels.find((c) => c.id === recordingLogChannelId)?.name ?? '...'}`
                    : '(Tự động — channel TEXT đầu tiên)'}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-72 w-[var(--radix-popper-anchor-width)] overflow-y-auto"
            >
              <DropdownMenuItem onClick={() => setRecordingLogChannelId('')} className="gap-2">
                <span className="flex-1">(Tự động — channel TEXT đầu tiên)</span>
                {!recordingLogChannelId && <Check className="h-3.5 w-3.5 text-primary" />}
              </DropdownMenuItem>
              {textChannels.length > 0 && <DropdownMenuSeparator />}
              {textChannels.map((c) => (
                <DropdownMenuItem
                  key={c.id}
                  onClick={() => setRecordingLogChannelId(c.id)}
                  className="gap-2"
                >
                  <span className="flex-1 truncate">
                    #{c.name}
                    {c.type === 'ANNOUNCEMENT' ? ' · ANNOUNCEMENT' : ''}
                  </span>
                  {recordingLogChannelId === c.id && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </FieldRow>
      </SectionCard>

      {/* Save bar — sticky, hiện cố định để user không phải scroll xuống tìm */}
      <div className="flex items-center justify-end gap-2 border-t border-divider pt-4">
        <Button onClick={save} disabled={saving || !name.trim()} className="min-w-[120px]">
          {saving ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Đang lưu
            </>
          ) : (
            'Lưu thay đổi'
          )}
        </Button>
      </div>

      {/* Danger zone — chỉ OWNER thấy, tách riêng dưới cùng với border đỏ */}
      {myRole === 'OWNER' && (
        <Card className="border-destructive/30 bg-destructive/5 p-4">
          <div className="mb-3 flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-destructive/15 text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Hành động dưới đây không hoàn tác được.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/20 bg-background p-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium">Xoá group vĩnh viễn</p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                Tất cả channel, tin nhắn, thành viên và lịch sử sẽ bị xoá.
              </p>
            </div>
            <Button onClick={deleteGroup} variant="destructive" size="sm">
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Xoá group
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

/** Khung card có header (title + description). Dùng cho mọi section trong settings. */
function SectionCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('overflow-hidden p-0', className)}>
      <div className="border-b border-divider bg-muted/20 px-4 py-3">
        <h3 className="text-[13.5px] font-semibold tracking-tight">{title}</h3>
        {description && (
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </Card>
  );
}

/** Field row gọn — label trên + input dưới với gap nhất quán. */
function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5">{children}</div>;
}

// ───────────── Channels tab — list + delete ─────────────
type Channel = {
  id: string;
  name: string;
  type: 'TEXT' | 'VOICE' | 'ANNOUNCEMENT' | 'STAGE' | 'FORUM';
  topic: string | null;
  position: number;
  slowModeSeconds: number | null;
  categoryId: string | null;
};

function ChannelsTab({ groupId }: { groupId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();

  // Channels + categories qua React Query (categories share key với CategoriesTab).
  const { data: channels = [], isLoading: loading } = useQuery({
    queryKey: qk.groupChannels(groupId),
    queryFn: () =>
      apiGet<{ channels?: Channel[] }>(`/api/groups/${groupId}/channels`).then(
        (d) => d.channels ?? [],
      ),
  });
  const { data: categories = [] } = useQuery({
    queryKey: qk.groupCategories(groupId),
    queryFn: () =>
      apiGet<{ categories?: Category[] }>(
        `/api/groups/${groupId}/categories`,
      ).then((d) => d.categories ?? []),
  });

  const refresh = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.groupChannels(groupId) });
    void qc.invalidateQueries({ queryKey: qk.groupCategories(groupId) });
  }, [qc, groupId]);

  // Gán/bỏ channel vào danh mục — optimistic ghi cache, rollback bằng refetch.
  const setCategory = async (channelId: string, categoryId: string | null) => {
    qc.setQueryData<Channel[]>(qk.groupChannels(groupId), (prev) =>
      (prev ?? []).map((c) => (c.id === channelId ? { ...c, categoryId } : c)),
    );
    try {
      await apiSend(`/api/groups/${groupId}/channels/${channelId}`, 'PUT', {
        categoryId,
      });
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
      void qc.invalidateQueries({ queryKey: qk.groupChannels(groupId) });
    }
  };

  const remove = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Xoá channel #${name}?`,
      description: 'Mọi tin nhắn trong channel này sẽ mất. Hành động không hoàn tác.',
      confirmLabel: 'Xoá channel',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiSend(`/api/groups/${groupId}/channels/${id}`, 'DELETE');
      toast.success('Đã xoá');
      refresh();
      router.refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (loading) return <CardLoading />;

  if (channels.length === 0) {
    return (
      <EmptyState
        icon={Hash}
        title="Chưa có channel"
        description="Tạo channel mới bằng nút + ở sidebar trái."
      />
    );
  }

  return (
    <SectionCard
      title="Danh sách channel"
      description={`Tổng ${channels.length} channel · Click icon thùng rác để xoá`}
    >
      <ul className="-m-4 divide-y divide-divider">
        {channels.map((c) => {
          const curCat = categories.find((cat) => cat.id === c.categoryId);
          return (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em]', CHANNEL_TYPE_TONE[c.type])}>
              {c.type}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium">#{c.name}</p>
              {c.topic && (
                <p className="truncate text-[11.5px] text-muted-foreground">{c.topic}</p>
              )}
            </div>
            {categories.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Chuyển channel vào danh mục"
                    className="inline-flex max-w-[150px] shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1 text-[11.5px] text-foreground transition-colors hover:bg-muted"
                  >
                    <FolderOpen className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{curCat ? curCat.name : 'Không phân loại'}</span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => setCategory(c.id, null)} className="gap-2">
                    <span className="flex-1">Không phân loại</span>
                    {!c.categoryId && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {categories.map((cat) => (
                    <DropdownMenuItem
                      key={cat.id}
                      onClick={() => setCategory(c.id, cat.id)}
                      className="gap-2"
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{cat.name}</span>
                      {c.categoryId === cat.id && <Check className="h-3.5 w-3.5 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {c.slowModeSeconds ? (
              <span className="hidden rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400 sm:inline-block">
                Slow {c.slowModeSeconds}s
              </span>
            ) : null}
            <Button
              onClick={() => remove(c.id, c.name)}
              variant="ghost"
              size="sm"
              className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Xoá #${c.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

/** Tone màu theo loại channel — share giữa channel list + member list. */
const CHANNEL_TYPE_TONE: Record<Channel['type'], string> = {
  VOICE: 'bg-green-500/10 text-green-700 dark:text-green-400',
  STAGE: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
  FORUM: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  ANNOUNCEMENT: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  TEXT: 'bg-muted text-muted-foreground',
};

// ───────────── Members tab — role + kick ─────────────
type Member = {
  userId: string;
  name: string | null;
  image: string | null;
  role: GroupRole;
  nickname: string | null;
  mutedUntil: string | null;
  joinedAt: string;
};

function MembersTab({
  groupId,
  myRole,
  currentUserId,
}: {
  groupId: string;
  myRole: 'OWNER' | 'ADMIN';
  currentUserId: string;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const askPrompt = usePrompt();

  // Members qua React Query — key dùng chung với MemberSidebar + SearchDialog.
  const { data: members = [], isLoading: loading } = useQuery({
    queryKey: qk.groupMembers(groupId),
    queryFn: () =>
      apiGet<{ members?: Member[] }>(`/api/groups/${groupId}/members`).then(
        (d) => d.members ?? [],
      ),
  });

  const refresh = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.groupMembers(groupId) });
  }, [qc, groupId]);

  const updateRole = async (userId: string, newRole: GroupRole) => {
    try {
      await apiSend(`/api/groups/${groupId}/members/${userId}`, 'PUT', {
        role: newRole,
      });
      toast.success('Đã đổi role');
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const kick = async (userId: string, name: string | null) => {
    const ok = await confirm({
      title: `Kick ${name ?? 'thành viên'} ra khỏi group?`,
      description: 'Họ vẫn có thể rejoin nếu có invite hợp lệ.',
      confirmLabel: 'Kick',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiSend(`/api/groups/${groupId}/members/${userId}`, 'DELETE');
      toast.success('Đã kick');
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const toggleMute = async (m: Member) => {
    const isMuted = m.mutedUntil && new Date(m.mutedUntil).getTime() > Date.now();
    try {
      if (isMuted) {
        await apiSend(`/api/groups/${groupId}/members/${m.userId}/mute`, 'DELETE');
        toast.success('Đã unmute');
      } else {
        const dur = await askPrompt({
          title: 'Mute thành viên',
          description: 'Số phút (1–10080).',
          placeholder: '60',
          defaultValue: '60',
        });
        if (dur === null) return;
        if (!dur) return;
        const minutes = Math.max(1, Math.min(10080, Number(dur)));
        await apiSend(`/api/groups/${groupId}/members/${m.userId}/mute`, 'POST', {
          durationSec: minutes * 60,
        });
        toast.success(`Đã mute ${minutes} phút`);
      }
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (loading) return <CardLoading />;

  // Group members theo role để hiển thị có cấu trúc — Discord-style
  const rank: Record<GroupRole, number> = { OWNER: 0, ADMIN: 1, MODERATOR: 2, MEMBER: 3 };
  const sorted = [...members].sort((a, b) => {
    const r = rank[a.role] - rank[b.role];
    if (r !== 0) return r;
    return (a.nickname ?? a.name ?? '').localeCompare(b.nickname ?? b.name ?? '');
  });
  const byRole: Record<GroupRole, Member[]> = {
    OWNER: sorted.filter((m) => m.role === 'OWNER'),
    ADMIN: sorted.filter((m) => m.role === 'ADMIN'),
    MODERATOR: sorted.filter((m) => m.role === 'MODERATOR'),
    MEMBER: sorted.filter((m) => m.role === 'MEMBER'),
  };

  const renderRow = (m: Member) => {
    const isMe = m.userId === currentUserId;
    const canEdit = !isMe && m.role !== 'OWNER' && myRole === 'OWNER';
    const canEditByAdmin =
      !isMe && m.role !== 'OWNER' && m.role !== 'ADMIN' && myRole === 'ADMIN';
    const canModifyRole = canEdit || canEditByAdmin;
    const isMutedNow = m.mutedUntil && new Date(m.mutedUntil).getTime() > Date.now();
    return (
      <li key={m.userId} className="flex items-center gap-3 px-4 py-2.5">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarImage src={m.image ?? undefined} />
          <AvatarFallback className="text-xs">
            {(m.name ?? 'U')[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[13.5px] font-medium">
              {m.nickname ?? m.name ?? 'Anonymous'}
            </p>
            {isMe && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                Bạn
              </span>
            )}
            {isMutedNow && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Đã mute
              </span>
            )}
          </div>
          <p className="truncate text-[11px] text-muted-foreground">
            Tham gia{' '}
            {new Date(m.joinedAt).toLocaleDateString('vi-VN', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })}
          </p>
        </div>
        {canModifyRole && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Đổi role"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-[11.5px] transition-colors hover:bg-muted"
              >
                {ROLE_LABEL[m.role]}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              {(myRole === 'OWNER'
                ? (['ADMIN', 'MODERATOR', 'MEMBER'] as GroupRole[])
                : (['MODERATOR', 'MEMBER'] as GroupRole[])
              ).map((r) => (
                <DropdownMenuItem
                  key={r}
                  onClick={() => updateRole(m.userId, r)}
                  className="gap-2"
                >
                  <span className="flex-1">{ROLE_LABEL[r]}</span>
                  {m.role === r && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canModifyRole && (
          <Button
            onClick={() => toggleMute(m)}
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title={isMutedNow ? 'Bỏ mute' : 'Mute'}
            aria-label={isMutedNow ? 'Bỏ mute' : 'Mute'}
          >
            {isMutedNow ? (
              <Volume2 className="h-3.5 w-3.5 text-amber-500" />
            ) : (
              <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </Button>
        )}
        {canModifyRole && (
          <Button
            onClick={() => kick(m.userId, m.name)}
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            title="Kick"
            aria-label="Kick"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      {(['OWNER', 'ADMIN', 'MODERATOR', 'MEMBER'] as const).map((role) => {
        const list = byRole[role];
        if (list.length === 0) return null;
        return (
          <SectionCard
            key={role}
            title={`${ROLE_LABEL[role]} · ${list.length}`}
            description={ROLE_HINT[role]}
          >
            <ul className="-m-4 divide-y divide-divider">{list.map(renderRow)}</ul>
          </SectionCard>
        );
      })}
    </div>
  );
}

const ROLE_LABEL: Record<GroupRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MODERATOR: 'Moderator',
  MEMBER: 'Thành viên',
};

const ROLE_HINT: Record<GroupRole, string> = {
  OWNER: 'Toàn quyền quản trị + transfer ownership',
  ADMIN: 'Quản lý channel, role, member nhưng không xoá group',
  MODERATOR: 'Mute/kick member + pin/delete tin nhắn',
  MEMBER: 'Gửi tin + tham gia voice',
};

// ───────────── Invites tab — list + create + revoke ─────────────
type Invite = {
  id: string;
  code: string;
  createdByName: string | null;
  maxUses: number | null;
  usesCount: number;
  expiresAt: string | null;
  createdAt: string;
};

function InvitesTab({ groupId, myRole }: { groupId: string; myRole: 'OWNER' | 'ADMIN' }) {
  void myRole; // mọi member tạo được, mod+ revoke bất kỳ
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [creating, setCreating] = React.useState(false);
  const [maxUses, setMaxUses] = React.useState('');
  const [expiresHours, setExpiresHours] = React.useState('');

  // Invites qua React Query — key dùng chung với InviteDialog (group-actions-menu).
  const { data, isLoading: loading } = useQuery({
    queryKey: qk.groupInvites(groupId),
    queryFn: () =>
      apiGet<{ invites?: Invite[] }>(`/api/groups/${groupId}/invites`).then(
        (d) => d.invites ?? [],
      ),
  });
  // Guard: cache persist (IndexedDB) có thể hydrate data shape CŨ (object thay vì array)
  // từ trước đợt migrate React Query → `.map`/`.length` nổ. Ép luôn về array.
  const invites = Array.isArray(data) ? data : [];

  const refresh = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.groupInvites(groupId) });
  }, [qc, groupId]);

  const create = async () => {
    setCreating(true);
    try {
      const body: { maxUses?: number; expiresInSec?: number } = {};
      if (maxUses.trim()) body.maxUses = Number(maxUses);
      if (expiresHours.trim()) body.expiresInSec = Number(expiresHours) * 3600;
      await apiSend(`/api/groups/${groupId}/invites`, 'POST', body);
      toast.success('Đã tạo invite');
      setMaxUses('');
      setExpiresHours('');
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (code: string) => {
    const ok = await confirm({
      title: 'Thu hồi invite?',
      description: `Mã "${code}" sẽ không dùng được nữa. User đang giữ link cũ không join được.`,
      confirmLabel: 'Thu hồi',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiSend(`/api/groups/${groupId}/invites/${code}`, 'DELETE');
      toast.success('Đã revoke');
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success('Đã copy code');
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Tạo invite mới"
        description="Chia sẻ code 8 ký tự cho người ngoài tham gia nhóm."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldRow>
            <Label className="text-[12.5px]">Số lượt tối đa</Label>
            <Input
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))}
              placeholder="Để trống = không giới hạn"
            />
          </FieldRow>
          <FieldRow>
            <Label className="text-[12.5px]">Hết hạn sau (giờ)</Label>
            <Input
              value={expiresHours}
              onChange={(e) => setExpiresHours(e.target.value.replace(/\D/g, ''))}
              placeholder="Để trống = vĩnh viễn (vd: 168 = 1 tuần)"
            />
          </FieldRow>
        </div>
        <Button onClick={create} disabled={creating} size="sm" className="min-w-[120px]">
          {creating ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Đang tạo
            </>
          ) : (
            'Tạo invite'
          )}
        </Button>
      </SectionCard>

      {loading ? (
        <CardLoading />
      ) : invites.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="Chưa có invite nào"
          description="Tạo code phía trên để mời người ngoài tham gia."
        />
      ) : (
        <SectionCard
          title={`Đang hoạt động · ${invites.length}`}
          description="Code mất hiệu lực sau khi thu hồi hoặc hết hạn."
        >
          <ul className="-m-4 divide-y divide-divider">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 px-4 py-2.5">
                <code className="shrink-0 rounded-md bg-primary/10 px-2 py-1 font-mono text-[12.5px] font-bold tracking-wider text-primary">
                  {inv.code}
                </code>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {inv.usesCount}
                      {inv.maxUses ? `/${inv.maxUses}` : ''}
                    </span>{' '}
                    lượt
                    {inv.expiresAt && (
                      <span>
                        {' · Hết hạn '}
                        {new Date(inv.expiresAt).toLocaleDateString('vi-VN')}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    Tạo bởi {inv.createdByName ?? 'unknown'} ·{' '}
                    {new Date(inv.createdAt).toLocaleDateString('vi-VN')}
                  </p>
                </div>
                <Button
                  onClick={() => copyCode(inv.code)}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  aria-label="Copy code"
                  title="Copy code"
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  onClick={() => revoke(inv.code)}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label="Revoke"
                  title="Thu hồi invite"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

function CardLoading() {
  return (
    <Card className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Đang tải…
    </Card>
  );
}

// ───────────── Categories tab ─────────────
type Category = { id: string; name: string; position: number };

function CategoriesTab({ groupId }: { groupId: string }) {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [newName, setNewName] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // Categories qua React Query — key dùng chung với ChannelsTab.
  const { data: cats = [], isLoading: loading } = useQuery({
    queryKey: qk.groupCategories(groupId),
    queryFn: () =>
      apiGet<{ categories?: Category[] }>(
        `/api/groups/${groupId}/categories`,
      ).then((d) => d.categories ?? []),
  });

  const refresh = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: qk.groupCategories(groupId) });
  }, [qc, groupId]);

  const create = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await apiSend(`/api/groups/${groupId}/categories`, 'POST', {
        name: newName.trim(),
      });
      toast.success('Đã tạo');
      setNewName('');
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    const ok = await confirm({
      title: `Xoá category "${name}"?`,
      description: 'Channel bên trong sẽ tách ra root, không bị mất.',
      confirmLabel: 'Xoá category',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await apiSend(`/api/groups/${groupId}/categories/${id}`, 'DELETE');
      toast.success('Đã xoá');
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Tạo danh mục mới"
        description="Gom channel theo chủ đề — hiện ở channel list, collapse được."
      >
        <div className="flex gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Vd: Học tập, Trò chuyện, Voice rooms"
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
            }}
          />
          <Button onClick={create} disabled={busy || !newName.trim()} size="sm">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Tạo'}
          </Button>
        </div>
      </SectionCard>

      {loading ? (
        <CardLoading />
      ) : cats.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="Chưa có danh mục"
          description="Tạo danh mục để gom channel theo chủ đề."
        />
      ) : (
        <SectionCard
          title={`Danh mục · ${cats.length}`}
          description="Xoá danh mục KHÔNG xoá channel bên trong — channel tự tách ra root."
        >
          <ul className="-m-4 divide-y divide-divider">
            {cats.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                  {c.name}
                </span>
                <Button
                  onClick={() => remove(c.id, c.name)}
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Xoá ${c.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}

/** Empty state card — illustration đơn giản + title + description + CTA optional. */
function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Info;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-[13.5px] font-medium">{title}</p>
      <p className="max-w-[280px] text-[11.5px] text-muted-foreground">{description}</p>
      {action}
    </Card>
  );
}

// ───────────── Audit log tab ─────────────
type AuditEntry = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorImage: string | null;
  action: string;
  result: string;
  metadata: Record<string, unknown> | null;
  timestamp: string;
};

const ACTION_LABEL: Record<string, string> = {
  'study_group.member.role-changed': 'Đổi role',
  'study_group.member.kicked': 'Kick member',
  'study_group.member.muted': 'Mute member',
  'study_group.message.deleted': 'Xoá tin nhắn',
  'study_group.channel.deleted': 'Xoá channel',
};

function AuditTab({ groupId }: { groupId: string }) {
  // Audit log qua React Query (read-only).
  const { data: entries = [], isLoading: loading } = useQuery({
    queryKey: qk.groupAudit(groupId),
    queryFn: () =>
      apiGet<{ entries?: AuditEntry[] }>(`/api/groups/${groupId}/audit`).then(
        (d) => d.entries ?? [],
      ),
  });

  if (loading) return <CardLoading />;

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="Chưa có hoạt động"
        description="Audit log ghi nhận mod action (đổi role, kick, mute, xoá tin nhắn, xoá channel)."
      />
    );
  }

  return (
    <SectionCard
      title={`Hoạt động gần nhất · ${entries.length}`}
      description="Ghi nhận mọi mod action — chỉ admin+ xem được."
    >
      <ul className="-m-4 divide-y divide-divider">
        {entries.map((e) => {
          const meta = (e.metadata ?? {}) as Record<string, unknown>;
          return (
            <li key={e.id} className="flex items-start gap-3 px-4 py-2.5">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage src={e.actorImage ?? undefined} />
                <AvatarFallback className="text-[10px]">
                  {(e.actorName ?? '?')[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-[13px]">
                  <span className="font-semibold">{e.actorName ?? 'Unknown'}</span>{' '}
                  <span className="text-muted-foreground">
                    {ACTION_LABEL[e.action] ?? e.action}
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {new Date(e.timestamp).toLocaleString('vi-VN')}
                  {meta.targetUserId ? (
                    <> · target {String(meta.targetUserId).slice(0, 8)}…</>
                  ) : null}
                  {meta.newRole ? (
                    <>
                      {' · '}
                      {String(meta.oldRole)} → {String(meta.newRole)}
                    </>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}

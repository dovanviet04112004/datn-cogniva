/**
 * /settings — trang cài đặt tài khoản + ứng dụng.
 *
 * Sections:
 *   1. Profile — đổi name, xem email/plan, ảnh đại diện (read-only Phase 0)
 *   2. Privacy — toggle isPublic (control leaderboard + /profile/[id])
 *   3. Appearance — theme light/dark/system (qua next-themes)
 *   4. Danger zone — sign out (delete account để Phase 11)
 *
 * Sử dụng /api/profile/me (GET + PATCH) — endpoint đã có từ Phase 9.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { AlertTriangle, Globe, Loader2, Lock, LogOut, Moon, Save, Sun, Trophy, User } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { AiUsageCard } from '@/components/settings/ai-usage-card';
import { DeleteAccountCard } from '@/components/settings/delete-account-card';

type ProfileData = {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    plan: string;
    isPublic: boolean;
  };
};

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [data, setData] = React.useState<ProfileData | null>(null);
  const [name, setName] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/profile/me')
      .then((r) => r.json())
      .then((d: ProfileData) => {
        setData(d);
        setName(d.user.name ?? '');
      });
  }, []);

  const saveName = async () => {
    if (!data || name.trim() === (data.user.name ?? '')) return;
    setSaving(true);
    try {
      const res = await fetch('/api/profile/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData((d) => (d ? { ...d, user: { ...d.user, name: name.trim() } } : d));
      toast.success('Đã lưu tên');
    } catch (err) {
      toast.error('Lưu thất bại: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const togglePublic = async () => {
    if (!data) return;
    const next = !data.user.isPublic;
    try {
      const res = await fetch('/api/profile/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: next }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData((d) => (d ? { ...d, user: { ...d.user, isPublic: next } } : d));
      toast.success(next ? 'Profile công khai' : 'Profile riêng tư');
    } catch (err) {
      toast.error('Lỗi: ' + (err as Error).message);
    }
  };

  const signOut = async () => {
    await authClient.signOut();
    router.replace('/sign-in');
  };

  if (!data) {
    return <p className="p-6 text-sm text-muted-foreground">Đang tải...</p>;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Quản lý tài khoản + giao diện. Dữ liệu gamification (XP, achievements)
          ở{' '}
          <Link href="/profile" className="underline">
            /profile
          </Link>
          .
        </p>
      </div>

      {/* ── Profile section ─────────────────────────── */}
      <Card className="space-y-4 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <User className="h-4 w-4" />
          Profile
        </h2>
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarImage
              src={data.user.image ?? undefined}
              alt={data.user.name ?? data.user.email}
            />
            <AvatarFallback>
              {(data.user.name ?? data.user.email)[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-0.5 text-sm">
            <p className="text-muted-foreground">{data.user.email}</p>
            <p>
              Plan:{' '}
              <span className="font-medium text-primary">{data.user.plan}</span>
            </p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Tên hiển thị</Label>
          <div className="flex gap-2">
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nhập tên..."
              className="flex-1 rounded-md border bg-background px-3 py-1.5 text-sm"
            />
            <Button
              onClick={saveName}
              disabled={saving || !name.trim() || name.trim() === (data.user.name ?? '')}
              size="sm"
            >
              {saving ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 h-3.5 w-3.5" />
              )}
              Lưu
            </Button>
          </div>
        </div>
      </Card>

      {/* ── AI Usage section (Stage 1 W6) ───────────── */}
      <AiUsageCard />

      {/* ── Privacy section ─────────────────────────── */}
      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {data.user.isPublic ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
          Privacy
        </h2>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium">Profile công khai</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Khi bật, profile bạn hiển thị trên leaderboard và URL{' '}
              <code className="rounded bg-muted px-1 text-[10px]">
                /profile/{data.user.id.slice(0, 6)}…
              </code>{' '}
              accessible cho mọi người.
            </p>
          </div>
          <Button
            onClick={togglePublic}
            variant={data.user.isPublic ? 'default' : 'outline'}
            size="sm"
          >
            {data.user.isPublic ? 'Đang công khai' : 'Bật công khai'}
          </Button>
        </div>
        {data.user.isPublic && (
          <Link href="/leaderboard">
            <Button variant="ghost" size="sm" className="w-full sm:w-auto">
              <Trophy className="mr-1 h-3.5 w-3.5" />
              Xem Leaderboard
            </Button>
          </Link>
        )}
      </Card>

      {/* ── Appearance section ──────────────────────── */}
      <Card className="space-y-3 p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Sun className="h-4 w-4" />
          Appearance
        </h2>
        <p className="text-xs text-muted-foreground">
          Chọn theme cho toàn app. &ldquo;System&rdquo; theo cài đặt OS.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {(['light', 'dark', 'system'] as const).map((t) => (
            <Button
              key={t}
              onClick={() => setTheme(t)}
              variant={theme === t ? 'default' : 'outline'}
              size="sm"
              className="capitalize"
            >
              {t === 'light' && <Sun className="mr-1 h-3.5 w-3.5" />}
              {t === 'dark' && <Moon className="mr-1 h-3.5 w-3.5" />}
              {t}
            </Button>
          ))}
        </div>
      </Card>

      {/* ── Sign out ─────────────────────────────────── */}
      <Card className="flex items-center justify-between gap-3 p-5">
        <div className="flex-1">
          <p className="text-sm font-medium">Đăng xuất</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Kết thúc phiên hiện tại. Dữ liệu được giữ nguyên.
          </p>
        </div>
        <Button onClick={signOut} variant="outline" size="sm">
          <LogOut className="mr-1 h-3.5 w-3.5" />
          Đăng xuất
        </Button>
      </Card>

      {/* ── Danger zone: GDPR Article 17/20 (Stage 1 W9-10) ── */}
      <DeleteAccountCard />
    </div>
  );
}

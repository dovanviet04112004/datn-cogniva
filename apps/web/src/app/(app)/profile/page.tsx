/**
 * /profile — trang profile của user hiện tại.
 *
 * Hiển thị:
 *   - Avatar + name + email + plan
 *   - XP + current streak + longest streak (big cards)
 *   - Achievements grid (gray nếu chưa unlock, color nếu đã unlock)
 *   - Toggle isPublic để lên leaderboard / share profile
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { Crown, Flame, Globe, Lock, Trophy, Zap } from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type Stats = {
  xp: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
  achievements: string[];
};

type AchievementMeta = {
  id: string;
  label: string;
  description: string;
  icon: string;
};

type ProfileData = {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    plan: string;
    isPublic: boolean;
  };
  stats: Stats;
  achievementMeta: AchievementMeta[];
};

export default function ProfilePage() {
  const [data, setData] = React.useState<ProfileData | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/profile/me')
      .then((r) => r.json())
      .then(setData);
  }, []);

  const togglePublic = async () => {
    if (!data) return;
    setSaving(true);
    try {
      const next = !data.user.isPublic;
      const res = await fetch('/api/profile/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPublic: next }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setData((d) => (d ? { ...d, user: { ...d.user, isPublic: next } } : d));
      toast.success(
        next ? 'Profile công khai — lên leaderboard được' : 'Profile riêng tư',
      );
    } catch (err) {
      toast.error('Update thất bại: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return <p className="p-6 text-sm text-muted-foreground">Đang tải...</p>;
  }

  const { user, stats, achievementMeta } = data;
  const unlocked = new Set(stats.achievements);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header user */}
      <Card className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
        <Avatar className="h-20 w-20">
          <AvatarImage src={user.image ?? undefined} alt={user.name ?? user.email} />
          <AvatarFallback>{(user.name ?? user.email)[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold">{user.name ?? 'Người dùng'}</h1>
          <p className="text-sm text-muted-foreground">{user.email}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
              {user.plan}
            </span>
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 ${
                user.isPublic
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {user.isPublic ? (
                <>
                  <Globe className="h-3 w-3" />
                  Công khai
                </>
              ) : (
                <>
                  <Lock className="h-3 w-3" />
                  Riêng tư
                </>
              )}
            </span>
          </div>
        </div>
        <Button onClick={togglePublic} variant="outline" disabled={saving} size="sm">
          {user.isPublic ? 'Ẩn profile' : 'Công khai'}
        </Button>
      </Card>

      {/* Stat cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={Zap} label="XP" value={stats.xp} color="text-yellow-500" />
        <StatCard
          icon={Flame}
          label="Streak hiện tại"
          value={`${stats.currentStreak} ngày`}
          color="text-orange-500"
        />
        <StatCard
          icon={Trophy}
          label="Streak dài nhất"
          value={`${stats.longestStreak} ngày`}
          color="text-amber-600"
        />
      </div>

      {/* Achievements */}
      <Card className="space-y-3 p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Crown className="h-5 w-5 text-amber-500" />
          Achievements ({unlocked.size}/{achievementMeta.length})
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {achievementMeta.map((a) => {
            const got = unlocked.has(a.id);
            return (
              <div
                key={a.id}
                className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition ${
                  got ? 'bg-card' : 'bg-muted/30 opacity-50 grayscale'
                }`}
                title={a.description}
              >
                <span className="text-3xl">{a.icon}</span>
                <p className="text-xs font-medium">{a.label}</p>
                <p className="text-[10px] text-muted-foreground">{a.description}</p>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex justify-center">
        <Link href="/leaderboard">
          <Button variant="outline">
            <Trophy className="mr-1 h-4 w-4" />
            Xem Leaderboard
          </Button>
        </Link>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Zap;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <Card className="space-y-1 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className={`h-4 w-4 ${color}`} />
        {label}
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </Card>
  );
}

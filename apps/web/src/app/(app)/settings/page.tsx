/**
 * /settings — trang cài đặt thống nhất với layout tabbed (Claude-style).
 *
 * Layout:
 *   - Hero band trên: title + breadcrumb-like description.
 *   - Body 2 cột: tab nav trái (vertical, sticky) + content panel phải.
 *   - Mobile (<md): tabs thành chip row trên, content phía dưới.
 *
 * Tabs (đầy đủ profile + setting trong 1 trang, KHÔNG cần /profile riêng):
 *   1. general   — name, email, plan, theme, pomodoro toggle
 *   2. profile   — XP, streak, achievements grid (từ /profile cũ)
 *   3. privacy   — toggle isPublic, link leaderboard
 *   4. usage     — AI usage card + Analytics shortcut
 *   5. account   — sign out, delete account (danger zone)
 *
 * Deep-link: ?tab=usage → mở thẳng tab usage (dùng từ UserMenuButton).
 */
'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Activity,
  ArrowRight,
  Crown,
  Flame,
  Globe,
  Languages,
  LineChart,
  Loader2,
  Lock,
  LogOut,
  Moon,
  Palette,
  Save,
  Settings,
  Shield,
  Sun,
  Trophy,
  User as UserIcon,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { signOut as signOutV2 } from '@/lib/auth-api';
import { AiUsageCard } from '@/components/settings/ai-usage-card';
import { DeleteAccountCard } from '@/components/settings/delete-account-card';
import { PomodoroToggleCard } from '@/components/settings/pomodoro-toggle-card';
import { PageShell } from '@/components/layout/page-shell';
// Hero band CHUNG — thay header user-identity tự-chế để đồng bộ ngôn ngữ hero toàn app.
import { PageHero } from '@/components/layout/page-hero';
import { PageLoading } from '@/components/layout/page-loading';
import { cn } from '@/lib/utils';
import { useLocale } from '@/lib/i18n/context';
import { LOCALES, type Locale } from '@/lib/i18n/dict';

type Tab = 'general' | 'profile' | 'privacy' | 'usage' | 'account';

type TabMeta = {
  id: Tab;
  icon: typeof UserIcon;
  /** Key prefix trong dictionary — `${labelKey}` + `${labelKey}_desc`. */
  labelKey: string;
};

const TABS: TabMeta[] = [
  { id: 'general', labelKey: 'settings.tab.general', icon: UserIcon },
  { id: 'profile', labelKey: 'settings.tab.profile', icon: Trophy },
  { id: 'privacy', labelKey: 'settings.tab.privacy', icon: Shield },
  { id: 'usage', labelKey: 'settings.tab.usage', icon: Activity },
  { id: 'account', labelKey: 'settings.tab.account', icon: LogOut },
];

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
  stats: {
    xp: number;
    currentStreak: number;
    longestStreak: number;
    lastActivityDate: string | null;
    achievements: string[];
  };
  achievementMeta: AchievementMeta[];
};

function isTab(s: string | null): s is Tab {
  return !!s && TABS.some((t) => t.id === s);
}

export default function SettingsPage() {
  const router = useRouter();
  const search = useSearchParams();
  const { theme, setTheme } = useTheme();
  const { t, locale, setLocale } = useLocale();
  const [data, setData] = React.useState<ProfileData | null>(null);
  const [name, setName] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  // Tab từ URL ?tab=X — fallback 'general'. Update khi URL đổi.
  const urlTab = search.get('tab');
  const activeTab: Tab = isTab(urlTab) ? urlTab : 'general';
  const setActiveTab = React.useCallback(
    (t: Tab) => {
      const sp = new URLSearchParams(search.toString());
      sp.set('tab', t);
      router.replace(`/settings?${sp.toString()}`, { scroll: false });
    },
    [router, search],
  );

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
      toast.success(locale === 'vi' ? 'Đã lưu tên' : 'Name saved');
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
      toast.success(
        next
          ? t('settings.public_badge')
          : t('settings.private_badge'),
      );
    } catch (err) {
      toast.error('Lỗi: ' + (err as Error).message);
    }
  };

  const signOut = async () => {
    await signOutV2();
    router.replace('/sign-in');
  };

  if (!data) {
    return (
      <PageShell size="wide">
        <PageLoading variant="skeleton" rows={4} />
      </PageShell>
    );
  }

  const user = data.user;

  return (
    <PageShell size="wide" padded className="space-y-6">
      {/* ── Hero band CHUNG — user identity (title = tên, description = email) ── */}
      <PageHero
        eyebrow={t('settings.user_default')}
        eyebrowIcon={Settings}
        title={user.name ?? t('settings.user_default')}
        description={<span className="font-mono">{user.email}</span>}
      >
        {/* Slot phải GIỮ nguyên: avatar + badge plan/công-khai (identity chips). */}
        <div className="flex items-center gap-4">
          <div className="flex flex-wrap justify-end gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary">
              <Crown className="h-2.5 w-2.5" />
              {user.plan}
            </span>
            {/* Badge công khai = trạng thái positive → token success */}
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
                user.isPublic
                  ? 'border-success/20 bg-success/5 text-success'
                  : 'border-border bg-muted/40 text-muted-foreground',
              )}
            >
              {user.isPublic ? (
                <>
                  <Globe className="h-2.5 w-2.5" />
                  {t('settings.public_badge')}
                </>
              ) : (
                <>
                  <Lock className="h-2.5 w-2.5" />
                  {t('settings.private_badge')}
                </>
              )}
            </span>
          </div>
          <Avatar className="h-16 w-16 ring-2 ring-primary/30 ring-offset-4 ring-offset-card">
            <AvatarImage src={user.image ?? undefined} alt={user.name ?? user.email} />
            <AvatarFallback className="bg-gradient-to-br from-primary to-primary-hover text-lg font-semibold text-primary-foreground">
              {(user.name ?? user.email)[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
      </PageHero>

      {/* ── Body: tab nav (vertical desktop / chip row mobile) + content ── */}
      <div className="grid gap-6 md:grid-cols-[220px_1fr] md:gap-8">
        {/* Tab nav */}
        <nav
          aria-label="Settings sections"
          className="flex shrink-0 gap-1 overflow-x-auto md:sticky md:top-4 md:h-fit md:flex-col md:overflow-visible"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'group/tab relative flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors md:w-full',
                  active
                    ? 'bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {active && (
                  <span
                    aria-hidden
                    className="absolute -left-1 top-1/2 hidden h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary md:block"
                  />
                )}
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    active ? 'text-primary' : 'text-text-muted',
                  )}
                  strokeWidth={active ? 2.25 : 1.75}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium tracking-tight">
                    {t(tab.labelKey)}
                  </span>
                  <span className="hidden truncate text-[11px] text-muted-foreground/80 md:inline">
                    {t(`${tab.labelKey}_desc`)}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>

        {/* Content panel */}
        <div className="min-w-0 space-y-6">
          {activeTab === 'general' && (
            <GeneralTab
              user={user}
              name={name}
              setName={setName}
              saveName={saveName}
              saving={saving}
              theme={theme}
              setTheme={setTheme}
              locale={locale}
              setLocale={setLocale}
              t={t}
            />
          )}
          {activeTab === 'profile' && (
            <ProfileTab stats={data.stats} achievementMeta={data.achievementMeta} />
          )}
          {activeTab === 'privacy' && (
            <PrivacyTab isPublic={user.isPublic} userId={user.id} onToggle={togglePublic} t={t} />
          )}
          {activeTab === 'usage' && <UsageTab />}
          {activeTab === 'account' && <AccountTab onSignOut={signOut} t={t} />}
        </div>
      </div>
    </PageShell>
  );
}

// ────────────────────────────────────────────────────────────
// Tab content components — gọn để page-level dễ đọc
// ────────────────────────────────────────────────────────────

function GeneralTab({
  user,
  name,
  setName,
  saveName,
  saving,
  theme,
  setTheme,
  locale,
  setLocale,
  t,
}: {
  user: ProfileData['user'];
  name: string;
  setName: (s: string) => void;
  saveName: () => void;
  saving: boolean;
  theme: string | undefined;
  setTheme: (s: string) => void;
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
}) {
  const themeLabels: Record<'light' | 'dark' | 'system', string> = {
    light: t('settings.theme.light'),
    dark: t('settings.theme.dark'),
    system: t('settings.theme.system'),
  };

  return (
    <>
      <Card className="space-y-4 p-6">
        <SectionLabel icon={UserIcon}>{t('settings.section.account')}</SectionLabel>
        <div className="space-y-1.5">
          <Label htmlFor="name">{t('settings.name_label')}</Label>
          <div className="flex gap-2">
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.name_placeholder')}
              className="flex-1"
            />
            <Button
              onClick={saveName}
              disabled={saving || !name.trim() || name.trim() === (user.name ?? '')}
              size="sm"
            >
              {saving ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 h-3.5 w-3.5" />
              )}
              {t('settings.save')}
            </Button>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>{t('settings.email')}</Label>
          <p className="rounded-md border border-divider bg-surface-secondary/40 px-3 py-2 font-mono text-xs text-muted-foreground">
            {user.email}
          </p>
        </div>
      </Card>

      <Card className="space-y-3 p-6">
        <SectionLabel icon={Palette}>{t('settings.section.appearance')}</SectionLabel>
        <p className="text-xs text-muted-foreground">{t('settings.appearance.hint')}</p>
        <div className="grid grid-cols-3 gap-2">
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <Button
              key={mode}
              onClick={() => setTheme(mode)}
              variant={theme === mode ? 'default' : 'outline'}
              size="sm"
            >
              {mode === 'light' && <Sun className="mr-1 h-3.5 w-3.5" />}
              {mode === 'dark' && <Moon className="mr-1 h-3.5 w-3.5" />}
              {themeLabels[mode]}
            </Button>
          ))}
        </div>
      </Card>

      <Card className="space-y-3 p-6">
        <SectionLabel icon={Languages}>{t('settings.section.language')}</SectionLabel>
        <p className="text-xs text-muted-foreground">{t('settings.language.hint')}</p>
        <div className="grid grid-cols-2 gap-2">
          {LOCALES.map((opt) => (
            <Button
              key={opt.value}
              onClick={() => setLocale(opt.value)}
              variant={locale === opt.value ? 'default' : 'outline'}
              size="sm"
            >
              <span className="mr-1.5 text-base leading-none">{opt.flag}</span>
              {opt.label}
            </Button>
          ))}
        </div>
      </Card>

      <PomodoroToggleCard />
    </>
  );
}

function ProfileTab({
  stats,
  achievementMeta,
}: {
  stats: ProfileData['stats'];
  achievementMeta: AchievementMeta[];
}) {
  const unlocked = new Set(stats.achievements);
  return (
    <>
      <Card className="space-y-4 p-6">
        <SectionLabel icon={Trophy}>Thành tích</SectionLabel>
        <div className="grid grid-cols-3 gap-x-6 gap-y-3">
          <StatTile
            icon={Zap}
            iconColor="text-discovery-500"
            accent="bg-discovery-500"
            label="XP"
            value={stats.xp.toLocaleString('vi-VN')}
            hint={null}
          />
          <StatTile
            icon={Flame}
            iconColor="text-orange-500"
            accent="bg-orange-500"
            label="Streak hiện tại"
            value={String(stats.currentStreak)}
            hint={stats.currentStreak > 0 ? 'ngày' : '—'}
          />
          <StatTile
            icon={Trophy}
            iconColor="text-amber-500"
            accent="bg-amber-500"
            label="Streak dài nhất"
            value={String(stats.longestStreak)}
            hint={stats.longestStreak > 0 ? 'ngày' : '—'}
          />
        </div>
      </Card>

      <Card className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <SectionLabel icon={Trophy}>Huy hiệu</SectionLabel>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {unlocked.size} / {achievementMeta.length}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {achievementMeta.map((a) => {
            const got = unlocked.has(a.id);
            return (
              <div
                key={a.id}
                className={cn(
                  'group/ach relative flex flex-col items-center gap-1.5 overflow-hidden rounded-xl border p-3 text-center transition-all duration-base',
                  got
                    ? 'border-divider bg-card shadow-soft hover:-translate-y-0.5 hover:shadow-elevated'
                    : 'border-dashed border-border bg-surface-secondary/30 opacity-60 grayscale',
                )}
                title={a.description}
              >
                {got && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -top-6 left-1/2 h-16 w-16 -translate-x-1/2 rounded-full bg-amber-500/10 blur-2xl transition-opacity duration-base group-hover/ach:bg-amber-500/20"
                  />
                )}
                <span className="relative text-2xl">{a.icon}</span>
                <p className="relative text-xs font-semibold tracking-tight">
                  {a.label}
                </p>
                <p className="relative text-[10px] leading-snug text-muted-foreground">
                  {a.description}
                </p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="flex items-center justify-between gap-3 p-6">
        <div>
          <p className="text-sm font-medium tracking-tight">So tài với người khác</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Bảng xếp hạng theo XP, streak — chỉ user công khai mới hiển thị.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/leaderboard">
            <Trophy className="mr-1 h-3.5 w-3.5" />
            Leaderboard
          </Link>
        </Button>
      </Card>
    </>
  );
}

function PrivacyTab({
  isPublic,
  userId,
  onToggle,
  t,
}: {
  isPublic: boolean;
  userId: string;
  onToggle: () => void;
  t: (key: string) => string;
}) {
  return (
    <Card className="space-y-3 p-6">
      <SectionLabel icon={isPublic ? Globe : Lock}>{t('settings.section.privacy')}</SectionLabel>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-medium">{t('settings.public_profile')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1 text-[10px]">
              /profile/{userId.slice(0, 6)}…
            </code>
          </p>
        </div>
        <Button onClick={onToggle} variant={isPublic ? 'default' : 'outline'} size="sm">
          {isPublic ? t('settings.public_on') : t('settings.public_off')}
        </Button>
      </div>
    </Card>
  );
}

function UsageTab() {
  return (
    <>
      <AiUsageCard />
      <Card className="p-6">
        <SectionLabel icon={LineChart}>Insights</SectionLabel>
        <Link
          href="/analytics"
          className="mt-3 flex items-center gap-4 rounded-lg border border-divider bg-surface-secondary/30 p-4 transition-colors hover:bg-muted/40"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/15 to-indigo-500/15 text-blue-600 ring-1 ring-inset ring-blue-500/20 dark:text-blue-400">
            <LineChart className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium tracking-tight">Analytics chi tiết</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Tổng thời gian học, mastery theo domain, biểu đồ tiến trình.
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      </Card>
    </>
  );
}

function AccountTab({
  onSignOut,
  t,
}: {
  onSignOut: () => void;
  t: (key: string) => string;
}) {
  return (
    <>
      <Card className="flex items-center justify-between gap-3 p-6">
        <div className="flex-1">
          <p className="text-sm font-semibold tracking-tight">{t('settings.sign_out')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('settings.sign_out_hint')}</p>
        </div>
        <Button onClick={onSignOut} variant="outline" size="sm">
          <LogOut className="mr-1 h-3.5 w-3.5" />
          {t('settings.sign_out')}
        </Button>
      </Card>
      <DeleteAccountCard />
    </>
  );
}

// ────────────────────────────────────────────────────────────
// Sub-primitives
// ────────────────────────────────────────────────────────────

function SectionLabel({
  icon: Icon,
  children,
}: {
  icon: typeof UserIcon;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2.5 pb-1">
      <span className="h-px w-6 bg-gradient-to-r from-primary/60 to-transparent" />
      <Icon className="h-3.5 w-3.5 text-primary" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/80">
        {children}
      </span>
    </h2>
  );
}

function StatTile({
  icon: Icon,
  iconColor,
  accent,
  label,
  value,
  hint,
}: {
  icon: typeof Zap;
  iconColor: string;
  accent: string;
  label: string;
  value: string;
  hint: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className={cn('h-1.5 w-1.5 rounded-full', accent)} />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </p>
        <Icon className={cn('h-3 w-3', iconColor)} />
      </div>
      <div className="flex items-baseline gap-1.5">
        {/* Số liệu thống kê to: dùng sans Geist (bỏ font-mono cho bớt khô), giữ tabular-nums canh cột. */}
        <p className="text-2xl font-semibold tabular-nums leading-none tracking-tight">
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

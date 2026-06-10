/**
 * /profile — DEPRECATED, redirect → /settings?tab=profile.
 *
 * Phase 21+ refactor: profile info (XP, streak, achievements) đã gộp vào
 * Settings tabbed UI. Avatar dropdown ở cuối sidebar là entry point chính.
 *
 * Giữ route để backward compat với link cũ + /profile/[id] (public profile của
 * user khác) vẫn dùng được — chỉ /profile (self) redirect.
 */
import { redirect } from 'next/navigation';

export default function ProfileSelfPage() {
  redirect('/settings?tab=profile');
}

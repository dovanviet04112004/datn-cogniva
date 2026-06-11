/**
 * Admin guard — defense-in-depth cho /admin và /api/admin.
 *
 * 3 layer:
 *   1. Middleware (apps/web/src/middleware.ts) — chặn sớm khi user chưa
 *      sign-in hoặc không có admin_role. Edge runtime, không hit DB.
 *   2. requireAdmin() trong layout server component — fetch user.adminRole
 *      từ DB, redirect /admin/sign-in nếu thiếu.
 *   3. requireAdminRole(...) trong từng API handler — check role thực tế
 *      vs role yêu cầu.
 *
 * Legacy fallback: env `ADMIN_EMAILS` vẫn được honor (email → SUPER_ADMIN)
 * để bootstrap user đầu tiên trước khi có user.adminRole row trong DB.
 * Phase 1+ migrate hết sang adminRole column → xoá fallback.
 */
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db, user, type AdminRole } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';

const ADMIN_EMAIL_FALLBACK = ['dovanviet04112004@gmail.com'];

/** Parse env ADMIN_EMAILS (comma-separated) hoặc dùng fallback. */
function parseAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS;
  if (raw && raw.length > 0) {
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  return ADMIN_EMAIL_FALLBACK;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return parseAdminEmails().includes(email.toLowerCase());
}

export type AdminContext = {
  userId: string;
  email: string;
  name: string | null;
  role: AdminRole;
};

/**
 * Resolve admin role hiện tại từ session.
 *
 *   1. Lấy user.adminRole từ DB (single query).
 *   2. Nếu NULL → fallback: kiểm tra email có trong ADMIN_EMAILS env không.
 *      Có → coi như SUPER_ADMIN (bootstrap).
 *
 * @returns AdminContext nếu là admin, null nếu không.
 */
export async function getAdminContext(): Promise<AdminContext | null> {
  const session = await getServerSession();
  if (!session?.user) return null;

  const [row] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      adminRole: user.adminRole,
      suspendedAt: user.suspendedAt,
    })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  if (!row) return null;
  if (row.suspendedAt !== null) return null; // suspended → mất quyền admin

  const role: AdminRole | null =
    (row.adminRole as AdminRole | null) ??
    (isAdminEmail(row.email) ? 'SUPER_ADMIN' : null);

  if (!role) return null;
  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    role,
  };
}

/**
 * Layout-side guard — gọi trong app/admin/layout.tsx server component.
 * Throw redirect nếu user chưa đủ quyền → middleware đã chặn nhưng đây là
 * defense-in-depth (middleware có thể bypass khi config sai).
 */
export async function requireAdmin(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) {
    redirect('/admin/sign-in');
  }
  return ctx;
}

/**
 * API-side guard — gọi trong /api/admin/* handler.
 *
 * @param allowed Roles được phép — undefined = mọi admin role đều OK.
 * @throws Response 401/403 — handler bao try/catch hoặc trực tiếp return.
 */
export async function requireAdminRole(
  allowed?: AdminRole[],
): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) {
    throw new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (allowed && !allowed.includes(ctx.role)) {
    throw new Response(
      JSON.stringify({ error: 'Forbidden — không đủ quyền', requiredRoles: allowed }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    );
  }
  return ctx;
}

/** Helper: convert exception từ requireAdminRole thành Response. */
export function isGuardResponse(err: unknown): err is Response {
  return err instanceof Response;
}

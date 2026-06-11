import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { db, user, type AdminRole } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';

const ADMIN_EMAIL_FALLBACK = ['dovanviet04112004@gmail.com'];

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
  if (row.suspendedAt !== null) return null;

  const role: AdminRole | null =
    (row.adminRole as AdminRole | null) ?? (isAdminEmail(row.email) ? 'SUPER_ADMIN' : null);

  if (!role) return null;
  return {
    userId: row.id,
    email: row.email,
    name: row.name,
    role,
  };
}

export async function requireAdmin(): Promise<AdminContext> {
  const ctx = await getAdminContext();
  if (!ctx) {
    redirect('/admin/sign-in');
  }
  return ctx;
}

export async function requireAdminRole(allowed?: AdminRole[]): Promise<AdminContext> {
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

export function isGuardResponse(err: unknown): err is Response {
  return err instanceof Response;
}

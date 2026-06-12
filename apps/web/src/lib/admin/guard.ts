import { redirect } from 'next/navigation';

import type { AdminRole } from '@cogniva/db';

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

  const { id, email, name, role: rawRole } = session.user;
  const role: AdminRole | null =
    (rawRole as AdminRole | null) ?? (isAdminEmail(email) ? 'SUPER_ADMIN' : null);

  if (!role) return null;
  return {
    userId: id,
    email,
    name,
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

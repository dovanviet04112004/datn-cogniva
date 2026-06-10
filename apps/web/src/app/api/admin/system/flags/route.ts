/**
 * GET  /api/admin/system/flags — list flags hiện có.
 * POST /api/admin/system/flags — create/update 1 flag.
 *   Body: { name, value, reason }
 * DELETE /api/admin/system/flags?name=X — xoá flag (return về default behavior).
 *
 * Flag value là arbitrary JSON. Tên flag là kebab-case, max 60 chars.
 * Code app đọc qua `getFlag<T>(name)` ở `lib/system/config.ts`.
 *
 * Auth: SUPER_ADMIN only — flags ảnh hưởng product behavior.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, systemConfig } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';
import {
  clearSystemConfigCache,
  listAllFlags,
  setSystemConfig,
} from '@/lib/system/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FLAG_NAME = /^[a-z][a-z0-9_-]{0,59}$/;

export async function GET() {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const flags = await listAllFlags();
  return NextResponse.json({
    flags: flags.map((f) => ({
      ...f,
      updatedAt: f.updatedAt.toISOString(),
    })),
  });
}

const POST_SCHEMA = z.object({
  name: z.string().regex(FLAG_NAME, 'Tên flag phải kebab-case, max 60 chars'),
  value: z.unknown(),
  reason: z.string().trim().min(10).max(500),
});

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const body = await request.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, value, reason } = parsed.data;

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'flag.set',
    { type: 'flag', id: name },
    async () => {
      // Read before
      const [existing] = await db
        .select({ value: systemConfig.value })
        .from(systemConfig)
        .where(eq(systemConfig.key, `flags.${name}`))
        .limit(1);
      await setSystemConfig(`flags.${name}`, value, admin.userId);
      return {
        before: existing?.value ?? null,
        after: value,
        reason,
        result: { ok: true },
      };
    },
  );

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const reason = url.searchParams.get('reason') ?? '';
  if (!name || !FLAG_NAME.test(name)) {
    return NextResponse.json({ error: 'Tên flag không hợp lệ' }, { status: 400 });
  }
  if (reason.trim().length < 10) {
    return NextResponse.json(
      { error: 'Reason cần ≥ 10 ký tự' },
      { status: 400 },
    );
  }

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'flag.delete',
    { type: 'flag', id: name },
    async () => {
      const [existing] = await db
        .select({ value: systemConfig.value })
        .from(systemConfig)
        .where(eq(systemConfig.key, `flags.${name}`))
        .limit(1);
      if (!existing) throw new Error('Flag không tồn tại');
      await db.delete(systemConfig).where(eq(systemConfig.key, `flags.${name}`));
      clearSystemConfigCache();
      return {
        before: existing.value,
        after: null,
        reason: reason.trim(),
        result: { ok: true },
      };
    },
  );

  return NextResponse.json({ ok: true });
}

/**
 * GET  /api/admin/system/maintenance — read current maintenance config.
 * POST /api/admin/system/maintenance — update config.
 *
 * Body POST:
 *   { enabled: boolean, banner?: string|null, dismissible?: boolean, reason: string (10..500) }
 *
 * Action ghi audit log để track ai bật/tắt khi nào.
 *
 * Auth GET: requireAdminRole — mọi role.
 * Auth POST: SUPER_ADMIN only — maintenance ảnh hưởng tất cả user.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';
import {
  getMaintenanceConfig,
  setSystemConfig,
  type MaintenanceConfig,
} from '@/lib/system/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const config = await getMaintenanceConfig();
  return NextResponse.json({ config });
}

const POST_SCHEMA = z.object({
  enabled: z.boolean(),
  banner: z.string().trim().max(500).nullable().optional(),
  dismissible: z.boolean().optional(),
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
  const { enabled, banner, dismissible, reason } = parsed.data;

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    enabled ? 'maintenance.enable' : 'maintenance.disable',
    { type: 'system', id: 'maintenance' },
    async () => {
      const before = await getMaintenanceConfig();
      const next: MaintenanceConfig = {
        enabled,
        banner: banner === undefined ? before.banner : banner,
        dismissible: dismissible ?? before.dismissible,
      };
      await setSystemConfig('maintenance', next, admin.userId);
      return { before, after: next, reason, result: { ok: true, config: next } };
    },
  );

  return NextResponse.json({ ok: true });
}

/**
 * POST /api/admin/ai/circuits/reset — force CLOSED 1 circuit.
 *
 * Body: { name: string, reason: string (10..500) }
 * Dùng cho ops khi provider phục hồi mà circuit chưa tự chuyển HALF_OPEN.
 *
 * Auth: SUPER_ADMIN / ADMIN
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';
import { resetCircuit } from '@/lib/ai/circuit-breaker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BODY_SCHEMA = z.object({
  name: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(10).max(500),
});

export async function POST(request: Request) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN', 'ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { name, reason } = parsed.data;

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'circuit.reset',
    { type: 'circuit', id: name },
    async () => {
      await resetCircuit(name);
      return {
        before: { state: 'OPEN_OR_HALF_OPEN' },
        after: { state: 'CLOSED' },
        reason,
        result: { ok: true },
      };
    },
  );

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/admin/ai/circuits — list state mọi circuit breaker hiện đang track.
 *
 * Trả ra chỉ circuit có state ≠ CLOSED hoặc đang có fail count gần đây.
 * Circuit healthy không có entry trong Redis (state CLOSED = del key).
 *
 * Auth: requireAdminRole — mọi role xem được.
 */
import { NextResponse } from 'next/server';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { listCircuits } from '@/lib/ai/circuit-breaker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const circuits = await listCircuits();
  return NextResponse.json({ circuits });
}

/**
 * POST /api/library/admin/recompute-quality — Phase 2 Pillar #5.
 *
 * Manual trigger để recompute quality score + badges cho 1 doc hoặc toàn bộ
 * docs PUBLISHED. Để admin call sau khi thay đổi formula hoặc thêm outcome
 * data lớn.
 *
 * Body:
 *   - { docId: string }   → recompute 1 doc cụ thể
 *   - {}                  → recompute all
 *
 * Phase 4 sẽ wrap qua cron nightly auto recompute.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import {
  recomputeQualityForDoc,
  recomputeQualityAll,
} from '@/lib/library/quality-score';

export const runtime = 'nodejs';
export const maxDuration = 300;

const BODY = z.object({
  docId: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // TODO: admin role check khi có roles. Tạm thời cho phép user logged-in
  // trigger để dev/test — Phase 4 lock admin only.

  const body = await request.json().catch(() => ({}));
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.docId) {
      const result = await recomputeQualityForDoc(parsed.data.docId);
      return NextResponse.json({ docId: parsed.data.docId, ...result });
    }
    const result = await recomputeQualityAll();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

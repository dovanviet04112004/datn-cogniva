/**
 * POST /api/notes/complete — AI inline completion cho TipTap editor.
 *
 * Body: { prefix: string }   — text gần cursor (~500 ký tự cuối)
 * Response: { completion: string }
 *
 * Không stream ở v1 cho đơn giản; Phase 8+ có thể chuyển sang SSE để
 * progressive insert.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { completeNote } from '@/lib/notes/complete';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SCHEMA = z.object({
  prefix: z.string().min(1).max(4000),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const completion = await completeNote(parsed.data.prefix);
  return NextResponse.json({ completion });
}

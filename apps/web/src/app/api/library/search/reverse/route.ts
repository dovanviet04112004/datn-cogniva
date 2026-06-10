/**
 * POST /api/library/search/reverse — Pillar #4 reverse search.
 *
 * Body: { problemText?, problemImageBase64?, problemImageMimeType?, hint? }
 * Trả về: analysis + 3 cluster doc (theory/exercise/exam).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { reverseSearch } from '@/lib/library/reverse-search';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BODY = z
  .object({
    problemText: z.string().min(5).max(3000).optional(),
    problemImageBase64: z.string().optional(),
    problemImageMimeType: z.string().optional(),
    hint: z
      .object({
        subjectSlug: z.string().optional(),
        level: z.string().optional(),
        grade: z.number().int().min(1).max(12).optional(),
      })
      .optional(),
  })
  .refine((d) => d.problemText || d.problemImageBase64, {
    message: 'Cần problemText hoặc problemImageBase64',
  });

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const plan = (
    (session.user as { plan?: string }).plan ?? 'FREE'
  ) as 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';

  try {
    const result = await reverseSearch({
      ...parsed.data,
      userId: session.user.id,
      plan,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[reverse-search]', err);
    return NextResponse.json(
      { error: 'Search failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}

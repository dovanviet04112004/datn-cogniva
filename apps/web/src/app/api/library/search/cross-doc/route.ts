/**
 * POST /api/library/search/cross-doc — Pillar #2 cross-doc semantic search.
 *
 * Body: { query: string, filters?: {...}, limit?: number }
 * Trả về chunks (doc + page + excerpt highlighted).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { crossDocSearch } from '@/lib/library/cross-doc-search';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BODY = z.object({
  query: z.string().min(2).max(500),
  filters: z
    .object({
      subjectSlug: z.string().optional(),
      level: z.string().optional(),
      grade: z.array(z.number().int()).optional(),
      docType: z.array(z.string()).optional(),
      language: z.string().optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(50).default(20),
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

  try {
    const hits = await crossDocSearch(parsed.data);
    return NextResponse.json({ hits, query: parsed.data.query });
  } catch (err) {
    console.error('[cross-doc-search]', err);
    return NextResponse.json(
      { error: 'Search failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}

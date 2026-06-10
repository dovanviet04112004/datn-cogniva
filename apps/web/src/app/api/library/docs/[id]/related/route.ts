/**
 * GET /api/library/docs/[id]/related — Bonus #10 Auto-Stitched Workspace (Phase 2).
 *
 * Trả 3 docs bổ trợ cho doc nguồn: prerequisite + next_step + practice.
 *
 * Spec: docs/plans/library-share.md §Bonus 10.
 */
import { NextResponse } from 'next/server';

import { findRelatedDocs } from '@/lib/library/related-docs';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const related = await findRelatedDocs(id);
    return NextResponse.json({ related });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

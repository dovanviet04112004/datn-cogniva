/**
 * GET /api/library/docs/[id]/duplicates — Phase 2 Duplicate Detection.
 *
 * Trả về list docs tương tự với source doc theo title_embedding similarity.
 * UI dùng để show banner "Doc tương tự đã tồn tại" cho user trước khi đọc/import.
 *
 * Threshold mặc định 0.85 (cảnh báo) — admin có thể dùng ?nearOnly=true để
 * chỉ list ≥ 0.92 (near-duplicate).
 *
 * Spec: docs/plans/library-share.md §Phase 2 Moderation.
 */
import { NextResponse } from 'next/server';

import {
  findDuplicateMatches,
  NEAR_DUPLICATE_THRESHOLD,
  SIMILAR_THRESHOLD,
} from '@/lib/library/duplicate-detect';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const url = new URL(request.url);
  const nearOnly = url.searchParams.get('nearOnly') === 'true';
  const threshold = nearOnly ? NEAR_DUPLICATE_THRESHOLD : SIMILAR_THRESHOLD;

  try {
    const matches = await findDuplicateMatches(id, threshold);
    return NextResponse.json({
      matches,
      threshold,
      hasNearDuplicate: matches.some((m) => m.isNearDuplicate),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}

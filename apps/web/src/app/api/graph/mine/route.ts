/**
 * POST /api/graph/mine — trigger LLM mining prerequisite edges cho concepts
 * của user hiện tại. Thay cho chạy script CLI `pnpm mine:prereq`.
 *
 * Idempotent qua uniqueIndex concept_relation_uniq — gọi 2 lần không nhân đôi
 * edges, nhưng LLM có thể tìm ra cặp mới sau khi user thêm concepts.
 *
 * Cost: 1 LLM call/domain group (≤10 concept/batch). User ≤ 50 concept ≈
 * 5-8 calls. Rate-limit 'aiGenerate' để chặn spam.
 *
 * Maxduration 60s — đủ cho ~10 batch nối tiếp với chat model thường.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { onGraphChanged } from '@/lib/cache/invalidate';
import { listConceptsForUser, minePrerequisites } from '@/lib/concepts';
import { checkLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  // Rate limit — share key 'aiGenerate' với quiz/flashcard gen.
  const rl = await checkLimit(`graph-mine:${userId}`, 'aiGenerate');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Đợi vài giây rồi thử lại' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  try {
    const concepts = await listConceptsForUser(userId);
    if (concepts.length < 2) {
      return NextResponse.json(
        { error: 'Cần ≥ 2 concepts mới mine được — upload thêm tài liệu trước.' },
        { status: 400 },
      );
    }

    const inserted = await minePrerequisites(concepts);
    // Edges mới → graph cache (key 'all') cũ. onDocumentChanged không phủ đường mine
    // thủ công này nên bust riêng. (Mine không biết workspaceId → chỉ key 'all'.)
    if (inserted > 0) await onGraphChanged(userId);
    return NextResponse.json({ inserted, totalConcepts: concepts.length });
  } catch (err) {
    console.error('[graph-mine]', err);
    return NextResponse.json(
      { error: `Mine lỗi: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}

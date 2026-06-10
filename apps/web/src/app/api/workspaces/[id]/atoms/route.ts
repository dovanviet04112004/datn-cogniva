/**
 * GET /api/workspaces/[id]/atoms — list atoms scoped 1 workspace.
 *
 * Atom của workspace = concept link với chunk thuộc document của workspace
 * (qua chunk_concept). Mỗi atom kèm:
 *   - mastery score của user (null nếu chưa attempt)
 *   - flashcardCount (của user trong workspace này)
 *   - questionCount (toàn bộ, không scope user — quiz có thể share)
 *   - examQuestionCount (toàn bộ)
 *
 * Phase C (atom-centric). Spec: docs/plans/atom-centric.md §5.1.
 *
 * Query params:
 *   - sort: 'mastery' (asc, yếu nhất trước) | 'name' | 'difficulty' (default mastery)
 *   - limit: default 100
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  chunk,
  chunkConcept,
  concept,
  dbReplica,
  document,
  examQuestion,
  flashcard,
  mastery,
  question,
  workspace,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: workspaceId } = await params;
  const url = new URL(request.url);
  const sort = (url.searchParams.get('sort') ?? 'mastery') as
    | 'mastery'
    | 'name'
    | 'difficulty';
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') ?? '100', 10));

  // Verify ownership — access-check NGOÀI cache (read thuần qua replica).
  const [ws] = await dbReplica
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.userId, session.user.id)))
    .limit(1);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Atom view (concept + mastery + count) là read thuần, nặng (nhiều query) →
  // cache-aside per-(user,workspace), TTL 60s. Cache DANH SÁCH ĐẦY ĐỦ chưa
  // sort/slice — vì sort/limit là query param, nếu fold vào key sẽ phình key &
  // giảm hit-rate; thay vào đó sort + slice ngoài cache (rẻ, in-memory). Output
  // toàn string/number (Date đã .toISOString()) → consumer NextResponse.json,
  // không cần re-hydrate Date. Bust qua onWorkspaceContentChanged.
  const atoms = await cached(ck.workspaceAtoms(session.user.id, workspaceId), 60, async () => {
    // Step 1: list concept IDs link với workspace
    const conceptIdRows = await dbReplica
      .selectDistinct({ id: chunkConcept.conceptId })
      .from(chunkConcept)
      .innerJoin(chunk, eq(chunk.id, chunkConcept.chunkId))
      .innerJoin(document, eq(document.id, chunk.documentId))
      .where(
        and(
          eq(document.workspaceId, workspaceId),
          eq(document.userId, session.user.id),
        ),
      );

    const conceptIds = conceptIdRows.map((r) => r.id);
    if (conceptIds.length === 0) {
      return [];
    }

    // Step 2: load concept rows
    const concepts = await dbReplica
      .select()
      .from(concept)
      .where(inArray(concept.id, conceptIds));

    // Step 3: load mastery for these atoms (user-scoped)
    const masteryRows = await dbReplica
      .select()
      .from(mastery)
      .where(
        and(eq(mastery.userId, session.user.id), inArray(mastery.conceptId, conceptIds)),
      );
    const masteryMap = new Map(masteryRows.map((m) => [m.conceptId, m]));

    // Step 4: counts — flashcard (user × workspace × concept), question (concept), examQuestion (concept)
    const fcCounts = await dbReplica
      .select({
        conceptId: flashcard.conceptId,
        n: sql<number>`COUNT(*)::int`.as('n'),
      })
      .from(flashcard)
      .where(
        and(
          eq(flashcard.userId, session.user.id),
          eq(flashcard.workspaceId, workspaceId),
          inArray(flashcard.conceptId, conceptIds),
        ),
      )
      .groupBy(flashcard.conceptId);
    const fcMap = new Map<string, number>();
    for (const c of fcCounts) {
      if (c.conceptId !== null) fcMap.set(c.conceptId, c.n);
    }

    const qCounts = await dbReplica
      .select({
        conceptId: question.conceptId,
        n: sql<number>`COUNT(*)::int`.as('n'),
      })
      .from(question)
      .where(inArray(question.conceptId, conceptIds))
      .groupBy(question.conceptId);
    const qMap = new Map<string, number>();
    for (const c of qCounts) {
      if (c.conceptId !== null) qMap.set(c.conceptId, c.n);
    }

    const exCounts = await dbReplica
      .select({
        conceptId: examQuestion.conceptId,
        n: sql<number>`COUNT(*)::int`.as('n'),
      })
      .from(examQuestion)
      .where(inArray(examQuestion.conceptId, conceptIds))
      .groupBy(examQuestion.conceptId);
    const exMap = new Map<string, number>();
    for (const c of exCounts) {
      if (c.conceptId !== null) exMap.set(c.conceptId, c.n);
    }

    // Compose result (chưa sort/slice — phần đó làm ngoài cache theo query param)
    return concepts.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      domain: c.domain,
      difficulty: c.difficulty,
      previewQuestion: c.previewQuestion,
      previewAnswer: c.previewAnswer,
      masteryScore: masteryMap.get(c.id)?.score ?? null,
      masteryAttempts: masteryMap.get(c.id)?.attempts ?? 0,
      // lastSeenAt = mốc hoạt động gần nhất (học/đánh dấu) → sort "mới nhất lên đầu".
      lastSeenAt: masteryMap.get(c.id)?.lastSeenAt?.toISOString() ?? null,
      lastFlashcardAt: masteryMap.get(c.id)?.lastFlashcardAt?.toISOString() ?? null,
      lastQuizAt: masteryMap.get(c.id)?.lastQuizAt?.toISOString() ?? null,
      flashcardCount: fcMap.get(c.id) ?? 0,
      questionCount: qMap.get(c.id) ?? 0,
      examQuestionCount: exMap.get(c.id) ?? 0,
    }));
  });

  // Sort theo query param (ngoài cache — in-memory, rẻ; tránh fold sort vào key)
  atoms.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'difficulty') {
      const da = a.difficulty ?? 0.5;
      const db_ = b.difficulty ?? 0.5;
      return db_ - da; // khó trước
    }
    // 'mastery' (default): null trước (chưa biết), sau đó score ASC (yếu nhất)
    if (a.masteryScore === null && b.masteryScore !== null) return -1;
    if (a.masteryScore !== null && b.masteryScore === null) return 1;
    return (a.masteryScore ?? 0) - (b.masteryScore ?? 0);
  });

  return NextResponse.json({ atoms: atoms.slice(0, limit) });
}

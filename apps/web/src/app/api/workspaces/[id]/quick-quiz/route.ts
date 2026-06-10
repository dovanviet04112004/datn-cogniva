/**
 * GET /api/workspaces/[id]/quick-quiz — pick 5 random questions từ workspace.
 *
 * Phase V5.2 (atom-centric). Spec: docs/plans/v5-notebooklm-layout.md §5.
 *
 * Logic:
 *   1. Verify workspace thuộc user
 *   2. List concept IDs link với chunks của doc trong workspace
 *   3. Random 5 question có conceptId IN (concept IDs đó)
 *   4. Trả ID + prompt + options (KHÔNG trả correctAnswer — client submit
 *      mới gọi grade endpoint riêng để verify)
 *
 * Khác /quiz (full quiz): không tạo quiz row, không persistent attempt.
 * Là ephemeral practice — user trả lời → grade ngay → applyAttempt.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  chunk,
  chunkConcept,
  db,
  document,
  question,
  workspace,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: workspaceId } = await params;

  const [ws] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.userId, session.user.id)))
    .limit(1);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Concept IDs trong workspace
  const conceptRows = await db
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

  const conceptIds = conceptRows.map((r) => r.id);
  if (conceptIds.length === 0) {
    return NextResponse.json({ questions: [], hint: 'no-atoms' });
  }

  // Random 5 question
  const questions = await db
    .select({
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      options: question.options,
      conceptId: question.conceptId,
      difficulty: question.difficulty,
    })
    .from(question)
    .where(inArray(question.conceptId, conceptIds))
    .orderBy(sql`RANDOM()`)
    .limit(5);

  if (questions.length === 0) {
    return NextResponse.json({ questions: [], hint: 'no-questions' });
  }

  return NextResponse.json({ questions });
}

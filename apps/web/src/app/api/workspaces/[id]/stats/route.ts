/**
 * GET /api/workspaces/[id]/stats — đếm số content trong workspace.
 *
 * Trả: { stats: { documents, notes, flashcards, quizzes, exams, chats } }
 *
 * Dùng để client refresh badges sau khi tạo/xoá content trong tab.
 *
 * Auth: workspace phải thuộc user (chống IDOR).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';

import {
  conversation,
  dbReplica,
  document,
  exam,
  flashcard,
  note,
  quiz,
  workspace,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;
  const uid = session.user.id;

  // Verify workspace ownership — access-check NGOÀI cache (đọc replica, read thuần).
  const [ws] = await dbReplica
    .select({ id: workspace.id })
    .from(workspace)
    .where(and(eq(workspace.id, id), eq(workspace.userId, uid)))
    .limit(1);
  if (!ws) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // 6 COUNT badge stats là read thuần → cache-aside per-(user,workspace), TTL 30s
  // (đổi thường khi tạo/xoá content nên TTL ngắn). Bust qua onWorkspaceContentChanged
  // tại các route create/delete note/quiz/... Output toàn số nguyên → không cần
  // re-hydrate Date.
  const stats = await cached(ck.workspaceStats(uid, id), 30, async () => {
    // Count parallel — 6 queries cùng lúc
    const [
      [{ n: documents = 0 } = { n: 0 }],
      [{ n: notes = 0 } = { n: 0 }],
      [{ n: flashcards = 0 } = { n: 0 }],
      [{ n: quizzes = 0 } = { n: 0 }],
      [{ n: exams = 0 } = { n: 0 }],
      [{ n: chats = 0 } = { n: 0 }],
    ] = await Promise.all([
      dbReplica
        .select({ n: sql<number>`count(*)::int` })
        .from(document)
        .where(and(eq(document.userId, uid), eq(document.workspaceId, id))),
      dbReplica
        .select({ n: sql<number>`count(*)::int` })
        .from(note)
        .where(and(eq(note.userId, uid), eq(note.workspaceId, id))),
      dbReplica
        .select({ n: sql<number>`count(*)::int` })
        .from(flashcard)
        .where(and(eq(flashcard.userId, uid), eq(flashcard.workspaceId, id))),
      dbReplica
        .select({ n: sql<number>`count(*)::int` })
        .from(quiz)
        .where(and(eq(quiz.userId, uid), eq(quiz.workspaceId, id))),
      dbReplica
        .select({ n: sql<number>`count(*)::int` })
        .from(exam)
        .where(and(eq(exam.ownerId, uid), eq(exam.workspaceId, id))),
      dbReplica
        .select({ n: sql<number>`count(*)::int` })
        .from(conversation)
        .where(and(eq(conversation.userId, uid), eq(conversation.workspaceId, id))),
    ]);

    return { documents, notes, flashcards, quizzes, exams, chats };
  });

  return NextResponse.json({ stats });
}

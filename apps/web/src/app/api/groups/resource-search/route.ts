/**
 * GET /api/groups/resource-search?type=doc|flashcard|exam&q=...
 *
 * Search resource Cogniva để attach vào message. User chỉ thấy resource MÌNH SỞ HỮU
 * (document.userId / flashcard.userId / exam.ownerId = currentUser) — RBAC.
 *
 * Trả: { items: [{ id, title, type, description? }] } — limit 10.
 *
 * V2: future cho phép search resource public của group hoặc shared workspaces.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, ilike } from 'drizzle-orm';

import { db, document, exam, flashcard } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  const q = (url.searchParams.get('q') ?? '').trim();
  const uid = session.user.id;
  // Empty query OK — list 10 recent items để user pick mà không cần gõ keyword.
  const hasQuery = q.length >= 1;
  const like = hasQuery ? `%${q}%` : null;

  switch (type) {
    case 'doc': {
      const where = hasQuery
        ? and(eq(document.userId, uid), ilike(document.filename, like!))
        : eq(document.userId, uid);
      const rows = await db
        .select({ id: document.id, title: document.filename })
        .from(document)
        .where(where)
        .limit(10);
      return NextResponse.json({
        items: rows.map((r) => ({ id: r.id, title: r.title, type: 'doc' })),
      });
    }
    case 'flashcard': {
      const where = hasQuery
        ? and(eq(flashcard.userId, uid), ilike(flashcard.front, like!))
        : eq(flashcard.userId, uid);
      const rows = await db
        .select({ id: flashcard.id, front: flashcard.front })
        .from(flashcard)
        .where(where)
        .limit(10);
      return NextResponse.json({
        items: rows.map((r) => ({
          id: r.id,
          title: r.front.slice(0, 80),
          type: 'flashcard',
        })),
      });
    }
    case 'exam': {
      const where = hasQuery
        ? and(eq(exam.ownerId, uid), ilike(exam.title, like!))
        : eq(exam.ownerId, uid);
      const rows = await db
        .select({ id: exam.id, title: exam.title })
        .from(exam)
        .where(where)
        .limit(10);
      return NextResponse.json({
        items: rows.map((r) => ({ id: r.id, title: r.title, type: 'exam' })),
      });
    }
    default:
      return NextResponse.json({ error: 'type must be doc|flashcard|exam' }, { status: 400 });
  }
}

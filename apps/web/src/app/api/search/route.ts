/**
 * GET /api/search?q=text&limit=10 — global text search across:
 *   - documents (filename ILIKE)
 *   - concepts (name ILIKE)
 *   - flashcards (front ILIKE)
 *   - quizzes (title ILIKE)
 *   - notes (title ILIKE)
 *
 * Output:
 *   { results: [{ type, id, label, sublabel?, href }] }
 *
 * Phase 7 v1 dùng ILIKE đơn giản, đủ fast cho < 10k rows / user.
 * Phase 8+ có thể swap sang full-text search trên tsvector cột riêng.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, ilike, or } from 'drizzle-orm';

import {
  chunk,
  chunkConcept,
  concept,
  db,
  document,
  flashcard,
  note,
  quiz,
} from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

export type SearchResult = {
  type: 'document' | 'concept' | 'flashcard' | 'quiz' | 'note';
  id: string;
  label: string;
  sublabel?: string;
  href: string;
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 10), 30);
  if (!q) return NextResponse.json({ results: [] });

  const pattern = `%${q}%`;
  const userId = session.user.id;

  // Chạy 5 truy vấn song song
  const [docs, concepts, cards, quizzes, notes] = await Promise.all([
    db
      .select({ id: document.id, label: document.filename })
      .from(document)
      .where(and(eq(document.userId, userId), ilike(document.filename, pattern)))
      .limit(limit),

    // Concept không có user_id trực tiếp → scope qua chunk_concept → chunk → document
    db
      .selectDistinct({ id: concept.id, label: concept.name, sublabel: concept.domain })
      .from(concept)
      .innerJoin(chunkConcept, eq(chunkConcept.conceptId, concept.id))
      .innerJoin(chunk, eq(chunk.id, chunkConcept.chunkId))
      .innerJoin(document, eq(document.id, chunk.documentId))
      .where(and(eq(document.userId, userId), ilike(concept.name, pattern)))
      .limit(limit),

    db
      .select({
        id: flashcard.id,
        label: flashcard.front,
        sublabel: flashcard.cardType,
      })
      .from(flashcard)
      .where(
        and(
          eq(flashcard.userId, userId),
          or(ilike(flashcard.front, pattern), ilike(flashcard.back, pattern)),
        ),
      )
      .limit(limit),

    db
      .select({ id: quiz.id, label: quiz.title })
      .from(quiz)
      .where(and(eq(quiz.userId, userId), ilike(quiz.title, pattern)))
      .limit(limit),

    db
      .select({ id: note.id, label: note.title })
      .from(note)
      .where(and(eq(note.userId, userId), ilike(note.title, pattern)))
      .limit(limit),
  ]);

  const results: SearchResult[] = [
    ...docs.map((d) => ({
      type: 'document' as const,
      id: d.id,
      label: d.label,
      href: `/documents`,
    })),
    ...concepts.map((c) => ({
      type: 'concept' as const,
      id: c.id,
      label: c.label,
      sublabel: c.sublabel,
      href: `/graph#${c.id}`,
    })),
    ...cards.map((f) => ({
      type: 'flashcard' as const,
      id: f.id,
      label: f.label,
      sublabel: f.sublabel,
      href: `/flashcards`,
    })),
    ...quizzes.map((q) => ({
      type: 'quiz' as const,
      id: q.id,
      label: q.label,
      href: `/quiz/${q.id}/attempt`,
    })),
    ...notes.map((n) => ({
      type: 'note' as const,
      id: n.id,
      label: n.label || 'Untitled',
      href: `/notes/${n.id}`,
    })),
  ];

  return NextResponse.json({ results });
}

/**
 * GET /api/conversations/[id]/messages — load messages của 1 conversation.
 *
 * V6 (2026-05-20): ChatView trong workspace notebook cần load messages
 * khi user switch sang conv khác. Mapping role enum UPPERCASE → AI SDK
 * lowercase + restore citations từ jsonb.
 *
 * Bảo mật: scope theo session.user.id (chống IDOR).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { chunk, conversation, db, document, message } from '@cogniva/db';

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [conv] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.userId, session.user.id)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const dbMessages = await db
    .select()
    .from(message)
    .where(eq(message.conversationId, id))
    .orderBy(asc(message.createdAt));

  // Hydrate citations cho mỗi message — 1 query JOIN tránh N+1.
  // Citation jsonb compact chỉ lưu chunkId + score + snippet; cần JOIN
  // chunk + document để restore documentId/filename/page cho UI.
  const allChunkIds = new Set<string>();
  for (const m of dbMessages) {
    if (Array.isArray(m.citations)) {
      for (const c of m.citations) {
        if (typeof c === 'object' && c !== null && 'chunkId' in c) {
          const cid = String((c as { chunkId: unknown }).chunkId);
          if (cid) allChunkIds.add(cid);
        }
      }
    }
  }

  const chunkLookup = new Map<
    string,
    { documentId: string; filename: string; page: number | null }
  >();
  if (allChunkIds.size > 0) {
    const rows = await db
      .select({
        chunkId: chunk.id,
        documentId: chunk.documentId,
        metadata: chunk.metadata,
        filename: document.filename,
      })
      .from(chunk)
      .innerJoin(document, eq(document.id, chunk.documentId))
      .where(inArray(chunk.id, Array.from(allChunkIds)));
    for (const r of rows) {
      const page =
        typeof r.metadata === 'object' && r.metadata && 'page' in r.metadata
          ? Number((r.metadata as { page: unknown }).page) || null
          : null;
      chunkLookup.set(r.chunkId, {
        documentId: r.documentId,
        filename: r.filename,
        page,
      });
    }
  }

  const messages = dbMessages.map((m) => {
    const citations = Array.isArray(m.citations)
      ? m.citations.map((c, i) => {
          const cid =
            typeof c === 'object' && c !== null && 'chunkId' in c
              ? String((c as { chunkId: unknown }).chunkId)
              : '';
          const hydrated = chunkLookup.get(cid);
          return {
            n: i + 1,
            chunkId: cid,
            documentId: hydrated?.documentId ?? '',
            filename: hydrated?.filename ?? '',
            page: hydrated?.page ?? null,
            score:
              typeof c === 'object' && c !== null && 'score' in c
                ? Number((c as { score: unknown }).score)
                : 0,
            snippet:
              typeof c === 'object' && c !== null && 'snippet' in c
                ? String((c as { snippet: unknown }).snippet)
                : '',
          };
        })
      : [];
    return {
      id: m.id,
      role: m.role.toLowerCase() as 'user' | 'assistant' | 'system',
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      annotations: citations.length > 0 ? [{ type: 'citations', citations }] : undefined,
    };
  });

  return NextResponse.json({
    conversation: {
      id: conv.id,
      title: conv.title,
      workspaceId: conv.workspaceId,
      createdAt: conv.createdAt.toISOString(),
    },
    messages,
  });
}

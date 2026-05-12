/**
 * /chat/[id] — load 1 hội thoại đã có sẵn + render ChatInterface với
 * initialMessages.
 *
 * Verify ownership ở server: 404 nếu conversation không thuộc user.
 * Map message từ DB schema (role enum UPPERCASE) sang AI SDK format
 * (role lowercase: user|assistant|system) + restore citations từ jsonb.
 */
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Message as AIMessage } from 'ai';

import { chunk, conversation, db, document, message } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { ChatInterface } from '@/components/chat/chat-interface';
import type { CitationData } from '@/components/chat/citation';

export const runtime = 'nodejs';

type Props = {
  params: Promise<{ id: string }>;
};

/**
 * Map citation DB schema → CitationData UI.
 *
 * DB jsonb chỉ lưu `{ chunkId, score, snippet }` (compact). Sau reload chat
 * page cần JOIN chunk + document để re-hydrate `documentId`, `filename`,
 * `page` — nếu thiếu, UI click citation sẽ fail (URL `/api/documents//file`
 * = 404).
 *
 * 1 query batch cho tất cả message của conversation thay vì N+1.
 */
async function loadCitationsForMessages(
  rawCitationsList: Array<unknown>,
): Promise<CitationData[][]> {
  // Gom tất cả chunkId từ tất cả message → 1 query JOIN
  const allChunkIds = new Set<string>();
  for (const raw of rawCitationsList) {
    if (!Array.isArray(raw)) continue;
    for (const c of raw) {
      if (typeof c === 'object' && c !== null && 'chunkId' in c) {
        const id = String(c.chunkId);
        if (id) allChunkIds.add(id);
      }
    }
  }

  // Lookup map chunkId → { documentId, filename, page }
  const lookup = new Map<string, { documentId: string; filename: string; page: number | null }>();
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
      const page = typeof r.metadata === 'object' && r.metadata && 'page' in r.metadata
        ? Number((r.metadata as { page: unknown }).page) || null
        : null;
      lookup.set(r.chunkId, {
        documentId: r.documentId,
        filename: r.filename,
        page,
      });
    }
  }

  return rawCitationsList.map((raw) => {
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return raw.map((c, i) => {
      const chunkId =
        typeof c === 'object' && c !== null && 'chunkId' in c ? String(c.chunkId) : '';
      const hydrated = lookup.get(chunkId);
      return {
        n: i + 1,
        chunkId,
        documentId: hydrated?.documentId ?? '',
        filename: hydrated?.filename ?? '',
        page: hydrated?.page ?? null,
        score: typeof c === 'object' && c !== null && 'score' in c ? Number(c.score) : 0,
        snippet:
          typeof c === 'object' && c !== null && 'snippet' in c ? String(c.snippet) : '',
      };
    });
  });
}

export default async function ChatDetailPage({ params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const { id } = await params;

  const [conv] = await db
    .select()
    .from(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.userId, session.user.id)))
    .limit(1);
  if (!conv) notFound();

  const dbMessages = await db
    .select()
    .from(message)
    .where(eq(message.conversationId, id))
    .orderBy(asc(message.createdAt));

  // Hydrate citations cho TẤT CẢ message qua 1 query JOIN — tránh N+1
  const citationsArrays = await loadCitationsForMessages(dbMessages.map((m) => m.citations));

  const initialMessages: AIMessage[] = dbMessages.map((m, idx) => {
    const citations = citationsArrays[idx] ?? [];
    const role = (m.role.toLowerCase() as AIMessage['role']) ?? 'user';
    return {
      id: m.id,
      role,
      content: m.content,
      createdAt: m.createdAt,
      annotations: citations.length > 0 ? [{ type: 'citations', citations }] : undefined,
    };
  });

  return <ChatInterface conversationId={id} initialMessages={initialMessages} />;
}

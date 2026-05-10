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
import { and, asc, eq } from 'drizzle-orm';
import type { Message as AIMessage } from 'ai';

import { conversation, db, message } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { ChatInterface } from '@/components/chat/chat-interface';
import type { CitationData } from '@/components/chat/citation';

export const runtime = 'nodejs';

type Props = {
  params: Promise<{ id: string }>;
};

/**
 * Map citation DB schema → CitationData UI. DB lưu chunkId + score +
 * snippet thôi (compact); cần re-hydrate filename + page bằng query
 * thêm. Phase 2 v1 đơn giản — Phase 3 sẽ JOIN sẵn để 1 query.
 */
async function loadCitationsForMessage(
  rawCitations: unknown,
): Promise<CitationData[]> {
  if (!Array.isArray(rawCitations) || rawCitations.length === 0) return [];

  // Tạm thời chỉ trả lại data có sẵn trong jsonb; UI vẫn render đủ snippet
  // nhưng filename/page sẽ trống. Phase 3 sẽ JOIN với chunk + document.
  return rawCitations.map((c, i) => ({
    n: i + 1,
    chunkId: typeof c === 'object' && c !== null && 'chunkId' in c ? String(c.chunkId) : '',
    documentId: '',
    filename: '',
    page: null,
    score: typeof c === 'object' && c !== null && 'score' in c ? Number(c.score) : 0,
    snippet: typeof c === 'object' && c !== null && 'snippet' in c ? String(c.snippet) : '',
  }));
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

  // Map DB message → AI SDK Message format
  const initialMessages: AIMessage[] = await Promise.all(
    dbMessages.map(async (m) => {
      const citations = await loadCitationsForMessage(m.citations);
      const role = (m.role.toLowerCase() as AIMessage['role']) ?? 'user';
      return {
        id: m.id,
        role,
        content: m.content,
        createdAt: m.createdAt,
        annotations: citations.length > 0 ? [{ type: 'citations', citations }] : undefined,
      };
    }),
  );

  return <ChatInterface conversationId={id} initialMessages={initialMessages} />;
}

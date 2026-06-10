/**
 * /chat/[id] — view 1 conversation cụ thể (persistent).
 *
 * V7 (2026-05-20): page đơn giản, KHÔNG còn ChatShell. Workspace chat đã
 * thay thế /chat/new entry. Page này chỉ dùng cho:
 *   - Deep link 1 conv
 *   - Click "Full" từ workspace ChatView ConversationSwitcher
 *   - Share URL
 *
 * Server: verify ownership, load messages + workspace name (nếu có).
 * Client: ChatDetailClient render simple chat + composer.
 */
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Message as AIMessage } from 'ai';

import { chunk, conversation, db, document, message, workspace } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { ChatDetailClient } from '@/components/chat/chat-detail-client';

export const runtime = 'nodejs';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ChatDetailPage({ params }: Props) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const { id } = await params;

  // Load conversation + verify ownership + join workspace name
  const [conv] = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      workspaceId: conversation.workspaceId,
      workspaceName: workspace.name,
    })
    .from(conversation)
    .leftJoin(workspace, eq(workspace.id, conversation.workspaceId))
    .where(and(eq(conversation.id, id), eq(conversation.userId, session.user.id)))
    .limit(1);
  if (!conv) notFound();

  const dbMessages = await db
    .select()
    .from(message)
    .where(eq(message.conversationId, id))
    .orderBy(asc(message.createdAt));

  // V8: hydrate citations cho assistant messages — JOIN chunk + document
  // để có documentId/filename/page (DB chỉ lưu chunkId compact). Batch
  // 1 query thay vì N+1.
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

  const initialMessages: AIMessage[] = dbMessages.map((m) => {
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
      role: m.role.toLowerCase() as AIMessage['role'],
      content: m.content,
      createdAt: m.createdAt,
      annotations:
        citations.length > 0 ? [{ type: 'citations', citations }] : undefined,
    };
  });

  return (
    <div className="h-full">
      <ChatDetailClient
        conversation={{
          id: conv.id,
          title: conv.title,
          workspaceId: conv.workspaceId,
          workspaceName: conv.workspaceName,
        }}
        initialMessages={initialMessages}
      />
    </div>
  );
}

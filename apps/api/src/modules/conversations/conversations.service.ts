import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { onConversationsChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';

type ConversationListRow = {
  id: string;
  title: string | null;
  workspace_id: string | null;
  created_at: Date;
  last_message_at: Date | null;
};

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listConversations(userId: string, workspaceParam: string | null, limit: number) {
    const conditions = [Prisma.sql`c.user_id = ${userId}`];
    if (workspaceParam === 'null') {
      conditions.push(Prisma.sql`c.workspace_id IS NULL`);
    } else if (workspaceParam) {
      conditions.push(Prisma.sql`c.workspace_id = ${workspaceParam}`);
    }

    const rows = await this.prisma.$queryRaw<ConversationListRow[]>(Prisma.sql`
      SELECT c.id, c.title, c.workspace_id, c.created_at,
        (SELECT max(m.created_at) FROM message m WHERE m.conversation_id = c.id) AS last_message_at
      FROM conversation c
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY c.created_at DESC
      LIMIT ${limit}`);

    return {
      conversations: rows.map((r) => ({
        id: r.id,
        title: r.title,
        workspaceId: r.workspace_id,
        createdAt: r.created_at.toISOString(),
        lastMessageAt: r.last_message_at ? r.last_message_at.toISOString() : null,
      })),
    };
  }

  async deleteConversation(userId: string, id: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, user_id: userId },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException({ error: 'Not found' });

    await this.prisma.conversation.delete({ where: { id } });
    await onConversationsChanged(userId);
    return { ok: true };
  }

  async getMessages(userId: string, id: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, user_id: userId },
      include: { workspace: { select: { name: true } } },
    });
    if (!conv) throw new NotFoundException({ error: 'Not found' });

    const dbMessages = await this.prisma.message.findMany({
      where: { conversation_id: id },
      orderBy: { created_at: 'asc' },
    });

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
      const rows = await this.prisma.chunk.findMany({
        where: { id: { in: Array.from(allChunkIds) } },
        select: {
          id: true,
          document_id: true,
          metadata: true,
          document: { select: { filename: true } },
        },
      });
      for (const r of rows) {
        const page =
          typeof r.metadata === 'object' && r.metadata && 'page' in r.metadata
            ? Number((r.metadata as { page: unknown }).page) || null
            : null;
        chunkLookup.set(r.id, {
          documentId: r.document_id,
          filename: r.document.filename,
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
        createdAt: m.created_at.toISOString(),
        annotations: citations.length > 0 ? [{ type: 'citations', citations }] : undefined,
      };
    });

    return {
      conversation: {
        id: conv.id,
        title: conv.title,
        workspaceId: conv.workspace_id,
        workspaceName: conv.workspace?.name ?? null,
        createdAt: conv.created_at.toISOString(),
      },
      messages,
    };
  }
}

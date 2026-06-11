/**
 * ChatService — DB side của POST /api/chat (port từ apps/web/src/app/api/chat/route.ts)
 * + 2 route đọc /api/chat/conversations (port từ apps/web/src/app/api/chat/conversations/**).
 *
 * Giữ nguyên semantics web:
 *   - Conversation auto-create (title = query 60 ký tự đầu) bust onDashboardChanged
 *     + onConversationsChanged; verify ownership → 404.
 *   - INSERT user message TRƯỚC stream — stream fail thì user message vẫn persist
 *     (orphan risk đã chấp nhận từ bản web).
 *   - Atom pin context (Phase D): load concept + chunk gốc qua chunk_concept,
 *     prepend block "ATOM USER ĐANG FOCUS" — fail-safe try/catch.
 *   - Persist ASSISTANT message (citations + metadata cost/model/provider/tokens/
 *     cacheHit) rồi bust onAnalyticsChanged + onConversationsChanged — cùng
 *     choke-point ghi message như web.
 *   - List conversations cache-aside 60s key ck.conversationsList(userId).
 */
import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import {
  onAnalyticsChanged,
  onConversationsChanged,
  onDashboardChanged,
} from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import type { RetrievedChunk } from './retrieval/retrieval.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  /** Tạo conversation mới + bust dashboard/conversations cache. Trả id. */
  async createConversation(
    userId: string,
    workspaceId: string | undefined,
    title: string,
  ): Promise<string> {
    const created = await this.prisma.conversation.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        workspace_id: workspaceId ?? null,
        title,
      },
      select: { id: true },
    });
    // Conversation mới → dashboard totalConv đổi. (Message thêm vào conv cũ
    // KHÔNG đổi count nên chỉ bust ở đây.)
    await onDashboardChanged(userId);
    // Conversations list (sidebar chat) có thêm 1 dòng mới → bust để list tươi.
    await onConversationsChanged(userId);
    return created.id;
  }

  /** Verify ownership (chống IDOR) — true nếu conversation thuộc user. */
  async isConversationOwned(userId: string, convId: string): Promise<boolean> {
    const owned = await this.prisma.conversation.findFirst({
      where: { id: convId, user_id: userId },
      select: { id: true },
    });
    return owned !== null;
  }

  /** INSERT user message TRƯỚC stream — giữ nguyên orphan risk như web. */
  async insertUserMessage(convId: string, content: string): Promise<void> {
    await this.prisma.message.create({
      data: {
        id: randomUUID(),
        conversation_id: convId,
        role: 'USER',
        content,
        citations: [],
        metadata: {},
      },
    });
  }

  /**
   * Phase D (atom-centric): pinned atom context. Load atom info + chunks gốc
   * (qua chunk_concept pivot) → build block PREPEND vào system prompt như
   * "must-include context" (luôn-có, không phụ thuộc retrieval similarity).
   * Fail-safe: lỗi → trả '' + log warn, không chặn chat.
   */
  async buildAtomContext(userId: string, atomIds: string[]): Promise<string> {
    if (atomIds.length === 0) return '';
    try {
      const atoms = await this.prisma.concept.findMany({
        where: { id: { in: atomIds } },
        select: {
          id: true,
          name: true,
          description: true,
          examples: true,
          domain: true,
          preview_question: true,
          preview_answer: true,
        },
      });

      // Lấy 1-2 chunk gốc cho mỗi atom (qua pivot) để có nguồn cụ thể.
      // `page` không phải column rời — nằm trong chunk.metadata jsonb.
      const pivotRows = await this.prisma.chunk_concept.findMany({
        where: {
          concept_id: { in: atomIds },
          chunk: { document: { user_id: userId } },
        },
        select: {
          concept_id: true,
          chunk: {
            select: {
              content: true,
              metadata: true,
              document: { select: { filename: true } },
            },
          },
        },
        take: atomIds.length * 2,
      });
      const atomChunks = pivotRows.map((r) => ({
        atomId: r.concept_id,
        content: r.chunk.content,
        filename: r.chunk.document.filename,
        metadata: r.chunk.metadata,
      }));

      // Build prepend block — template giữ NGUYÊN byte từ web
      const sections: string[] = [];
      for (const atom of atoms) {
        const examples =
          Array.isArray(atom.examples) && atom.examples.length > 0
            ? `\n  Ví dụ: ${(atom.examples as string[]).slice(0, 3).join('; ')}`
            : '';
        const preview = atom.preview_question
          ? `\n  Q: ${atom.preview_question}${atom.preview_answer ? `\n  A: ${atom.preview_answer}` : ''}`
          : '';
        const chunks = atomChunks
          .filter((c) => c.atomId === atom.id)
          .map((c) => {
            const page =
              typeof c.metadata === 'object' && c.metadata && 'page' in c.metadata
                ? Number((c.metadata as { page: unknown }).page)
                : null;
            return `  [${c.filename}${page ? `, trang ${page}` : ''}]: ${c.content.slice(0, 400)}`;
          })
          .join('\n');
        sections.push(
          `- **${atom.name}** (${atom.domain})${atom.description ? `: ${atom.description}` : ''}${examples}${preview}${chunks ? `\n  Trích nguồn:\n${chunks}` : ''}`,
        );
      }

      if (sections.length > 0) {
        return `\n\n## 🎯 ATOM USER ĐANG FOCUS\n\nUser mở AI Tutor từ trang atom (knowledge unit) cụ thể. Hãy trả lời TẬP TRUNG VÀO atom dưới đây — không lan man sang khái niệm khác trừ khi user hỏi:\n\n${sections.join('\n\n')}\n`;
      }
      return '';
    } catch (err) {
      logger.warn('chat.atom_context_failed', {
        user_id: userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return '';
    }
  }

  /**
   * Persist ASSISTANT message sau khi stream xong (gọi từ finishPromise) +
   * bust analytics/conversations cache. Cost đã được router record — đây
   * chỉ là DB message + cache bust.
   */
  async persistAssistantMessage(args: {
    userId: string;
    convId: string;
    text: string;
    chunks: RetrievedChunk[];
    modelId: string;
    providerId: string;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    cacheHit: boolean;
  }): Promise<void> {
    await this.prisma.message.create({
      data: {
        id: randomUUID(),
        conversation_id: args.convId,
        role: 'ASSISTANT',
        content: args.text,
        citations: args.chunks.map((c) => ({
          chunkId: c.id,
          score: c.score,
          snippet: c.content.slice(0, 240),
        })),
        metadata: {
          model: args.modelId,
          provider: args.providerId,
          promptTokens: args.promptTokens,
          completionTokens: args.completionTokens,
          costUsd: args.costUsd,
          retrievalStrategy: 'vector-top5',
          chunkCount: args.chunks.length,
          cacheHit: args.cacheHit,
        },
      },
    });

    // ASSISTANT message mới (có cost trong metadata) → analytics 30 ngày của
    // user đã cũ. Bust cache (fail-open). Co-located tại đúng điểm ghi message.
    await onAnalyticsChanged(args.userId);
    // messageCount + thứ tự "mới nhất" của conversations list cũng đổi theo
    // message mới → bust list (sidebar chat).
    await onConversationsChanged(args.userId);
  }

  /**
   * GET /chat/conversations — list id/title/createdAt/messageCount, desc
   * createdAt, limit 50. Cache-aside 60s key ck.conversationsList(userId),
   * invalidate qua onConversationsChanged. LEFT JOIN subquery count →
   * conversation 0 message có messages = null (giữ nguyên shape Drizzle cũ).
   */
  async listConversations(userId: string) {
    const conversations = await cached(ck.conversationsList(userId), 60, async () => {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; title: string | null; created_at: Date; messages: number | null }>
      >(Prisma.sql`
        SELECT c.id, c.title, c.created_at, mc.n AS messages
        FROM conversation c
        LEFT JOIN (
          SELECT conversation_id, count(id)::int AS n
          FROM message
          GROUP BY conversation_id
        ) mc ON mc.conversation_id = c.id
        WHERE c.user_id = ${userId}
        ORDER BY c.created_at DESC
        LIMIT 50`);
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.created_at.toISOString(),
        messages: r.messages,
      }));
    });

    return { conversations };
  }

  /**
   * GET /chat/conversations/:id — 1 conversation + toàn bộ messages asc
   * createdAt để hydrate useChat. IDOR check → 404 {error:'Not found'}.
   * Wire shape = full row Drizzle cũ (camelCase, role UPPERCASE).
   */
  async getConversation(userId: string, id: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, user_id: userId },
    });
    if (!conv) throw new NotFoundException({ error: 'Not found' });

    const rows = await this.prisma.message.findMany({
      where: { conversation_id: id },
      orderBy: { created_at: 'asc' },
    });

    return {
      conversation: {
        id: conv.id,
        userId: conv.user_id,
        workspaceId: conv.workspace_id,
        title: conv.title,
        createdAt: conv.created_at.toISOString(),
      },
      messages: rows.map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        role: m.role,
        content: m.content,
        citations: m.citations,
        metadata: m.metadata,
        createdAt: m.created_at.toISOString(),
      })),
    };
  }
}

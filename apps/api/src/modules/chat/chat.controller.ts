/**
 * POST /api/chat — endpoint streaming chat chính, port TRUNG THỰC từ
 * apps/web/src/app/api/chat/route.ts.
 *
 * Flow: auth (guard global) → rate-limit 'chat' 30/min → parse body →
 * conversation auto-create/verify → INSERT user message TRƯỚC stream →
 * buildChatContext (RAG advanced) → atom pin context → routedStreamText
 * (ragChat: guardrail + circuit breaker + fallback chain + cost record) →
 * AI SDK v4 Data Stream Protocol qua Express res.
 *
 * Wire format (client useChat parse, KHÔNG đổi được):
 *   Headers: Content-Type text/plain; charset=utf-8 + X-Vercel-AI-Data-Stream: v1
 *   Frame đầu 8:[{type:'citations',...}] (writeMessageAnnotation) → client
 *   render khung citations sớm; rồi 2:[{type:'meta',conversationId}]
 *   (writeData) → chat-view bắt conversationId mới tạo; rồi f:/0:/e:/d: từ
 *   mergeIntoDataStream. pipeDataStreamToResponse tự set headers + format.
 *
 * Lỗi TRƯỚC stream trả PLAIN TEXT (useChat surface qua onError):
 *   rate-limit → 429 + Retry-After; guardrail → 429 + X-Cost-Reason;
 *   AllProvidersFailed → 503.
 */
import { Controller, Post, Body, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { pipeDataStreamToResponse } from 'ai';
import { logger } from '@cogniva/server-core';
import { checkLimit } from '@cogniva/server-core/rate-limit';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/auth/session.types';
import {
  RouterService,
  CostGuardrailError,
  AllProvidersFailedError,
  type RoutedStreamResult,
} from '../../infra/ai/router.service';
import type { Plan } from '../../infra/ai/cost-guardrail.service';

import { ChatService } from './chat.service';
import { RetrievalService } from './retrieval/retrieval.service';

/** Body từ useChat: messages + các field merge qua option `body`. */
type ChatRequestBody = {
  messages?: Array<{ role?: string; content?: unknown }>;
  /** Nếu null/undefined → tạo conversation mới. */
  conversationId?: string | null;
  /** Optional scope retrieval theo workspace. */
  workspaceId?: string;
  /** Optional pin tài liệu cụ thể — AI chỉ search trong subset này. */
  documentIds?: string[];
  /** Phase D (atom-centric): pin atom đang focus (cap 5). */
  atomIds?: string[];
};

@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly retrieval: RetrievalService,
    private readonly router: RouterService,
  ) {}

  @Post()
  async stream(
    @CurrentUser() user: AuthUser,
    @Body() body: ChatRequestBody,
    @Res() res: Response,
  ): Promise<void> {
    const userId = user.id;
    const plan = (user.plan ?? 'FREE') as Plan;

    // ── 2. Rate limit (30 req/phút/user cho chat) ────
    const rl = await checkLimit(`chat:${userId}`, 'chat');
    if (!rl.allowed) {
      res
        .status(429)
        .set('Retry-After', String(rl.retryAfter ?? 60))
        .send('Too many requests');
      return;
    }

    // ── 3. Parse body (manual check như route cũ — lỗi trả plain text) ─
    const { messages, conversationId: rawConvId, workspaceId, documentIds, atomIds } = body;
    // Safety: chỉ nhận array of string, đề phòng client truyền type sai
    const safeDocIds =
      Array.isArray(documentIds) && documentIds.every((id) => typeof id === 'string')
        ? documentIds
        : undefined;
    const safeAtomIds =
      Array.isArray(atomIds) && atomIds.every((id) => typeof id === 'string')
        ? atomIds.slice(0, 5)
        : undefined;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).send('messages required');
      return;
    }

    // ── 4. Lấy query ──────────────────────────────────
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser?.content) {
      res.status(400).send('No user message found');
      return;
    }
    // Message có attachment (image) → content là array part; lấy text part đầu.
    let query: string;
    if (typeof lastUser.content === 'string') {
      query = lastUser.content;
    } else if (Array.isArray(lastUser.content)) {
      const textPart = (lastUser.content as Array<{ type?: string; text?: string }>).find(
        (p) => p?.type === 'text' && typeof p.text === 'string',
      );
      query = textPart?.text ?? '';
    } else {
      query = '';
    }
    // User chỉ gửi ảnh → placeholder để retrieval không crash (RAG trả 0 chunks).
    const queryForRetrieval = query.trim() || '[image-only message]';

    // ── 5. Tạo / load conversation ────────────────────
    let convId = rawConvId ?? undefined;
    if (!convId) {
      convId = await this.chat.createConversation(userId, workspaceId, query.slice(0, 60));
    } else {
      const owned = await this.chat.isConversationOwned(userId, convId);
      if (!owned) {
        res.status(404).send('Conversation not found');
        return;
      }
    }

    // ── 6. Lưu user message TRƯỚC stream (orphan risk giữ nguyên) ─────
    await this.chat.insertUserMessage(convId, query);

    // ── 7. Retrieve + build context (Langfuse trace bỏ — không có ở api) ─
    const context = await this.retrieval.buildChatContext({
      query: queryForRetrieval,
      userId,
      plan,
      workspaceId,
      documentIds: safeDocIds,
    });

    // ── 7.5. Atom pin context (fail-safe trong service) ───────────────
    const atomSystemAddition = safeAtomIds?.length
      ? await this.chat.buildAtomContext(userId, safeAtomIds)
      : '';

    const finalSystemPrompt = context.systemPrompt + atomSystemAddition;

    // ── 8. Stream qua router (guardrail + circuit breaker tự động) ────
    let routed: RoutedStreamResult;
    try {
      routed = await this.router.routedStreamText({
        useCase: 'ragChat',
        userId,
        plan,
        system: finalSystemPrompt,
        messages: messages.slice(-10).map((m) => ({
          role: m.role as 'user' | 'assistant' | 'system',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        })),
        // Estimate input từ system prompt + 10 message gần
        estimatedInputTokens: Math.ceil(
          (finalSystemPrompt.length +
            messages
              .slice(-10)
              .reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 100), 0)) /
            3,
        ),
        maxOutputTokens: 2000,
        feature: 'chat',
      });
    } catch (err) {
      if (err instanceof CostGuardrailError) {
        logger.warn('chat.cost_blocked', { user_id: userId, reason: err.reason });
        res.status(429).set('X-Cost-Reason', err.reason).send(err.message);
        return;
      }
      if (err instanceof AllProvidersFailedError) {
        logger.error('chat.all_providers_failed', {
          user_id: userId,
          last_error: err.lastError?.message,
        });
        res.status(503).send('AI không khả dụng — vui lòng thử lại sau ít phút.');
        return;
      }
      throw err;
    }

    // ── 9. Stream response với dataStream (citations + meta) ──────────
    const chunks = context.chunks;
    pipeDataStreamToResponse(res, {
      execute: (dataStream) => {
        // Gửi citations + conversationId NGAY ĐẦU stream để client render
        // khung citations và navigate URL trước khi LLM trả full text.
        dataStream.writeMessageAnnotation({
          type: 'citations',
          citations: chunks.map((c, i) => ({
            n: i + 1,
            chunkId: c.id,
            documentId: c.documentId,
            filename: c.filename,
            page: c.page,
            score: c.score,
            snippet: c.content.slice(0, 240),
          })),
        });
        dataStream.writeData({ type: 'meta', conversationId: convId! });

        // Wire onFinish qua router.finishPromise — persist assistant message.
        // Cost đã được router record trong onFinish của streamText.
        routed.finishPromise
          .then(async ({ text, promptTokens, completionTokens, modelId, providerId, costUsd, cacheHit }) => {
            await this.chat.persistAssistantMessage({
              userId,
              convId: convId!,
              text,
              chunks,
              modelId,
              providerId,
              promptTokens,
              completionTokens,
              costUsd,
              cacheHit,
            });
          })
          .catch((err: unknown) => {
            logger.error('chat.finish_promise_error', {
              user_id: userId,
              conversation_id: convId,
              error: err instanceof Error ? err.message : String(err),
            });
          });

        // Merge stream từ router vào dataStream (raw streamText result)
        routed.result.mergeIntoDataStream(dataStream);
      },
      onError: (err) => {
        console.error('[api/chat] stream error:', err);
        return err instanceof Error ? err.message : 'Internal error';
      },
    });
  }
}

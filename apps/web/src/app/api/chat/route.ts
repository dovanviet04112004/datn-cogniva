/**
 * POST /api/chat — endpoint streaming chat MVP cho Cogniva.
 *
 * Luồng:
 *   1. Auth check qua Better Auth session
 *   2. Rate limit (30 req/phút/user — preset 'chat')
 *   3. Parse body { messages, conversationId? }
 *   4. Lấy query = nội dung message cuối của user
 *   5. buildChatContext(query) → embed + retrieve top-5 + build system prompt
 *   6. Tạo / load conversation, lưu user message
 *   7. **routedStreamText** với use case `ragChat`:
 *        - Pre-check cost guardrail (per-request cap + daily quota + global circuit)
 *        - Circuit breaker per provider — auto fallback chain
 *        - Auto record cost actual sau khi stream xong
 *   8. Trả dataStream với citations + meta annotation
 *
 * Migration Stage 1 W5-6:
 *   - Thay `getChatModel()` raw → `routedStreamText` (cost guardrail + fallback)
 *   - Thay `calcCostUsd` + manual log → `recordCost` qua router
 *   - Vẫn giữ Langfuse trace cho dashboard compat
 *
 * Tracing: bao toàn flow trong 1 Langfuse trace (no-op nếu chưa cấu hình).
 */
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';
import { type Message, createDataStreamResponse } from 'ai';

import { conversation, db, message as messageTable } from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  routedStreamText,
  CostGuardrailError,
  AllProvidersFailedError,
} from '@/lib/ai/router';
import { buildChatContext } from '@/lib/chat/pipeline';
import { startTrace } from '@/lib/observability/langfuse';
import { trackEvent } from '@/lib/observability/posthog';
import { logger } from '@/lib/observability/logger';
import { checkLimit } from '@/lib/rate-limit';
import type { Plan } from '@/lib/observability/cost-guardrail';

export const runtime = 'nodejs';
export const maxDuration = 120;

type ChatRequestBody = {
  messages: Message[];
  /** Nếu null/undefined → tạo conversation mới. */
  conversationId?: string | null;
  /** Optional scope retrieval theo workspace. */
  workspaceId?: string;
};

export async function POST(request: Request) {
  // ── 1. Auth ───────────────────────────────────────
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response('Unauthorized', { status: 401 });
  const userId = session.user.id;
  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;

  // ── 2. Rate limit (30 req/phút/user cho chat) ────
  const rl = await checkLimit(`chat:${userId}`, 'chat');
  if (!rl.allowed) {
    return new Response('Too many requests', {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfter ?? 60) },
    });
  }

  // ── 3. Parse body ─────────────────────────────────
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const { messages, conversationId: rawConvId, workspaceId } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response('messages required', { status: 400 });
  }

  // ── 4. Lấy query ──────────────────────────────────
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser?.content) {
    return new Response('No user message found', { status: 400 });
  }
  // Khi message có attachment (image), AI SDK đưa content thành array
  // [{ type: 'text', text: '...' }, ...]. Lấy text part đầu tiên làm query.
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
  // Khi user chỉ gửi ảnh (không text), dùng placeholder để retrieval không crash
  // — RAG sẽ trả 0 chunks và model trả lời thuần vision.
  const queryForRetrieval = query.trim() || '[image-only message]';

  // ── 5. Tạo / load conversation ────────────────────
  let convId = rawConvId ?? undefined;
  if (!convId) {
    const [created] = await db
      .insert(conversation)
      .values({
        userId,
        workspaceId: workspaceId ?? null,
        title: query.slice(0, 60),
      })
      .returning();
    if (!created) return new Response('Failed to create conversation', { status: 500 });
    convId = created.id;
  } else {
    const owned = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(and(eq(conversation.id, convId), eq(conversation.userId, userId)))
      .limit(1);
    if (owned.length === 0) {
      return new Response('Conversation not found', { status: 404 });
    }
  }

  // ── 6. Lưu user message ───────────────────────────
  await db.insert(messageTable).values({
    conversationId: convId,
    role: 'USER',
    content: query,
    citations: [],
    metadata: {},
  });

  // ── 7. Retrieve + build context ───────────────────
  const trace = startTrace({
    name: 'chat',
    userId,
    sessionId: convId,
    input: query,
    metadata: { route: 'ragChat' },
  });
  const retrieveSpan = trace.span({ name: 'retrieve', input: queryForRetrieval });

  let context;
  try {
    context = await buildChatContext({ query: queryForRetrieval, userId, workspaceId });
  } catch (err) {
    retrieveSpan.update({ metadata: { error: String(err) } });
    retrieveSpan.end();
    await trace.end();
    throw err;
  }
  retrieveSpan.update({
    output: { chunks: context.chunks.length, retrievalMs: context.retrievalMs },
    metadata: {
      topK: context.chunks.length,
      filenames: context.chunks.map((c) => c.filename),
    },
  });
  retrieveSpan.end();

  // ── 8. Stream qua router (cost guardrail + circuit breaker tự động) ─
  // Router check guardrail trước, throw CostGuardrailError nếu deny.
  // KHÔNG await để giữ stream flow — router init nhanh nếu pass guard.
  let routed;
  try {
    routed = await routedStreamText({
      useCase: 'ragChat',
      userId,
      plan,
      system: context.systemPrompt,
      messages: messages.slice(-10).map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      // Estimate input từ system prompt + 10 message gần
      estimatedInputTokens: Math.ceil(
        (context.systemPrompt.length + messages.slice(-10).reduce((s, m) => s + (typeof m.content === 'string' ? m.content.length : 100), 0)) / 3,
      ),
      maxOutputTokens: 2000,
      feature: 'chat',
    });
  } catch (err) {
    await trace.end();
    if (err instanceof CostGuardrailError) {
      logger.warn('chat.cost_blocked', { user_id: userId, reason: err.reason });
      return new Response(err.message, {
        status: 429,
        headers: { 'X-Cost-Reason': err.reason },
      });
    }
    if (err instanceof AllProvidersFailedError) {
      logger.error('chat.all_providers_failed', {
        user_id: userId,
        last_error: err.lastError?.message,
      });
      return new Response('AI không khả dụng — vui lòng thử lại sau ít phút.', { status: 503 });
    }
    throw err;
  }

  // ── 9. Stream response với dataStream (citations + meta) ──────────
  return createDataStreamResponse({
    execute: (dataStream) => {
      // Gửi citations + conversationId NGAY ĐẦU stream để client có thể
      // render UI khung citations và navigate URL trước khi LLM trả full text.
      dataStream.writeMessageAnnotation({
        type: 'citations',
        citations: context.chunks.map((c, i) => ({
          n: i + 1,
          chunkId: c.id,
          documentId: c.documentId,
          filename: c.filename,
          page: c.page,
          score: c.score,
          snippet: c.content.slice(0, 240),
        })),
      });
      dataStream.writeData({ type: 'meta', conversationId: convId });

      // Tag generation trong Langfuse — router tự lo cost, chỉ trace cho dashboard
      const generation = trace.generation({
        name: 'chat-generation',
        model: routed.modelUsed,
        input: { systemPrompt: context.systemPrompt, messages: messages.length },
      });

      // Wire onFinish qua router.finishPromise — tracking + DB save
      routed.finishPromise
        .then(async ({ text, promptTokens, completionTokens, modelId, providerId, costUsd, cacheHit, cacheReadTokens }) => {
          generation.update({
            output: text,
            usage: { input: promptTokens, output: completionTokens },
          });
          generation.end();
          await trace.update({
            output: text,
            metadata: {
              promptTokens,
              completionTokens,
              retrievalMs: context.retrievalMs,
              providerId,
              modelId,
              costUsd,
            },
          });
          await trace.end();

          await db.insert(messageTable).values({
            conversationId: convId!,
            role: 'ASSISTANT',
            content: text,
            citations: context.chunks.map((c) => ({
              chunkId: c.id,
              score: c.score,
              snippet: c.content.slice(0, 240),
            })),
            metadata: {
              model: modelId,
              provider: providerId,
              promptTokens,
              completionTokens,
              costUsd,
              retrievalStrategy: 'vector-top5',
              chunkCount: context.chunks.length,
              cacheHit,
            },
          });

          void trackEvent('chat_message_completed', userId, {
            conversationId: convId,
            model: modelId,
            provider: providerId,
            promptTokens,
            completionTokens,
            costUsd,
            chunksRetrieved: context.chunks.length,
            cacheHit,
            cacheReadTokens,
          });
        })
        .catch(async (err) => {
          logger.error('chat.finish_promise_error', {
            user_id: userId,
            conversation_id: convId,
            error: err instanceof Error ? err.message : String(err),
          });
          await trace.end();
        });

      // Merge stream từ router vào dataStream (vẫn dùng raw streamText result)
      routed.result.mergeIntoDataStream(dataStream);
    },
    onError: (err) => {
      console.error('[api/chat] stream error:', err);
      return err instanceof Error ? err.message : 'Internal error';
    },
  });
}

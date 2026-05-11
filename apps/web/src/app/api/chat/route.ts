/**
 * POST /api/chat — endpoint streaming chat MVP cho Cogniva.
 *
 * Luồng:
 *   1. Auth check qua Better Auth session
 *   2. Parse body { messages, conversationId? } theo format Vercel AI SDK
 *   3. Lấy query = nội dung message cuối cùng của user
 *   4. buildChatContext(query) → embed + retrieve top-5 + build system prompt
 *   5. Tạo / load conversation, lưu user message
 *   6. streamText với system prompt + messages, onFinish lưu assistant msg
 *      kèm citations vào DB
 *   7. Trả về data stream — UI render token-by-token + nhận citations qua
 *      message annotation
 *
 * Tracing: bao toàn bộ flow trong 1 Langfuse trace (no-op nếu chưa cấu hình).
 *
 * Phase 3 sẽ thay buildChatContext bằng Mastra workflow có branching.
 */
import { headers } from 'next/headers';
import { and, asc, eq } from 'drizzle-orm';
import { type Message, createDataStreamResponse, streamText } from 'ai';

import { conversation, db, message as messageTable } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { getChatModel, getChatModelId } from '@/lib/ai/models';
import { buildChatContext } from '@/lib/chat/pipeline';
import { startTrace } from '@/lib/observability/langfuse';
import { calcCostUsd } from '@/lib/observability/cost';
import { trackEvent } from '@/lib/observability/posthog';
import { checkLimit } from '@/lib/rate-limit';

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

  // ── 1b. Rate limit (30 req/phút/user cho chat) ────
  const rl = checkLimit(`chat:${userId}`, 'chat');
  if (!rl.allowed) {
    return new Response('Too many requests', {
      status: 429,
      headers: { 'Retry-After': String(rl.retryAfter ?? 60) },
    });
  }

  // ── 2. Parse body ─────────────────────────────────
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

  // ── 3. Lấy query ──────────────────────────────────
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

  // ── 4. Tạo / load conversation ────────────────────
  let convId = rawConvId ?? undefined;
  if (!convId) {
    const [created] = await db
      .insert(conversation)
      .values({
        userId,
        workspaceId: workspaceId ?? null,
        // Title tạm = 60 ký tự đầu của query; sẽ tinh chỉnh qua LLM ở Phase 7
        title: query.slice(0, 60),
      })
      .returning();
    if (!created) return new Response('Failed to create conversation', { status: 500 });
    convId = created.id;
  } else {
    // Verify conversation thuộc về user (chống IDOR)
    const owned = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(and(eq(conversation.id, convId), eq(conversation.userId, userId)))
      .limit(1);
    if (owned.length === 0) {
      return new Response('Conversation not found', { status: 404 });
    }
  }

  // ── 5. Lưu user message vào DB ────────────────────
  await db.insert(messageTable).values({
    conversationId: convId,
    role: 'USER',
    content: query,
    citations: [],
    metadata: {},
  });

  // ── 6. Retrieve + build context ───────────────────
  const trace = startTrace({
    name: 'chat',
    userId,
    sessionId: convId,
    input: query,
    metadata: { provider: getChatModelId() },
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

  // ── 7. Stream response ────────────────────────────
  return createDataStreamResponse({
    execute: (dataStream) => {
      // Gửi citations + conversationId NGAY ĐẦU stream để client có thể
      // render UI khung citations và navigate URL trước khi LLM trả full text.
      dataStream.writeMessageAnnotation({
        type: 'citations',
        citations: context.chunks.map((c, i) => ({
          n: i + 1, // 1-indexed để khớp [1] [2] trong response
          chunkId: c.id,
          documentId: c.documentId,
          filename: c.filename,
          page: c.page,
          score: c.score,
          snippet: c.content.slice(0, 240),
        })),
      });
      dataStream.writeData({ type: 'meta', conversationId: convId });

      const generation = trace.generation({
        name: 'chat-generation',
        model: getChatModelId(),
        input: { systemPrompt: context.systemPrompt, messages: messages.length },
      });

      const result = streamText({
        model: getChatModel(),
        system: context.systemPrompt,
        // Giới hạn 10 message gần nhất để tránh context bloat — sẽ thay
        // bằng smart memory window ở Phase 4 (Personal AI Memory).
        messages: messages.slice(-10),
        onFinish: async ({ text, usage }) => {
          generation.update({
            output: text,
            usage: { input: usage.promptTokens, output: usage.completionTokens },
          });
          generation.end();
          await trace.update({
            output: text,
            metadata: {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              retrievalMs: context.retrievalMs,
            },
          });
          await trace.end();

          // Lưu assistant message + citations vào DB + tính cost
          const modelId = getChatModelId();
          const costUsd = calcCostUsd(
            modelId,
            usage.promptTokens,
            usage.completionTokens,
          );
          await db.insert(messageTable).values({
            conversationId: convId!,
            role: 'ASSISTANT',
            content: text,
            citations: context.chunks.map((c, i) => ({
              chunkId: c.id,
              score: c.score,
              snippet: c.content.slice(0, 240),
            })),
            metadata: {
              model: modelId,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              costUsd,
              retrievalStrategy: 'vector-top5',
            },
          });

          // Track event PostHog (no-op nếu thiếu key)
          void trackEvent('chat_message_completed', userId, {
            conversationId: convId,
            model: modelId,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            costUsd,
            chunksRetrieved: context.chunks.length,
          });
        },
        onError: ({ error }) => {
          console.error('[api/chat] streamText error:', error);
        },
      });

      result.mergeIntoDataStream(dataStream);
    },
    onError: (err) => {
      console.error('[api/chat] stream error:', err);
      return err instanceof Error ? err.message : 'Internal error';
    },
  });
}

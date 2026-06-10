/**
 * AI Tutor reply trong group channel — V2 integration.
 *
 * Flow khi user gửi message có `@AI ...`:
 *   1. messages POST detect mention type='user' với id='system-ai-tutor'
 *      (parser trong mention-notify.ts đã extract @[AI](system-ai-tutor)
 *      nếu user dùng slash menu, hoặc tìm pattern `@AI` text).
 *   2. fireAiReply() — fire-and-forget background.
 *   3. Load 10 message gần nhất của channel làm context (skip system AI msg
 *      cũ để tránh self-feedback loop).
 *   4. AI SDK streamText với system prompt + context → full text.
 *   5. INSERT message mới với author_id='system-ai-tutor', reply_to_id=original.
 *   6. Broadcast realtime event như message thường.
 *
 * V3 sẽ chuyển sang BullMQ job với retry/idempotency.
 */
import { and, eq, desc, ne } from 'drizzle-orm';
import { streamText } from 'ai';

import {
  db,
  studyGroupChannel,
  studyGroupMessage,
  user as userTable,
} from '@cogniva/db';

import { getChatModel } from '@/lib/ai/models';
import { logger } from '@/lib/observability/logger';
import { triggerEvent } from '@/lib/realtime-server';

const AI_TUTOR_ID = 'system-ai-tutor';
const MAX_CONTEXT_MSGS = 10;
/** Bỏ AI reply nếu prompt quá ngắn (vd `@AI` 1 mình) — tránh AI trả vô nghĩa. */
const MIN_PROMPT_LENGTH = 4;

/** Có phải mention `@AI` không? Pattern: `@AI` standalone hoặc `@[AI](system-ai-tutor)`. */
export function hasAiMention(content: string, mentions: Array<{ type: string; id: string }>): boolean {
  if (mentions.some((m) => m.type === 'user' && m.id === AI_TUTOR_ID)) return true;
  return /(^|\s)@AI(\s|$|[?!.,])/i.test(content);
}

/** Strip "@AI" hoặc "@[AI](id)" khỏi prompt trước khi gửi AI để LLM không phân tâm. */
function extractPrompt(content: string): string {
  return content
    .replace(/@\[AI\]\(system-ai-tutor\)/gi, '')
    .replace(/(^|\s)@AI(\s|$|[?!.,])/gi, '$1$2')
    .trim();
}

export async function fireAiReply(opts: {
  channelId: string;
  authorId: string;
  authorName: string;
  originalMessageId: string;
  content: string;
}): Promise<void> {
  const prompt = extractPrompt(opts.content);
  if (prompt.length < MIN_PROMPT_LENGTH) {
    logger.info('ai-reply.skipped-short', { channelId: opts.channelId });
    return;
  }

  // Load context — 10 message gần nhất CỦA CHANNEL NÀY, bỏ tin AI (chống loop)
  const recent = await db
    .select({
      authorId: studyGroupMessage.authorId,
      authorName: userTable.name,
      content: studyGroupMessage.content,
      createdAt: studyGroupMessage.createdAt,
    })
    .from(studyGroupMessage)
    .innerJoin(userTable, eq(userTable.id, studyGroupMessage.authorId))
    .where(
      and(
        eq(studyGroupMessage.channelId, opts.channelId),
        ne(studyGroupMessage.authorId, AI_TUTOR_ID),
      ),
    )
    .orderBy(desc(studyGroupMessage.createdAt))
    .limit(MAX_CONTEXT_MSGS);

  try {

    // Đảo ngược → cũ → mới
    const context = recent
      .reverse()
      .map((m) => `${m.authorName ?? 'User'}: ${m.content}`)
      .join('\n');

    // Default model per provider (Anthropic Sonnet 4.6 / Groq Llama / Google Gemini / OpenRouter)
    const model = getChatModel();
    const systemPrompt = `Bạn là AI Tutor của Cogniva — trợ giảng học tập.
Trả lời ngắn gọn (< 200 chữ), thân thiện, tiếng Việt. Tránh dài dòng.
Nếu câu hỏi không liên quan học tập, vẫn trả lời lịch sự nhưng nhắc nhẹ rằng bạn chuyên hỗ trợ học tập.
Context — vài tin nhắn gần đây trong nhóm chat:
${context || '(chưa có)'}`;

    logger.info('ai-reply.starting', { channelId: opts.channelId, promptLen: prompt.length });

    const result = streamText({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: `${opts.authorName} hỏi: ${prompt}` }],
      maxRetries: 1,
      onError: ({ error }) => {
        logger.error('ai-reply.streamText-error', {
          error: error instanceof Error ? error.message : String(error),
          channelId: opts.channelId,
        });
      },
    });

    // Collect full text
    let fullText = '';
    for await (const chunk of result.textStream) {
      fullText += chunk;
    }
    fullText = fullText.trim();
    logger.info('ai-reply.completed', {
      channelId: opts.channelId,
      replyLen: fullText.length,
    });
    if (!fullText) {
      logger.warn('ai-reply.empty-reply', { channelId: opts.channelId });
      return;
    }

    // Insert AI reply
    const [created] = await db
      .insert(studyGroupMessage)
      .values({
        channelId: opts.channelId,
        authorId: AI_TUTOR_ID,
        content: fullText,
        replyToId: opts.originalMessageId,
      })
      .returning();
    if (!created) return;

    // Load channel groupId để broadcast presence-group event (update unread badge)
    const [ch] = await db
      .select({ groupId: studyGroupChannel.groupId })
      .from(studyGroupChannel)
      .where(eq(studyGroupChannel.id, opts.channelId))
      .limit(1);

    const payload = {
      id: created.id,
      channelId: created.channelId,
      authorId: AI_TUTOR_ID,
      authorName: 'AI Tutor',
      authorImage: null,
      content: created.content,
      contentType: 'markdown',
      replyToId: created.replyToId,
      attachments: null,
      reactions: null,
      mentions: null,
      pinned: false,
      editedAt: null,
      deletedAt: null,
      createdAt: created.createdAt,
    };
    void triggerEvent(`private-channel-${opts.channelId}`, 'message:new', payload);
    if (ch) {
      void triggerEvent(`presence-group-${ch.groupId}`, 'message:new-in-channel', {
        channelId: opts.channelId,
        authorId: AI_TUTOR_ID,
        messageId: created.id,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('ai-reply.fail', { error: msg, channelId: opts.channelId });
    // Log stack đầy đủ ra console để debug terminal
    console.error('[ai-reply] FAIL', err);
    // Rethrow để endpoint /ai-reply trả 500 + error chi tiết về client
    throw err;
  }
}

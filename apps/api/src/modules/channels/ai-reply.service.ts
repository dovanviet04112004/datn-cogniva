import { HttpException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { logger } from '@cogniva/server-core';
import { triggerEvent } from '@cogniva/server-core/realtime-emitter';

import { PrismaService } from '../../infra/database/prisma.service';
import { LlmService } from '../../infra/ai/llm.service';
import { aiReplySchema } from './dto/channels.dto';

const AI_TUTOR_ID = 'system-ai-tutor';
const MAX_CONTEXT_MSGS = 10;
const MIN_PROMPT_LENGTH = 4;

@Injectable()
export class AiReplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async handleAiReply(user: { id: string; name: string | null }, channelId: string, raw: unknown) {
    const ch = await this.prisma.study_group_channel.findUnique({
      where: { id: channelId },
      select: { group_id: true, type: true },
    });
    if (!ch) throw new HttpException({ error: 'Channel không tồn tại' }, 404);

    const member = await this.prisma.study_group_member.findUnique({
      where: { group_id_user_id: { group_id: ch.group_id, user_id: user.id } },
      select: { id: true },
    });
    if (!member) throw new HttpException({ error: 'Forbidden' }, 403);

    const parsed = aiReplySchema.safeParse(raw);
    if (!parsed.success) throw new HttpException({ error: parsed.error.flatten() }, 400);
    if (!hasAiMention(parsed.data.prompt, [])) {
      throw new HttpException({ error: 'Không có mention @AI' }, 400);
    }

    try {
      await this.fireAiReply({
        channelId,
        authorId: user.id,
        authorName: user.name ?? 'Người dùng',
        originalMessageId: parsed.data.originalMessageId,
        content: parsed.data.prompt,
      });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new HttpException({ error: 'AI reply thất bại: ' + msg }, 500);
    }
  }

  async fireAiReply(opts: {
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

    const recent = await this.prisma.study_group_message.findMany({
      where: { channel_id: opts.channelId, author_id: { not: AI_TUTOR_ID } },
      orderBy: { created_at: 'desc' },
      take: MAX_CONTEXT_MSGS,
      select: { content: true, user: { select: { name: true } } },
    });

    try {
      const context = recent
        .reverse()
        .map((m) => `${m.user.name ?? 'User'}: ${m.content}`)
        .join('\n');

      const systemPrompt = `Bạn là AI Tutor của Cogniva — trợ giảng học tập.
Trả lời ngắn gọn (< 200 chữ), thân thiện, tiếng Việt. Tránh dài dòng.
Nếu câu hỏi không liên quan học tập, vẫn trả lời lịch sự nhưng nhắc nhẹ rằng bạn chuyên hỗ trợ học tập.
Context — vài tin nhắn gần đây trong nhóm chat:
${context || '(chưa có)'}`;

      logger.info('ai-reply.starting', { channelId: opts.channelId, promptLen: prompt.length });

      const fullText = (
        await this.llm.complete(`${opts.authorName} hỏi: ${prompt}`, { system: systemPrompt })
      ).trim();

      logger.info('ai-reply.completed', {
        channelId: opts.channelId,
        replyLen: fullText.length,
      });
      if (!fullText) {
        logger.warn('ai-reply.empty-reply', { channelId: opts.channelId });
        return;
      }

      const created = await this.prisma.study_group_message.create({
        data: {
          id: randomUUID(),
          channel_id: opts.channelId,
          author_id: AI_TUTOR_ID,
          content: fullText,
          reply_to_id: opts.originalMessageId,
        },
      });

      const ch = await this.prisma.study_group_channel.findUnique({
        where: { id: opts.channelId },
        select: { group_id: true },
      });

      const payload = {
        id: created.id,
        channelId: created.channel_id,
        authorId: AI_TUTOR_ID,
        authorName: 'AI Tutor',
        authorImage: null,
        content: created.content,
        contentType: 'markdown',
        replyToId: created.reply_to_id,
        attachments: null,
        reactions: null,
        mentions: null,
        pinned: false,
        editedAt: null,
        deletedAt: null,
        createdAt: created.created_at,
      };
      void triggerEvent(`private-channel-${opts.channelId}`, 'message:new', payload);
      if (ch) {
        void triggerEvent(`presence-group-${ch.group_id}`, 'message:new-in-channel', {
          channelId: opts.channelId,
          authorId: AI_TUTOR_ID,
          messageId: created.id,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('ai-reply.fail', { error: msg, channelId: opts.channelId });
      console.error('[ai-reply] FAIL', err);
      throw err;
    }
  }
}

export function hasAiMention(
  content: string,
  mentions: Array<{ type: string; id: string }>,
): boolean {
  if (mentions.some((m) => m.type === 'user' && m.id === AI_TUTOR_ID)) return true;
  return /(^|\s)@AI(\s|$|[?!.,])/i.test(content);
}

function extractPrompt(content: string): string {
  return content
    .replace(/@\[AI\]\(system-ai-tutor\)/gi, '')
    .replace(/(^|\s)@AI(\s|$|[?!.,])/gi, '$1$2')
    .trim();
}

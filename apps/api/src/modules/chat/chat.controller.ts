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

type ChatRequestBody = {
  messages?: Array<{ role?: string; content?: unknown }>;
  conversationId?: string | null;
  workspaceId?: string;
  documentIds?: string[];
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

    const rl = await checkLimit(`chat:${userId}`, 'chat');
    if (!rl.allowed) {
      res
        .status(429)
        .set('Retry-After', String(rl.retryAfter ?? 60))
        .send('Too many requests');
      return;
    }

    const { messages, conversationId: rawConvId, workspaceId, documentIds, atomIds } = body;
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

    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser?.content) {
      res.status(400).send('No user message found');
      return;
    }
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
    const queryForRetrieval = query.trim() || '[image-only message]';

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

    await this.chat.insertUserMessage(convId, query);

    const context = await this.retrieval.buildChatContext({
      query: queryForRetrieval,
      userId,
      plan,
      workspaceId,
      documentIds: safeDocIds,
    });

    const atomSystemAddition = safeAtomIds?.length
      ? await this.chat.buildAtomContext(userId, safeAtomIds)
      : '';

    const finalSystemPrompt = context.systemPrompt + atomSystemAddition;

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

    const chunks = context.chunks;
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    pipeDataStreamToResponse(res, {
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
      execute: (dataStream) => {
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

        routed.finishPromise
          .then(
            async ({
              text,
              promptTokens,
              completionTokens,
              modelId,
              providerId,
              costUsd,
              cacheHit,
            }) => {
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
            },
          )
          .catch((err: unknown) => {
            logger.error('chat.finish_promise_error', {
              user_id: userId,
              conversation_id: convId,
              error: err instanceof Error ? err.message : String(err),
            });
          });

        routed.result.mergeIntoDataStream(dataStream);
      },
      onError: (err) => {
        console.error('[api/chat] stream error:', err);
        return err instanceof Error ? err.message : 'Internal error';
      },
    });
  }
}

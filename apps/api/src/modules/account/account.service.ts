import { randomUUID } from 'node:crypto';
import { BadRequestException, HttpException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';

import { CostGuardrailService, type Plan } from '../../infra/ai/cost-guardrail.service';
import { PrismaService } from '../../infra/database/prisma.service';
import {
  deleteAccountSchema,
  type DeletePushTokenInput,
  type RegisterPushTokenInput,
} from './dto/account.dto';

const GRACE_DAYS = 30;

export type RequestContext = {
  ipAddress: string | null;
  userAgent: string | null;
  traceId: string | null;
};

type AuditEvent = {
  action: string;
  result: 'success' | 'denied' | 'error';
  actorId?: string | null;
  actorType?: 'user' | 'admin' | 'system' | 'webhook';
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
} & Partial<RequestContext>;

function camelizeRow(
  row: Record<string, unknown>,
  overrides: Record<string, string> = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    out[overrides[k] ?? k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out;
}

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly costGuardrail: CostGuardrailService,
  ) {}

  private async writeAudit(e: AuditEvent): Promise<void> {
    try {
      await this.prisma.audit_log.create({
        data: {
          id: randomUUID(),
          actor_id: e.actorId ?? null,
          actor_type: e.actorType ?? 'user',
          action: e.action,
          result: e.result,
          resource_type: e.resourceType ?? null,
          resource_id: e.resourceId ?? null,
          ip_address: e.ipAddress ?? null,
          user_agent: e.userAgent ? e.userAgent.slice(0, 500) : null,
          trace_id: e.traceId ?? null,
          metadata: (e.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        },
      });
    } catch (err) {
      logger.warn('audit.write_failed', {
        action: e.action,
        result: e.result,
        actor_id: e.actorId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async requestDelete(userId: string, raw: unknown, ctx: RequestContext) {
    const parsed = deleteAccountSchema.safeParse(raw);
    if (!parsed.success) {
      await this.writeAudit({
        action: 'gdpr.delete.requested',
        result: 'denied',
        actorId: userId,
        metadata: { error: parsed.error.flatten() },
        ...ctx,
      });
      throw new BadRequestException({ error: parsed.error.flatten() });
    }

    const existing = await this.prisma.deletion_request.findFirst({
      where: { user_id: userId, status: 'PENDING' },
    });
    if (existing) {
      throw new HttpException(
        {
          error: 'Đã có request xoá account pending',
          scheduledFor: existing.scheduled_for,
          requestId: existing.id,
        },
        409,
      );
    }

    const scheduledFor = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
    const created = await this.prisma.deletion_request.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        reason: parsed.data.reason ?? null,
        status: 'PENDING',
        scheduled_for: scheduledFor,
      },
    });

    await this.writeAudit({
      action: 'gdpr.delete.requested',
      result: 'success',
      actorId: userId,
      resourceType: 'user',
      resourceId: userId,
      metadata: {
        reason: parsed.data.reason,
        scheduledFor: scheduledFor.toISOString(),
        requestId: created.id,
      },
      ...ctx,
    });

    logger.warn('gdpr.delete.scheduled', {
      user_id: userId,
      scheduled_for: scheduledFor.toISOString(),
      request_id: created.id,
    });

    return {
      ok: true,
      requestId: created.id,
      scheduledFor: scheduledFor.toISOString(),
      graceDays: GRACE_DAYS,
      cancelUrl: '/api/account/delete',
    };
  }

  async cancelDelete(userId: string, ctx: RequestContext) {
    const existing = await this.prisma.deletion_request.findFirst({
      where: { user_id: userId, status: 'PENDING' },
    });
    if (!existing) {
      throw new HttpException({ error: 'Không có deletion request pending' }, 404);
    }

    await this.prisma.deletion_request.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED' },
    });

    await this.writeAudit({
      action: 'gdpr.delete.cancelled',
      result: 'success',
      actorId: userId,
      resourceType: 'deletion_request',
      resourceId: existing.id,
      ...ctx,
    });

    return { ok: true, cancelledAt: new Date().toISOString() };
  }

  async deletionStatus(userId: string) {
    const pending = await this.prisma.deletion_request.findFirst({
      where: { user_id: userId, status: 'PENDING' },
    });
    if (!pending) return { pending: false };

    const daysRemaining = Math.max(
      0,
      Math.ceil((pending.scheduled_for.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
    );

    return {
      pending: true,
      requestId: pending.id,
      scheduledFor: pending.scheduled_for.toISOString(),
      daysRemaining,
      canCancel: daysRemaining > 0,
    };
  }

  async export(userId: string, ctx: RequestContext) {
    await this.writeAudit({
      action: 'gdpr.export.requested',
      result: 'success',
      actorId: userId,
      resourceType: 'user',
      resourceId: userId,
      ...ctx,
    });

    const [
      userRow,
      workspaces,
      documents,
      conversations,
      messages,
      flashcards,
      reviews,
      masteries,
      studySessions,
      rooms,
      roomMembers,
      roomMessages,
      recordings,
    ] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.workspace.findMany({ where: { user_id: userId } }),
      this.prisma.document.findMany({ where: { user_id: userId } }),
      this.prisma.conversation.findMany({ where: { user_id: userId } }),
      this.prisma.message.findMany({ where: { conversation: { user_id: userId } } }),
      this.prisma.flashcard.findMany({ where: { user_id: userId } }),
      this.prisma.review.findMany({ where: { flashcard: { user_id: userId } } }),
      this.prisma.mastery.findMany({ where: { user_id: userId } }),
      this.prisma.study_session.findMany({ where: { user_id: userId } }),
      this.prisma.room.findMany({ where: { owner_id: userId } }),
      this.prisma.room_member.findMany({ where: { user_id: userId } }),
      this.prisma.room_message.findMany({ where: { user_id: userId } }),
      this.prisma.recording.findMany({ where: { room: { is: { owner_id: userId } } } }),
    ]);

    const userPublic = userRow
      ? {
          id: userRow.id,
          email: userRow.email,
          name: userRow.name,
          image: userRow.image,
          plan: userRow.plan,
          createdAt: userRow.created_at,
        }
      : null;

    const payload = {
      exportedAt: new Date().toISOString(),
      schemaVersion: '1.0',
      user: userPublic,
      workspaces: workspaces.map((r) => camelizeRow(r)),
      documents: documents.map((r) => camelizeRow(r)),
      conversations: conversations.map((r) => camelizeRow(r)),
      messages: messages.map((r) => camelizeRow(r)),
      flashcards: flashcards.map((r) => camelizeRow(r)),
      reviews: reviews.map((r) => camelizeRow(r)),
      mastery: masteries.map((r) => camelizeRow(r)),
      studySessions: studySessions.map((r) => camelizeRow(r)),
      rooms: rooms.map((r) => camelizeRow(r)),
      roomMembers: roomMembers.map((r) => camelizeRow(r)),
      roomMessages: roomMessages.map((r) => camelizeRow(r)),
      recordings: recordings.map((r) =>
        camelizeRow(r, { duration_seconds: 'duration', file_size_bytes: 'fileSize' }),
      ),
      note: 'File media (PDF documents, recording MP4) KHÔNG bao gồm trong JSON này. Liên hệ support@cogniva.app để nhận signed R2 URL (TTL 7 ngày).',
    };

    await this.writeAudit({
      action: 'gdpr.export.completed',
      result: 'success',
      actorId: userId,
      resourceType: 'user',
      resourceId: userId,
      metadata: {
        documents_count: documents.length,
        flashcards_count: flashcards.length,
        conversations_count: conversations.length,
        payload_bytes: JSON.stringify(payload).length,
      },
      ...ctx,
    });

    return payload;
  }

  async auditExportDenied(userId: string, retryAfter: number | undefined, ctx: RequestContext) {
    await this.writeAudit({
      action: 'gdpr.export.requested',
      result: 'denied',
      actorId: userId,
      metadata: { reason: 'rate_limit', retryAfter },
      ...ctx,
    });
  }

  async usage(userId: string, planRaw: string | null | undefined) {
    const plan = (planRaw ?? 'FREE') as Plan;
    const usage = await this.costGuardrail.getUserDailyUsage(userId, plan);

    return {
      plan,
      spentUsd: usage.spentUsd,
      quotaUsd: usage.quotaUsd,
      remainingUsd: usage.remainingUsd,
      resetAt: usage.resetAt,
      spentPct: Math.round((usage.spentUsd / usage.quotaUsd) * 100),
    };
  }

  async registerPushToken(userId: string, input: RegisterPushTokenInput, ctx: RequestContext) {
    const { token, platform, deviceId } = input;

    const existing = await this.prisma.push_token.findUnique({
      where: { token },
      select: { id: true, user_id: true },
    });

    let action: 'created' | 'updated' | 'transferred' = 'created';

    if (existing) {
      action = existing.user_id !== userId ? 'transferred' : 'updated';
      await this.prisma.push_token.update({
        where: { id: existing.id },
        data: {
          user_id: userId,
          platform,
          device_id: deviceId ?? null,
          enabled: true,
          last_seen_at: new Date(),
        },
      });
    } else {
      await this.prisma.push_token.create({
        data: {
          id: randomUUID(),
          user_id: userId,
          token,
          platform,
          device_id: deviceId ?? null,
          enabled: true,
        },
      });
    }

    await this.writeAudit({
      action: `push.token.${action}`,
      result: 'success',
      actorId: userId,
      resourceType: 'push_token',
      metadata: { platform, deviceId: deviceId ?? null },
      ...ctx,
    });

    return { ok: true, action };
  }

  async unregisterPushToken(userId: string, input: DeletePushTokenInput, ctx: RequestContext) {
    const result = await this.prisma.push_token.deleteMany({
      where: { token: input.token, user_id: userId },
    });

    await this.writeAudit({
      action: 'push.token.deleted',
      result: result.count > 0 ? 'success' : 'denied',
      actorId: userId,
      resourceType: 'push_token',
      metadata: { removed: result.count },
      ...ctx,
    });

    return { ok: true, removed: result.count };
  }
}

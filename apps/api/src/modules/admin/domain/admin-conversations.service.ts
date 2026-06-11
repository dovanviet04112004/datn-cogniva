import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { onRoomRecordingsChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../../infra/database/prisma.service';
import { AdminAuditService } from '../../../common/admin/admin-audit.service';
import type { AdminContext } from '../../../common/admin/admin.guard';
import { clampLimit, parseCursor } from './dto/admin-domain.dto';

@Injectable()
export class AdminConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(params: { q?: string; userEmail?: string; cursor?: string; limit?: string }) {
    const q = params.q?.trim() ?? '';
    const userEmail = params.userEmail?.trim() ?? '';
    const limit = clampLimit(params.limit, 50, 100);

    const where: Prisma.conversationWhereInput = {};
    let conditions = 0;
    if (q) {
      where.title = { contains: q, mode: 'insensitive' };
      conditions++;
    }
    if (userEmail) {
      where.user = { email: { contains: userEmail, mode: 'insensitive' } };
      conditions++;
    }
    const cursorDate = parseCursor(params.cursor);
    if (cursorDate) {
      where.created_at = { lt: cursorDate };
      conditions++;
    }

    const rows = await this.prisma.conversation.findMany({
      where,
      select: {
        id: true,
        title: true,
        created_at: true,
        user_id: true,
        workspace_id: true,
        user: { select: { name: true, email: true } },
        workspace: { select: { name: true } },
        _count: { select: { message: true } },
      },
      orderBy: { created_at: 'desc' },
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && trimmed.length > 0 ? trimmed[trimmed.length - 1]!.created_at.toISOString() : null;

    const lastByConv = new Map<string, Date>();
    if (trimmed.length > 0) {
      const grouped = await this.prisma.message.groupBy({
        by: ['conversation_id'],
        where: { conversation_id: { in: trimmed.map((c) => c.id) } },
        _max: { created_at: true },
      });
      for (const g of grouped) {
        if (g._max.created_at) lastByConv.set(g.conversation_id, g._max.created_at);
      }
    }

    let total: number | null = null;
    if (conditions === 0) {
      total = await this.prisma.conversation.count();
    }

    return {
      conversations: trimmed.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.created_at.toISOString(),
        userId: c.user_id,
        userName: c.user.name,
        userEmail: c.user.email,
        workspaceId: c.workspace_id,
        workspaceName: c.workspace?.name ?? null,
        messageCount: c._count.message,
        lastMessageAt: lastByConv.get(c.id)?.toISOString() ?? null,
      })),
      nextCursor,
      total,
    };
  }

  async getDetail(id: string) {
    const row = await this.prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        created_at: true,
        user_id: true,
        workspace_id: true,
        user: { select: { name: true, email: true } },
        workspace: { select: { name: true } },
      },
    });
    if (!row) throw new NotFoundException({ error: 'Conversation not found' });

    const messages = await this.prisma.message.findMany({
      where: { conversation_id: id },
      select: {
        id: true,
        role: true,
        content: true,
        citations: true,
        metadata: true,
        created_at: true,
      },
      orderBy: { created_at: 'asc' },
    });

    return {
      conversation: {
        id: row.id,
        title: row.title,
        createdAt: row.created_at.toISOString(),
        userId: row.user_id,
        userName: row.user.name,
        userEmail: row.user.email,
        workspaceId: row.workspace_id,
        workspaceName: row.workspace?.name ?? null,
      },
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citations: m.citations,
        metadata: m.metadata,
        createdAt: m.created_at.toISOString(),
      })),
    };
  }

  async deleteConversation(ctx: AdminContext, id: string, reason: string) {
    return this.audit.withAudit(
      ctx,
      'conversation.delete',
      { type: 'conversation', id },
      async () => {
        const before = await this.prisma.conversation.findUnique({
          where: { id },
          select: { id: true, title: true, user_id: true },
        });
        if (!before) throw new Error('Conversation not found');

        await this.prisma.conversation.delete({ where: { id } });

        return {
          before: { id: before.id, title: before.title, userId: before.user_id },
          after: null,
          reason,
          result: { ok: true },
        };
      },
    );
  }

  async deleteRecording(ctx: AdminContext, id: string, reason: string) {
    return this.audit.withAudit(ctx, 'recording.delete', { type: 'recording', id }, async () => {
      const row = await this.prisma.recording.findUnique({
        where: { id },
        select: {
          id: true,
          storage_key: true,
          room_id: true,
          study_group_channel_id: true,
          duration_seconds: true,
        },
      });
      if (!row) throw new Error('Recording not found');

      await this.prisma.recording.delete({ where: { id } });
      if (row.room_id) await onRoomRecordingsChanged(row.room_id);

      return {
        before: {
          id: row.id,
          storageKey: row.storage_key,
          roomId: row.room_id,
          studyGroupChannelId: row.study_group_channel_id,
          duration: row.duration_seconds,
        },
        after: null,
        reason,
        result: { ok: true },
      };
    });
  }
}

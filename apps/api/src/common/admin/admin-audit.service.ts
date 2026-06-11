/**
 * AdminAuditService — port withAudit từ apps/web/src/lib/admin/audit.ts.
 * Ghi admin_audit_log SAU khi mutation thành công (fn throw → không ghi);
 * payload jsonb {before, after, reason, metadata} giữ shape cũ.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';
import type { AdminContext } from './admin.guard';

export type AuditOutcome<T> = {
  before?: unknown;
  after?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
  result: T;
};

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async withAudit<T>(
    ctx: AdminContext,
    action: string,
    target: { type: string; id: string },
    fn: () => Promise<AuditOutcome<T>>,
  ): Promise<T> {
    const out = await fn();
    await this.prisma.admin_audit_log.create({
      data: {
        id: randomUUID(),
        admin_id: ctx.userId,
        action,
        target_type: target.type,
        target_id: target.id,
        payload: {
          before: out.before ?? null,
          after: out.after ?? null,
          reason: out.reason ?? null,
          metadata: out.metadata ?? null,
        } as Prisma.InputJsonValue,
        ip: ctx.ip,
        user_agent: ctx.userAgent,
      },
    });
    return out.result;
  }
}

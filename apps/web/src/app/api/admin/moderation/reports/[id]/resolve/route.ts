/**
 * POST /api/admin/moderation/reports/[id]/resolve — close 1 report.
 *
 * Body:
 *   resolution: 'dismiss' | 'takedown' | 'warn' | 'ban'
 *   reason: string (10..500)
 *
 * Side-effect theo resolution:
 *   - dismiss   → chỉ set status=RESOLVED, không action target
 *   - takedown  → soft delete target (message/document/conversation) tuỳ type
 *   - warn      → ghi audit log + (Phase 2 follow) email warn user
 *   - ban       → suspend target user/group (set suspendedAt = NOW)
 *
 * Phase 2 V1: takedown chỉ implement cho targetType='document' (cascade delete chunks).
 * targetType='message' / 'user' / 'group' xử lý tương ứng.
 *
 * Auth: SUPER_ADMIN / ADMIN
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  contentReport,
  conversation,
  db,
  document,
  message,
  studyGroup,
  studyGroupMessage,
  user,
} from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';
import { notifyWarnUser } from '@/lib/admin/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

const BODY_SCHEMA = z.object({
  resolution: z.enum(['dismiss', 'takedown', 'warn', 'ban']),
  reason: z.string().trim().min(10).max(500),
});

export async function POST(request: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN', 'ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { resolution, reason } = parsed.data;

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    `report.${resolution}`,
    { type: 'report', id },
    async () => {
      const [report] = await db
        .select()
        .from(contentReport)
        .where(eq(contentReport.id, id))
        .limit(1);
      if (!report) throw new Error('Report not found');
      if (report.status !== 'PENDING') throw new Error('Report đã được xử lý');

      const now = new Date();
      let sideEffect: Record<string, unknown> = {};

      // Side-effects theo resolution
      if (resolution === 'takedown') {
        sideEffect = await takedownTarget(report.targetType, report.targetId);
      } else if (resolution === 'ban') {
        sideEffect = await banTarget(report.targetType, report.targetId, reason);
      } else if (resolution === 'warn') {
        // Warn → resolve userId của target rồi insert notification_log.
        // - targetType='user' → userId = targetId
        // - targetType='message'/'group_message'/'ai_message' → fetch author của message
        // - targetType khác → bỏ qua (sẽ chỉ ghi audit)
        const userId = await resolveWarnUserId(report.targetType, report.targetId);
        if (userId) {
          await notifyWarnUser({
            userId,
            reason,
            context: {
              reportId: report.id,
              targetType: report.targetType,
              targetId: report.targetId,
            },
          });
          sideEffect = { type: 'warn.notification', userId };
        } else {
          sideEffect = {
            skipped: true,
            reason: `Không tìm được userId cho targetType=${report.targetType}`,
          };
        }
      }

      // Mark report resolved
      await db
        .update(contentReport)
        .set({
          status: 'RESOLVED',
          resolvedBy: admin.userId,
          resolvedAt: now,
          resolution,
        })
        .where(eq(contentReport.id, id));

      return {
        before: { status: report.status, resolution: report.resolution },
        after: { status: 'RESOLVED', resolution, sideEffect },
        reason,
        result: { ok: true, resolution, sideEffect },
      };
    },
  );

  return NextResponse.json(result);
}

/**
 * Takedown target — soft delete content.
 * Phase 2 V1 implement: document (delete row + cascade chunks), message
 * (delete 1 row), conversation (delete + cascade messages).
 */
async function takedownTarget(
  targetType: string,
  targetId: string,
): Promise<Record<string, unknown>> {
  switch (targetType) {
    case 'document': {
      await db.delete(document).where(eq(document.id, targetId));
      return { type: 'document', deletedId: targetId };
    }
    case 'message': {
      await db.delete(message).where(eq(message.id, targetId));
      return { type: 'message', deletedId: targetId };
    }
    case 'conversation': {
      await db.delete(conversation).where(eq(conversation.id, targetId));
      return { type: 'conversation', deletedId: targetId };
    }
    default:
      return { skipped: true, reason: `takedown chưa support targetType=${targetType}` };
  }
}

/**
 * Resolve userId của target để warn — phụ thuộc targetType.
 */
async function resolveWarnUserId(
  targetType: string,
  targetId: string,
): Promise<string | null> {
  if (targetType === 'user') return targetId;
  if (targetType === 'message' || targetType === 'group_message') {
    const [m] = await db
      .select({ authorId: studyGroupMessage.authorId })
      .from(studyGroupMessage)
      .where(eq(studyGroupMessage.id, targetId))
      .limit(1);
    return m?.authorId ?? null;
  }
  if (targetType === 'ai_message') {
    // AI conversation message — author là user của conversation (vì user gửi)
    // hoặc skip nếu role='ASSISTANT' (warn AI vô nghĩa).
    const [m] = await db
      .select({ role: message.role, conversationId: message.conversationId })
      .from(message)
      .where(eq(message.id, targetId))
      .limit(1);
    if (!m || m.role === 'ASSISTANT') return null;
    const [c] = await db
      .select({ userId: conversation.userId })
      .from(conversation)
      .where(eq(conversation.id, m.conversationId))
      .limit(1);
    return c?.userId ?? null;
  }
  return null;
}

/**
 * Ban target — suspend user hoặc group.
 */
async function banTarget(
  targetType: string,
  targetId: string,
  reason: string,
): Promise<Record<string, unknown>> {
  const now = new Date();
  switch (targetType) {
    case 'user': {
      await db
        .update(user)
        .set({ suspendedAt: now, suspendReason: reason })
        .where(eq(user.id, targetId));
      return { type: 'user.suspend', userId: targetId };
    }
    case 'group': {
      await db
        .update(studyGroup)
        .set({ suspendedAt: now, suspendReason: reason })
        .where(eq(studyGroup.id, targetId));
      return { type: 'group.suspend', groupId: targetId };
    }
    default:
      return { skipped: true, reason: `ban chưa support targetType=${targetType}` };
  }
}

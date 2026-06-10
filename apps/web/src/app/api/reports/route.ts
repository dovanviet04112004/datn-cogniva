/**
 * POST /api/reports — user submit báo cáo nội dung vi phạm.
 *
 * Body:
 *   targetType: 'group_message' | 'ai_message' | 'user' | 'document' | 'group' | 'conversation'
 *   targetId:   string
 *   reason:     string (10..1000)
 *
 * Logic:
 *   - Auth: bắt buộc đăng nhập
 *   - Dedupe: 1 reporter chỉ report 1 (targetType, targetId) trong 24h
 *     → block spam report. Trả 409 + existing report info.
 *   - Self-target: chặn user report chính mình (targetType='user' & targetId=self).
 *   - Validate target tồn tại (avoid garbage report).
 *
 * Response:
 *   201 { id, status } — đã tạo
 *   409 { error, existingId } — đã report trong 24h
 *   404 { error } — target không tồn tại
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, gt } from 'drizzle-orm';
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

import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const TARGET_TYPES = [
  'group_message',
  'ai_message',
  'user',
  'document',
  'group',
  'conversation',
] as const;

const BODY_SCHEMA = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().min(1).max(200),
  reason: z.string().trim().min(10).max(1000),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const reporterId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { targetType, targetId, reason } = parsed.data;

  // Self-target protection
  if (targetType === 'user' && targetId === reporterId) {
    return NextResponse.json(
      { error: 'Không thể report chính mình' },
      { status: 400 },
    );
  }

  // Validate target tồn tại
  const exists = await targetExists(targetType, targetId);
  if (!exists) {
    return NextResponse.json(
      { error: `Target ${targetType}:${targetId} không tồn tại` },
      { status: 404 },
    );
  }

  // Dedupe 24h
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [duplicate] = await db
    .select({ id: contentReport.id })
    .from(contentReport)
    .where(
      and(
        eq(contentReport.reporterId, reporterId),
        eq(contentReport.targetType, targetType),
        eq(contentReport.targetId, targetId),
        gt(contentReport.createdAt, cutoff),
      ),
    )
    .limit(1);
  if (duplicate) {
    return NextResponse.json(
      {
        error: 'Bạn đã báo cáo nội dung này trong 24h qua',
        existingId: duplicate.id,
      },
      { status: 409 },
    );
  }

  const [created] = await db
    .insert(contentReport)
    .values({
      reporterId,
      targetType,
      targetId,
      reason,
      status: 'PENDING',
    })
    .returning({ id: contentReport.id });

  return NextResponse.json(
    { id: created!.id, status: 'PENDING' },
    { status: 201 },
  );
}

/**
 * Check target tồn tại trong DB tương ứng schema.
 * Trả về false nếu user gửi targetId rác hoặc đã bị xoá.
 */
async function targetExists(type: string, id: string): Promise<boolean> {
  const table = {
    group_message: studyGroupMessage,
    ai_message: message,
    user,
    document,
    group: studyGroup,
    conversation,
  }[type];
  if (!table) return false;
  // Drizzle union type infer thành never khi select column chung — cast tránh phải
  // viết switch verbose 6 branch. Mỗi table đều có .id text PK theo schema.
  const t = table as unknown as { id: typeof user.id };
  const [row] = await db.select({ id: t.id }).from(t as never).where(eq(t.id, id)).limit(1);
  return !!row;
}

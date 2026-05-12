/**
 * POST /api/account/delete   — request xoá account (30-day grace).
 * DELETE /api/account/delete — undo deletion request (within grace window).
 * GET /api/account/delete    — status của deletion request hiện tại.
 *
 * Plan v2 §5.9 + §10.4.3 + §15.1 W9-10 — GDPR Article 17.
 *
 * Flow:
 *   1. POST /account/delete → tạo deletion_request status=PENDING,
 *      scheduledFor = now + 30 days.
 *   2. App show banner "Account sẽ xoá vào {date}. Click here to cancel".
 *   3. DELETE /account/delete → status=CANCELLED, hủy schedule.
 *   4. Inngest cron daily pickup PENDING với scheduled_for <= NOW →
 *      execute hard delete (cascade qua FK + R2 cleanup).
 *
 * Soft delete trong grace:
 *   - Account vẫn login được (user có thể undo)
 *   - KHÔNG đánh dấu inactive (giữ UX bình thường)
 *   - Optional: hide từ public profile / leaderboard
 *
 * Hard delete (sau 30 days):
 *   - Cascade FK xoá: documents, chunks, flashcards, conversations, etc.
 *   - R2 delete với prefix {userId}/
 *   - ClickHouse anonymize (giữ aggregates)
 *   - Audit log KEEP (legal requirement) nhưng redact PII fields
 *
 * Privacy:
 *   - Require password reauth Stage 2 (hiện chỉ session check — acceptable
 *     trade-off cho Stage 1).
 *   - Audit log mọi request + Sentry alert.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, deletionRequest } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { writeAudit, extractRequestContext } from '@/lib/observability/audit';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';

const GRACE_DAYS = 30;

const REQUEST_SCHEMA = z.object({
  reason: z.string().max(500).optional(),
  /** Confirm typed value để chống misclick. Required = "DELETE MY ACCOUNT". */
  confirm: z.string().refine((s) => s === 'DELETE MY ACCOUNT', {
    message: 'Phải gõ chính xác "DELETE MY ACCOUNT" để confirm',
  }),
});

/**
 * POST — Tạo deletion request mới (hoặc trả conflict nếu đã có PENDING).
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const ctx = extractRequestContext(request);

  const body = await request.json().catch(() => null);
  const parsed = REQUEST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    await writeAudit({
      action: 'gdpr.delete.requested',
      result: 'denied',
      actorId: userId,
      metadata: { error: parsed.error.flatten() },
      ...ctx,
    });
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Check tồn tại PENDING request
  const [existing] = await db
    .select()
    .from(deletionRequest)
    .where(and(eq(deletionRequest.userId, userId), eq(deletionRequest.status, 'PENDING')))
    .limit(1);
  if (existing) {
    return NextResponse.json(
      {
        error: 'Đã có request xoá account pending',
        scheduledFor: existing.scheduledFor,
        requestId: existing.id,
      },
      { status: 409 },
    );
  }

  // Tạo request mới
  const scheduledFor = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
  const [created] = await db
    .insert(deletionRequest)
    .values({
      userId,
      reason: parsed.data.reason ?? null,
      status: 'PENDING',
      scheduledFor,
    })
    .returning();

  if (!created) {
    return NextResponse.json({ error: 'Failed to create deletion request' }, { status: 500 });
  }

  await writeAudit({
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

  return NextResponse.json({
    ok: true,
    requestId: created.id,
    scheduledFor: scheduledFor.toISOString(),
    graceDays: GRACE_DAYS,
    cancelUrl: '/api/account/delete', // DELETE method để undo
  });
}

/**
 * DELETE — Cancel pending deletion (undo trong grace window).
 */
export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const ctx = extractRequestContext(request);

  const [existing] = await db
    .select()
    .from(deletionRequest)
    .where(and(eq(deletionRequest.userId, userId), eq(deletionRequest.status, 'PENDING')))
    .limit(1);

  if (!existing) {
    return NextResponse.json(
      { error: 'Không có deletion request pending' },
      { status: 404 },
    );
  }

  await db
    .update(deletionRequest)
    .set({ status: 'CANCELLED' })
    .where(eq(deletionRequest.id, existing.id));

  await writeAudit({
    action: 'gdpr.delete.cancelled',
    result: 'success',
    actorId: userId,
    resourceType: 'deletion_request',
    resourceId: existing.id,
    ...ctx,
  });

  return NextResponse.json({ ok: true, cancelledAt: new Date().toISOString() });
}

/**
 * GET — Status của deletion request hiện tại (cho banner UI).
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  const [pending] = await db
    .select()
    .from(deletionRequest)
    .where(and(eq(deletionRequest.userId, userId), eq(deletionRequest.status, 'PENDING')))
    .limit(1);

  if (!pending) {
    return NextResponse.json({ pending: false });
  }

  const daysRemaining = Math.max(
    0,
    Math.ceil((pending.scheduledFor.getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );

  return NextResponse.json({
    pending: true,
    requestId: pending.id,
    scheduledFor: pending.scheduledFor.toISOString(),
    daysRemaining,
    canCancel: daysRemaining > 0,
  });
}

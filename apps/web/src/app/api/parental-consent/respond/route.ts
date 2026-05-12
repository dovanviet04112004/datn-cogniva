/**
 * POST /api/parental-consent/respond — parent click email link → submit response.
 *
 * Plan v2 §3.7.2 COPPA endpoint cho parent action.
 *
 * KHÔNG yêu cầu session login — parent KHÔNG phải Cogniva user. Auth qua JWT
 * token trong URL (verify signature + check exp).
 *
 * Body:
 *   { token: string, decision: 'VERIFY' | 'REJECT', parentName?: string }
 *
 * Flow:
 *   1. Verify token → lấy userId + parentEmail
 *   2. Check child account vẫn PENDING
 *   3. Update status = VERIFIED hoặc REJECTED
 *   4. Audit log gdpr/coppa event
 *   5. Trả response cho client redirect
 */
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, user } from '@cogniva/db';

import {
  verifyConsentToken,
  setConsentStatus,
  getUserConsentState,
} from '@/lib/coppa';
import { writeAudit, extractRequestContext } from '@/lib/observability/audit';
import { logger } from '@/lib/observability/logger';
import { checkLimitCustom } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const SCHEMA = z.object({
  token: z.string().min(20),
  decision: z.enum(['VERIFY', 'REJECT']),
  /** Tên parent (optional) — lưu cho audit trail. */
  parentName: z.string().max(80).optional(),
});

export async function POST(request: Request) {
  const ctx = extractRequestContext(request);
  const ip = ctx.ipAddress ?? 'unknown';

  // Rate limit theo IP (parent có thể là anonymous, không có userId)
  // 10 attempts/15min/IP — chống brute force token guess.
  const rl = await checkLimitCustom(
    `coppa-respond:${ip}`,
    { capacity: 10, windowMs: 15 * 60 * 1000 },
    'coppa-respond',
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Quá nhiều request — đợi 15 phút.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Verify JWT token
  let payload;
  try {
    payload = verifyConsentToken(parsed.data.token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invalid token';
    logger.warn('coppa.respond.token_invalid', {
      error: msg,
      ip,
    });
    await writeAudit({
      actorType: 'webhook',
      action: 'coppa.consent.respond',
      result: 'denied',
      metadata: { error: msg, reason: 'invalid_token' },
      ...ctx,
    });
    return NextResponse.json(
      { error: 'Token không hợp lệ hoặc đã hết hạn (7 ngày).' },
      { status: 400 },
    );
  }

  // Verify child account vẫn PENDING (idempotent — không cho parent click 2 lần đổi quyết định)
  const state = await getUserConsentState(payload.userId);
  if (!state) {
    return NextResponse.json(
      { error: 'Account đã bị xoá hoặc không tồn tại.' },
      { status: 404 },
    );
  }
  if (state.status !== 'PENDING') {
    return NextResponse.json(
      {
        error: `Account đã có status ${state.status} — không thay đổi được.`,
        currentStatus: state.status,
      },
      { status: 409 },
    );
  }

  // Verify parentEmail trong token match parentEmail trong DB (defense-in-depth)
  if (state.parentEmail !== payload.parentEmail) {
    logger.warn('coppa.respond.email_mismatch', {
      user_id: payload.userId,
      token_email: payload.parentEmail,
      db_email: state.parentEmail,
    });
    return NextResponse.json(
      { error: 'Email không khớp — token có thể đã thay đổi.' },
      { status: 400 },
    );
  }

  // Apply decision
  const newStatus = parsed.data.decision === 'VERIFY' ? 'VERIFIED' : 'REJECTED';
  await setConsentStatus({ userId: payload.userId, status: newStatus });

  // Load child email cho audit (parent KHÔNG cần biết email child cụ thể nào)
  const [childRow] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, payload.userId))
    .limit(1);

  await writeAudit({
    actorType: 'webhook',
    action: parsed.data.decision === 'VERIFY' ? 'coppa.consent.verified' : 'coppa.consent.rejected',
    result: 'success',
    resourceType: 'user',
    resourceId: payload.userId,
    metadata: {
      parentEmail: payload.parentEmail,
      parentName: parsed.data.parentName,
      childEmail: childRow?.email,
    },
    ...ctx,
  });

  logger.info('coppa.consent.response', {
    user_id: payload.userId,
    decision: parsed.data.decision,
    parent_email: payload.parentEmail,
  });

  return NextResponse.json({
    ok: true,
    decision: parsed.data.decision,
    newStatus,
    childEmail: childRow?.email,
    childName: childRow?.name,
  });
}

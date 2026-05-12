/**
 * GET  /api/account/parental-consent — status hiện tại của child user.
 * POST /api/account/parental-consent/resend — gửi lại consent email cho parent.
 *
 * Plan v2 §3.7.2 — COPPA flow endpoints.
 *
 * GET: lấy state cho UI banner. Auth required (chỉ user xem state của mình).
 * POST: resend email — rate limit 3/day để tránh spam parent inbox.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { getUserConsentState, signConsentToken, calculateAge } from '@/lib/coppa';
import { writeAudit, extractRequestContext } from '@/lib/observability/audit';
import { checkLimitCustom } from '@/lib/rate-limit';
import { logger } from '@/lib/observability/logger';

export const runtime = 'nodejs';

/**
 * GET — status cho UI banner.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const state = await getUserConsentState(session.user.id);
  if (!state) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    status: state.status,
    isLimited: state.isLimited,
    parentEmail: state.parentEmail,
    parentalConsentAt: state.parentalConsentAt,
    // KHÔNG trả DOB ra — privacy. Trả age nếu cần.
    age: state.dateOfBirth ? calculateAge(state.dateOfBirth) : null,
  });
}

/**
 * POST — resend consent email tới parent.
 * Rate limit: 3 lần / ngày / user (chống spam parent inbox).
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const ctx = extractRequestContext(request);

  // Rate limit 3/24h
  const rl = await checkLimitCustom(
    `coppa-resend:${userId}`,
    { capacity: 3, windowMs: 24 * 60 * 60 * 1000 },
    'coppa-resend',
  );
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: 'Quá nhiều lần resend. Hãy đợi cha mẹ kiểm email + spam folder.',
        retryAfter: rl.retryAfter,
      },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    );
  }

  const state = await getUserConsentState(userId);
  if (!state) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  if (state.status !== 'PENDING') {
    return NextResponse.json(
      { error: `Status hiện tại ${state.status}, không cần resend.` },
      { status: 400 },
    );
  }
  if (!state.parentEmail) {
    return NextResponse.json(
      { error: 'Chưa có parent email — liên hệ support.' },
      { status: 400 },
    );
  }

  // Sign + log link (Stage 1) hoặc send email thật (Stage 2)
  const token = signConsentToken({ userId, parentEmail: state.parentEmail });
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const consentUrl = `${baseUrl}/parental-consent?token=${encodeURIComponent(token)}`;

  // TODO Stage 2: thay log bằng email API
  logger.warn('coppa.consent_email_resend', {
    user_id: userId,
    parent_email: state.parentEmail,
    consent_url: consentUrl,
  });

  await writeAudit({
    actorId: userId,
    actorType: 'user',
    action: 'coppa.consent_email.resend',
    result: 'success',
    resourceType: 'user',
    resourceId: userId,
    metadata: { parentEmail: state.parentEmail },
    ...ctx,
  });

  return NextResponse.json({
    ok: true,
    parentEmail: state.parentEmail,
    // Stage 1 dev: trả luôn URL trong response để test (KHÔNG return ở prod)
    devConsentUrl: process.env.NODE_ENV !== 'production' ? consentUrl : undefined,
  });
}

/**
 * POST   /api/account/push-token — register hoặc cập nhật push token cho device.
 * DELETE /api/account/push-token — unregister (xoá token khi user sign-out).
 *
 * Stage 2 M7 — Push notification delivery.
 *
 * Token sources:
 *   - Mobile: Expo Push Token (`ExponentPushToken[xxx]`) từ
 *     `Notifications.getExpoPushTokenAsync()`
 *   - Web push: VAPID subscription (Stage 3 nếu enable)
 *
 * Upsert logic:
 *   - Match theo `token` UNIQUE — nếu đã có token này (cùng device đã register
 *     trước đó, có thể bởi user khác → user A bán phone) → update userId +
 *     bump `lastSeenAt`.
 *   - KHÔNG match theo (userId, deviceId) vì deviceId không đảm bảo unique
 *     và Expo không expose stable deviceId.
 *
 * Privacy:
 *   - Audit log mọi register/unregister cho GDPR export
 *   - Token là PII (track được device) → KHÔNG return token trong list endpoint
 *     (chưa làm endpoint list, M7 chỉ cần POST/DELETE)
 *
 * Rate limit: bearer protected, 30 req/min (auth user) — handled by middleware.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, pushToken } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { writeAudit, extractRequestContext } from '@/lib/observability/audit';

export const runtime = 'nodejs';

const REGISTER_SCHEMA = z.object({
  /** Expo format: `ExponentPushToken[xxx]` ~ 40-50 chars */
  token: z
    .string()
    .min(10)
    .max(200)
    .refine((s) => /^(ExponentPushToken\[|ExpoPushToken\[)/.test(s), {
      message: 'Token phải format Expo Push Token',
    }),
  platform: z.enum(['ios', 'android', 'web']),
  deviceId: z.string().max(200).optional(),
});

const DELETE_SCHEMA = z.object({
  token: z.string().min(10).max(200),
});

/**
 * POST — Upsert push token cho user hiện tại.
 *
 * Idempotent: gửi lại cùng token → chỉ bump `lastSeenAt`. Safe để mobile gọi
 * mỗi lần app khởi động.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const ctx = extractRequestContext(request);

  const body = await request.json().catch(() => null);
  const parsed = REGISTER_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { token, platform, deviceId } = parsed.data;

  // Upsert: nếu token đã tồn tại → update userId (trường hợp device transferred)
  // + bump lastSeenAt. Drizzle hiện chưa có `onConflictDoUpdate` cho mọi
  // version Postgres, dùng manual check-then-write để đảm bảo compatibility.
  const [existing] = await db
    .select({ id: pushToken.id, userId: pushToken.userId })
    .from(pushToken)
    .where(eq(pushToken.token, token))
    .limit(1);

  let action: 'created' | 'updated' | 'transferred' = 'created';

  if (existing) {
    if (existing.userId !== userId) action = 'transferred';
    else action = 'updated';
    await db
      .update(pushToken)
      .set({
        userId,
        platform,
        deviceId: deviceId ?? null,
        enabled: true,
        lastSeenAt: new Date(),
      })
      .where(eq(pushToken.id, existing.id));
  } else {
    await db.insert(pushToken).values({
      userId,
      token,
      platform,
      deviceId: deviceId ?? null,
      enabled: true,
    });
  }

  await writeAudit({
    action: `push.token.${action}`,
    result: 'success',
    actorId: userId,
    resourceType: 'push_token',
    metadata: { platform, deviceId: deviceId ?? null },
    ...ctx,
  });

  return NextResponse.json({ ok: true, action });
}

/**
 * DELETE — Unregister token (mobile sign-out hoặc disable notif).
 *
 * Require token trong body — KHÔNG xoá hết token của user vì user có thể có
 * nhiều device, chỉ sign-out 1 device cụ thể.
 */
export async function DELETE(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const ctx = extractRequestContext(request);

  const body = await request.json().catch(() => null);
  const parsed = DELETE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Chỉ xoá nếu token thuộc user — tránh user A xoá token của user B (qua
  // request craft) ngay cả khi đoán đúng token.
  const result = await db
    .delete(pushToken)
    .where(and(eq(pushToken.token, parsed.data.token), eq(pushToken.userId, userId)))
    .returning({ id: pushToken.id });

  await writeAudit({
    action: 'push.token.deleted',
    result: result.length > 0 ? 'success' : 'denied',
    actorId: userId,
    resourceType: 'push_token',
    metadata: { removed: result.length },
    ...ctx,
  });

  return NextResponse.json({ ok: true, removed: result.length });
}

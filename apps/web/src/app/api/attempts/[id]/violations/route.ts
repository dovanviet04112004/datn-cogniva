/**
 * POST /api/attempts/[id]/violations — student client log batch violation events.
 *
 * Body: { events: ViolationEvent[] }
 *
 * Side effects:
 *   1. INSERT batch vào examViolation table
 *   2. APPEND vào examAttempt.violations jsonb array
 *   3. Recompute cheatRiskScore = weighted sum / max possible
 *      - low severity   = 1 point
 *      - medium severity = 3 points
 *      - high severity  = 10 points
 *      - clamp to [0, 1] qua sigmoid
 *   4. Auto-set `flagged = true` nếu cheatRiskScore > 0.7 (threshold V1)
 *
 * Idempotency: client có thể retry → trùng event. V1 chấp nhận (chỉ log,
 * không tính double penalty vì client dedupe ở queue).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, examAttempt, examViolation } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const SEVERITY_WEIGHT = { low: 1, medium: 3, high: 10 } as const;
const FLAG_THRESHOLD = 0.7;

const EVENT_SCHEMA = z.object({
  type: z.string().max(50),
  severity: z.enum(['low', 'medium', 'high']),
  timestamp: z.number(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const BODY_SCHEMA = z.object({
  events: z.array(EVENT_SCHEMA).max(50),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [attempt] = await db.select().from(examAttempt).where(eq(examAttempt.id, id)).limit(1);
  if (!attempt) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (attempt.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = BODY_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.events.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  // 1. Insert each event vào examViolation
  await db.insert(examViolation).values(
    parsed.data.events.map((e) => ({
      attemptId: id,
      type: e.type,
      severity: e.severity,
      metadata: { ...e.metadata, clientTimestamp: e.timestamp },
      timestamp: new Date(e.timestamp),
    })),
  );

  // 2. Append vào jsonb array (concat existing + new). Existing format
  // có thể không có `severity` field nếu legacy — coerce thành full shape.
  type ViolationRecord = { type: string; timestamp: string; severity: string; metadata?: unknown };
  const existingViolations: ViolationRecord[] = Array.isArray(attempt.violations)
    ? (attempt.violations as Array<{ type: string; timestamp: string; metadata?: unknown }>).map((v) => ({
        ...v,
        severity: (v as ViolationRecord).severity ?? 'low',
      }))
    : [];
  const merged: ViolationRecord[] = [
    ...existingViolations,
    ...parsed.data.events.map((e) => ({
      type: e.type,
      timestamp: new Date(e.timestamp).toISOString(),
      severity: e.severity,
      metadata: e.metadata,
    })),
  ];

  // 3. Recompute cheatRiskScore từ TOÀN BỘ violations (low/medium/high weights)
  let totalWeight = 0;
  for (const v of merged) {
    const w = SEVERITY_WEIGHT[v.severity as keyof typeof SEVERITY_WEIGHT] ?? 0;
    totalWeight += w;
  }
  // Sigmoid map [0, ∞) → [0, 1). 30 points = 0.5, 60 points ≈ 0.8.
  const cheatRiskScore = 1 - Math.exp(-totalWeight / 30);

  const flagged = cheatRiskScore > FLAG_THRESHOLD;
  const flagReason = flagged
    ? `Auto-flag: cheatRiskScore=${cheatRiskScore.toFixed(2)} > ${FLAG_THRESHOLD} (${merged.length} violations)`
    : null;

  await db
    .update(examAttempt)
    .set({
      violations: merged as never,
      cheatRiskScore,
      flagged,
      flagReason: flagged ? flagReason : attempt.flagReason,
    })
    .where(eq(examAttempt.id, id));

  return NextResponse.json({
    ok: true,
    inserted: parsed.data.events.length,
    totalViolations: merged.length,
    cheatRiskScore,
    flagged,
  });
}

/**
 * GET /api/attempts/[id]/violations — owner xem timeline.
 */
export async function GET(_request: Request, ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await ctx.params;

  const [attempt] = await db.select().from(examAttempt).where(eq(examAttempt.id, id)).limit(1);
  if (!attempt) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Owner verify qua exam.ownerId
  const ownerCheck = await db.execute(
    sql`SELECT owner_id FROM exam WHERE id = ${attempt.examId} LIMIT 1`,
  );
  const ownerId = (ownerCheck[0] as { owner_id?: string } | undefined)?.owner_id;
  if (ownerId !== session.user.id && attempt.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const violations = await db
    .select()
    .from(examViolation)
    .where(eq(examViolation.attemptId, id))
    .orderBy(examViolation.timestamp);

  return NextResponse.json({
    attempt: {
      id: attempt.id,
      userId: attempt.userId,
      cheatRiskScore: attempt.cheatRiskScore,
      flagged: attempt.flagged,
      flagReason: attempt.flagReason,
    },
    violations,
  });
}

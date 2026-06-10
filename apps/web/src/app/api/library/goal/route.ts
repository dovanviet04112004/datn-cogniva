/**
 * POST /api/library/goal — Pillar #1 goal-driven discovery.
 *
 * Body: { userMessage: "Ôn thi tốt nghiệp Toán THPT 2025 trong 4 tuần" }
 * Trả về: parsed goal + weekly study plan + library docs cho mỗi tuần.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { buildStudyPlan, parseGoal } from '@/lib/library/goal-planner';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BODY = z.object({
  userMessage: z.string().min(5).max(500),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const plan = (
    (session.user as { plan?: string }).plan ?? 'FREE'
  ) as 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';

  try {
    const goal = await parseGoal({
      userMessage: parsed.data.userMessage,
      userId: session.user.id,
      plan,
    });
    const studyPlan = await buildStudyPlan(goal);
    return NextResponse.json(studyPlan);
  } catch (err) {
    console.error('[library.goal]', err);
    return NextResponse.json(
      { error: 'Goal planning failed', message: (err as Error).message },
      { status: 500 },
    );
  }
}

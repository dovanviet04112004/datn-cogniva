/**
 * GET  /api/exams — list exam liên quan tới user:
 *   - `owned`: exam user TẠO (làm chủ + share cho người khác làm)
 *   - `joined`: exam user ĐÃ THAM GIA (có examAttempt) của owner khác
 * POST /api/exams — tạo exam DRAFT
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db, dbReplica, exam, examAttempt, user } from '@cogniva/db';
import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';
import { onExamChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

const CREATE_SCHEMA = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  workspaceId: z.string().nullable().optional(),
  mode: z.enum(['PRACTICE', 'TIMED']).default('PRACTICE'),
  durationSeconds: z.number().int().positive().optional(),
  passingScore: z.number().min(0).max(1).optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  allowReview: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  showResults: z.enum(['IMMEDIATE', 'AFTER_SUBMIT', 'AFTER_ALL_DONE']).optional(),
});

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const uid = session.user.id;

  const url = new URL(request.url);
  const workspaceParam = url.searchParams.get('workspaceId');

  // ── Cache-aside (Tier 1) ──────────────────────────────────────────────────
  // List exams (owned + joined) là read thuần, gọi mỗi lần mở tab Exams của
  // workspace → đáng cache. Key fold theo filter workspace:
  //   - không param  → 'all'  (toàn bộ exam mình tạo)
  //   - 'null'       → exam chưa gán workspace (giữ nguyên chuỗi 'null' làm key)
  //   - <wsId>       → exam trong workspace đó
  // TTL 120s = lưới an toàn cuối; invalidate chủ động qua onExamChanged khi
  // create/update/delete exam HOẶC submit attempt (summary joined đổi).
  // Đọc qua dbReplica vì là read thuần, không read-your-own-write trong request.
  // Date field (createdAt/publishedAt/latestStartedAt) serialize→string nhưng
  // chỉ đi tiếp vào NextResponse.json (không date-math) nên để string an toàn.
  const wsKey = workspaceParam ?? 'all';

  const data = await cached(ck.exams(uid, wsKey), 120, async () => {
    const ownedFilters = [eq(exam.ownerId, uid)];
    if (workspaceParam === 'null') {
      ownedFilters.push(isNull(exam.workspaceId));
    } else if (workspaceParam) {
      ownedFilters.push(eq(exam.workspaceId, workspaceParam));
    }

    // 1. Exams MÌNH TẠO — owner (scope theo workspace nếu có param)
    const owned = await dbReplica
      .select({
        id: exam.id,
        title: exam.title,
        description: exam.description,
        workspaceId: exam.workspaceId,
        mode: exam.mode,
        status: exam.status,
        durationSeconds: exam.durationSeconds,
        maxScore: exam.maxScore,
        maxAttempts: exam.maxAttempts,
        createdAt: exam.createdAt,
        publishedAt: exam.publishedAt,
      })
      .from(exam)
      .where(and(...ownedFilters))
      .orderBy(desc(exam.createdAt));

    // 2. Exams MÌNH ĐÃ THAM GIA — có examAttempt + KHÔNG phải mình tạo
    //    GROUP BY exam.id để 1 user có nhiều attempt vẫn chỉ hiện 1 dòng.
    //    Aggregate: latest attempt status + best score để hiện summary.
    const joined = await dbReplica
      .select({
        id: exam.id,
        title: exam.title,
        description: exam.description,
        mode: exam.mode,
        status: exam.status,
        durationSeconds: exam.durationSeconds,
        maxScore: exam.maxScore,
        maxAttempts: exam.maxAttempts,
        publishedAt: exam.publishedAt,
        ownerName: user.name,
        attemptCount: sql<number>`count(${examAttempt.id})::int`,
        bestScore: sql<number | null>`max(${examAttempt.score})`,
        bestPercentage: sql<number | null>`max(${examAttempt.percentage})`,
        latestAttemptId: sql<string | null>`(array_agg(${examAttempt.id} ORDER BY ${examAttempt.startedAt} DESC))[1]`,
        latestStatus: sql<string | null>`(array_agg(${examAttempt.status}::text ORDER BY ${examAttempt.startedAt} DESC))[1]`,
        latestStartedAt: sql<string>`max(${examAttempt.startedAt})`,
      })
      .from(examAttempt)
      .innerJoin(exam, eq(examAttempt.examId, exam.id))
      .innerJoin(user, eq(exam.ownerId, user.id))
      .where(and(eq(examAttempt.userId, uid), ne(exam.ownerId, uid)))
      .groupBy(
        exam.id,
        exam.title,
        exam.description,
        exam.mode,
        exam.status,
        exam.durationSeconds,
        exam.maxScore,
        exam.maxAttempts,
        exam.publishedAt,
        user.name,
      )
      .orderBy(desc(sql`max(${examAttempt.startedAt})`));

    return { owned, joined };
  });

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // TIMED mode → require durationSeconds. liveCode chỉ sinh khi publish.
  if (parsed.data.mode === 'TIMED' && !parsed.data.durationSeconds) {
    return NextResponse.json(
      { error: 'TIMED mode bắt buộc có durationSeconds' },
      { status: 400 },
    );
  }

  const [created] = await db
    .insert(exam)
    .values({
      ownerId: session.user.id,
      workspaceId: parsed.data.workspaceId ?? null,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      mode: parsed.data.mode,
      durationSeconds: parsed.data.durationSeconds ?? null,
      passingScore: parsed.data.passingScore ?? null,
      shuffleQuestions: parsed.data.shuffleQuestions ?? true,
      shuffleOptions: parsed.data.shuffleOptions ?? true,
      allowReview: parsed.data.allowReview ?? true,
      maxAttempts: parsed.data.maxAttempts ?? 1,
      showResults: parsed.data.showResults ?? 'IMMEDIATE',
    })
    .returning();
  if (!created) return NextResponse.json({ error: 'Failed to create exam' }, { status: 500 });

  // Exam mới → bust list exams của owner (key 'all' + key workspace của exam)
  // và badge stats workspace đó (count exam ++). onExamChanged tự fan-out.
  await onExamChanged(session.user.id, created.workspaceId);

  return NextResponse.json({ exam: created }, { status: 201 });
}

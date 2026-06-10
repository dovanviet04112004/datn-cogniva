/**
 * /api/tutoring/requests — list (GET) + create (POST) student requests.
 *
 * GET: filter subjectSlug/level/modality/urgency/status. Public list của
 *      request OPEN — các tutor browse + apply.
 * POST: student create request. Rate limit 5/ngày/user (xem checkLimit).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  dbReplica,
  tutorRequest,
  user as userTable,
  validateSubject,
} from '@cogniva/db';
import type { SubjectLevel } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';
import { onTutoringMineChanged } from '@/lib/cache/invalidate';
import { checkLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const FILTER_SCHEMA = z.object({
  subjectSlug: z.string().optional(),
  level: z.string().optional(),
  modality: z.string().optional(),
  urgency: z.string().optional(),
  status: z.string().optional().default('OPEN'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = FILTER_SCHEMA.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const filters = parsed.data;

  const conds = [eq(tutorRequest.status, filters.status)];
  if (filters.subjectSlug) conds.push(eq(tutorRequest.subjectSlug, filters.subjectSlug));
  if (filters.level) conds.push(eq(tutorRequest.level, filters.level));
  if (filters.modality) conds.push(eq(tutorRequest.modality, filters.modality));
  if (filters.urgency) conds.push(eq(tutorRequest.urgency, filters.urgency));

  // filterHash — chuẩn hoá mọi biến lọc + limit thành key cache ổn định. Cùng filter
  // → cùng key → chia sẻ giữa các tutor đang browse. Thiếu = '' để phân biệt trạng thái.
  const filterHash = [
    `st=${filters.status}`,
    `s=${filters.subjectSlug ?? ''}`,
    `l=${filters.level ?? ''}`,
    `m=${filters.modality ?? ''}`,
    `u=${filters.urgency ?? ''}`,
    `lim=${filters.limit}`,
  ].join('|');

  // List request OPEN là DATA CÔNG KHAI (mọi tutor thấy giống nhau cùng filter), đổi
  // chậm → cache-aside Redis TTL-only 120s. dbReplica (read thuần). Rows trả thẳng qua
  // NextResponse.json (createdAt/expiresAt serialize string) → không cần re-hydrate Date.
  const rows = await cached(ck.tutoringRequests(filterHash), 120, () =>
    dbReplica
      .select({
        id: tutorRequest.id,
        title: tutorRequest.title,
        description: tutorRequest.description,
        subjectSlug: tutorRequest.subjectSlug,
        level: tutorRequest.level,
        budgetVnd: tutorRequest.budgetVnd,
        modality: tutorRequest.modality,
        urgency: tutorRequest.urgency,
        status: tutorRequest.status,
        createdAt: tutorRequest.createdAt,
        expiresAt: tutorRequest.expiresAt,
        studentId: tutorRequest.studentId,
        studentName: userTable.name,
        studentImage: userTable.image,
      })
      .from(tutorRequest)
      .innerJoin(userTable, eq(userTable.id, tutorRequest.studentId))
      .where(and(...conds))
      .orderBy(desc(tutorRequest.createdAt))
      .limit(filters.limit),
  );

  return NextResponse.json({ requests: rows });
}

const CREATE_SCHEMA = z.object({
  title: z.string().min(10).max(160),
  description: z.string().min(50).max(2000),
  subjectSlug: z.string().min(1),
  level: z.enum(['PRIMARY', 'SECONDARY', 'HIGH_SCHOOL', 'UNIVERSITY', 'ADULT']),
  budgetVnd: z.number().int().min(10000).max(10000000).nullable().optional(),
  modality: z.enum(['ONLINE', 'OFFLINE_HN', 'OFFLINE_HCM', 'HYBRID']),
  urgency: z.enum(['ASAP', 'THIS_WEEK', 'THIS_MONTH', 'FLEXIBLE']),
});

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  // Rate limit: max 5 request/ngày/user — chống spam (xem plan §8.2)
  const rl = await checkLimit(`tutoring-request:${userId}`, 'default');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Quá nhiều yêu cầu — hôm nay bạn đã post tối đa rồi' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Validate taxonomy
  const subject = validateSubject(
    parsed.data.subjectSlug,
    parsed.data.level as SubjectLevel,
  );
  if (!subject) {
    return NextResponse.json(
      { error: 'Môn / level không hợp lệ' },
      { status: 400 },
    );
  }

  // Expire 30 ngày từ create
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const [created] = await db
    .insert(tutorRequest)
    .values({
      studentId: userId,
      title: parsed.data.title.trim(),
      description: parsed.data.description.trim(),
      subjectSlug: parsed.data.subjectSlug,
      level: parsed.data.level,
      budgetVnd: parsed.data.budgetVnd ?? null,
      modality: parsed.data.modality,
      urgency: parsed.data.urgency,
      expiresAt,
    })
    .returning();

  // Yêu cầu mới hiện ở MineTab "Yêu cầu của tôi" của student → xoá cache mine của họ.
  await onTutoringMineChanged(userId);

  return NextResponse.json({ request: created }, { status: 201 });
}

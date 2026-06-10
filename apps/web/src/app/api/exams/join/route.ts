/**
 * POST /api/exams/join — student resolve 6-char liveCode → examId.
 *
 * Body: { code: string }
 * Trả: { examId, mode } để client redirect /exams/[examId].
 *
 * KHÔNG tạo attempt ở đây — student bấm "Bắt đầu" ở trang exam detail mới
 * tạo. Tránh duplicate attempt nếu student vào nhầm code rồi back.
 *
 * Auth: bắt buộc login (Cogniva không hỗ trợ guest exam).
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, exam } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

const SCHEMA = z.object({ code: z.string().min(4).max(12) });

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Code không hợp lệ' }, { status: 400 });
  }
  const code = parsed.data.code.toUpperCase().trim();

  const [row] = await db
    .select({ id: exam.id, mode: exam.mode, status: exam.status })
    .from(exam)
    .where(eq(exam.liveCode, code))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: 'Không tìm thấy exam với code này' }, { status: 404 });
  }
  if (row.status !== 'PUBLISHED') {
    return NextResponse.json(
      { error: `Exam chưa public (status: ${row.status})` },
      { status: 403 },
    );
  }

  return NextResponse.json({ examId: row.id, mode: row.mode });
}

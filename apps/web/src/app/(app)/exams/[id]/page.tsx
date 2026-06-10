/**
 * /exams/[id] — V8.24 redirect-only.
 *
 * Legacy builder/start page đã được thay bởi:
 *   - Owner (DRAFT/PUBLISHED): mở trong workspace Studio (ExamEditorDialog +
 *     StudioExamInlinePreview) — UI builder + share code + làm thử inline.
 *   - Student PUBLISHED: cũng vào workspace của exam nếu có; nếu exam không
 *     gắn workspace → fallback redirect tới start attempt → /take.
 *
 * Mọi entry point cũ (atom-detail, group chat exam link, join code resolve)
 * vẫn dùng URL `/exams/[id]` — page này resolve smart:
 *
 *   1. Có workspaceId  → /workspaces/[wsid]?examPreview=[id]
 *   2. Không có (legacy / DM share):
 *      - DRAFT + owner → /workspaces (chọn workspace nào)
 *      - PUBLISHED student → tạo attempt + redirect /take
 *      - ENDED → /workspaces (read-only fallback)
 *
 * Không còn full-page builder; tránh trỏ lại trang cũ.
 */
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { and, eq } from 'drizzle-orm';

import { db, exam, examAttempt } from '@cogniva/db';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ExamRedirectPage({ params }: Props) {
  const { id } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    redirect(`/sign-in?redirect=${encodeURIComponent(`/exams/${id}`)}`);
  }

  const [row] = await db
    .select({
      id: exam.id,
      ownerId: exam.ownerId,
      workspaceId: exam.workspaceId,
      status: exam.status,
      mode: exam.mode,
    })
    .from(exam)
    .where(eq(exam.id, id))
    .limit(1);

  if (!row) redirect('/workspaces');

  const isOwner = row.ownerId === session.user.id;

  // Owner + DRAFT: bắt buộc vào workspace để build. Nếu chưa gán workspace,
  // bounce về /workspaces để user chọn (legacy exam tạo từ trang cũ).
  if (isOwner) {
    if (row.workspaceId) {
      redirect(`/workspaces/${row.workspaceId}?examPreview=${row.id}`);
    }
    redirect('/workspaces');
  }

  // Student không thấy DRAFT/ENDED — fail lại workspaces (sidebar nav).
  if (row.status !== 'PUBLISHED') {
    redirect('/workspaces');
  }

  // Student PUBLISHED — nếu có workspace, vào workspace để xem inline preview
  // trước (đẹp UX hơn, có lịch sử + nút Bắt đầu). Nếu không, resume hoặc tạo
  // attempt mới rồi redirect /take.
  if (row.workspaceId) {
    redirect(`/workspaces/${row.workspaceId}?examPreview=${row.id}`);
  }

  // No workspace context — resume nếu có IN_PROGRESS, else không tự tạo
  // attempt (POST endpoint là user-gesture). Fallback gửi sang /workspaces.
  const [existing] = await db
    .select({ id: examAttempt.id })
    .from(examAttempt)
    .where(
      and(
        eq(examAttempt.examId, row.id),
        eq(examAttempt.userId, session.user.id),
        eq(examAttempt.status, 'IN_PROGRESS'),
      ),
    )
    .limit(1);
  if (existing) {
    redirect(`/exams/${row.id}/take/${existing.id}`);
  }
  redirect('/workspaces');
}

/**
 * GET /workspaces/new-chat — "Hỏi AI Tutor" LUÔN mở được chat.
 *
 * Vấn đề cũ: nút "Hỏi AI" link tới `/workspaces/[id]`, nhưng user CHƯA có
 * workspace nào thì id rỗng → đổ ra trang picker trống, bấm chat không được.
 *
 * Route này đảm bảo có workspace rồi redirect THẲNG vào khung chat:
 *   - Có workspace → dùng cái GẦN NHẤT (đang làm dở).
 *   - Chưa có → tạo "Default" (getOrCreateDefaultWorkspace) ngay khi user bấm.
 *
 * Dùng cho mọi CTA "Hỏi AI / chat" để không bao giờ dẫn vào ngõ cụt.
 */
import { redirect } from 'next/navigation';
import { desc, eq } from 'drizzle-orm';

import { db, workspace } from '@cogniva/db';

import { getServerSession } from '@/lib/auth-server';
import { getOrCreateDefaultWorkspace } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getServerSession();
  if (!session) redirect('/sign-in?redirect=/workspaces');
  const userId = session.user.id;

  // Workspace gần nhất (đang làm dở) — ưu tiên dùng lại thay vì tạo mới.
  const [recent] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.userId, userId))
    .orderBy(desc(workspace.createdAt))
    .limit(1);

  // Chưa có workspace nào → tạo "Default" ngay (side-effect CHỦ ĐÍCH khi user
  // bấm "Hỏi AI", không phải lúc render dashboard).
  const wsId = recent?.id ?? (await getOrCreateDefaultWorkspace(userId)).id;

  redirect(`/workspaces/${wsId}`);
}

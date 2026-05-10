/**
 * Workspace helper — utilities làm việc với workspace của user.
 *
 * Phase 1 chưa có UI tạo workspace nên cần một workspace mặc định cho
 * mỗi user (vì document.workspaceId là NOT NULL). Tạo lazy lúc upload
 * lần đầu — đỡ phải migrate user cũ.
 */
import { and, eq } from 'drizzle-orm';

import { db, workspace } from '@cogniva/db';

/**
 * Tìm workspace mặc định của user, tạo mới nếu chưa có.
 *
 * "Mặc định" được định nghĩa là workspace có name = "Default". Khi UI
 * cho phép tạo workspace tuỳ ý ở phase sau, hàm này vẫn trả về workspace
 * tên Default (hoặc tạo lại nếu user đã đổi tên).
 *
 * @param userId - ID của user (từ session.user.id)
 * @returns Workspace row đã tồn tại hoặc vừa tạo
 */
export async function getOrCreateDefaultWorkspace(userId: string) {
  const found = await db
    .select()
    .from(workspace)
    .where(and(eq(workspace.userId, userId), eq(workspace.name, 'Default')))
    .limit(1);

  if (found.length > 0) return found[0]!;

  const [created] = await db
    .insert(workspace)
    .values({
      userId,
      name: 'Default',
      description: 'Workspace mặc định — tự tạo khi upload tài liệu đầu tiên.',
    })
    .returning();

  if (!created) throw new Error('Failed to create default workspace');
  return created;
}

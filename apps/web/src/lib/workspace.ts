import { and, eq } from 'drizzle-orm';

import { db, workspace } from '@cogniva/db';

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

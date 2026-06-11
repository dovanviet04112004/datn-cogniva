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

  const [recent] = await db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.userId, userId))
    .orderBy(desc(workspace.createdAt))
    .limit(1);

  const wsId = recent?.id ?? (await getOrCreateDefaultWorkspace(userId)).id;

  redirect(`/workspaces/${wsId}`);
}

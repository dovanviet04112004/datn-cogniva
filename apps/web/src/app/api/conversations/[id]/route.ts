/**
 * DELETE /api/conversations/[id] — xoá conversation + cascade messages.
 *
 * Auth: conversation phải thuộc user (chống IDOR). Drizzle schema có ON DELETE
 * CASCADE từ message → conversation nên xoá conversation auto xoá messages.
 *
 * GET /api/conversations/[id] — load metadata (optional, dùng cho future
 * "share conversation" feature). Hiện tại chỉ dùng DELETE.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { conversation, db } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { onConversationsChanged } from '@/lib/cache/invalidate';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await context.params;

  // Verify ownership trước khi xoá — KHÔNG dùng RETURNING-only vì chống IDOR
  // cần explicit check (user khác có thể guess id).
  const [conv] = await db
    .select({ id: conversation.id })
    .from(conversation)
    .where(and(eq(conversation.id, id), eq(conversation.userId, session.user.id)))
    .limit(1);
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await db.delete(conversation).where(eq(conversation.id, id));
  // Conversation biến khỏi sidebar chat list → bust.
  await onConversationsChanged(session.user.id);
  return NextResponse.json({ ok: true });
}

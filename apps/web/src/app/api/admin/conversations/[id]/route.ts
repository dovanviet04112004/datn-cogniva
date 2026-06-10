/**
 * GET /api/admin/conversations/[id] — full thread + owner.
 *
 * Trả về toàn bộ messages ASC theo createdAt (chat order). Citations + metadata
 * raw để admin review token cost.
 *
 * DELETE /api/admin/conversations/[id] — soft delete: xoá row, FK CASCADE xoá
 * messages. Yêu cầu reason. Auth SUPER_ADMIN / ADMIN.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { conversation, db, message, user, workspace } from '@cogniva/db';

import { isGuardResponse, requireAdminRole } from '@/lib/admin/guard';
import { getAuditMeta, withAudit } from '@/lib/admin/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireAdminRole();
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;

  const [row] = await db
    .select({
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      userId: conversation.userId,
      userName: user.name,
      userEmail: user.email,
      workspaceId: conversation.workspaceId,
      workspaceName: workspace.name,
    })
    .from(conversation)
    .leftJoin(user, eq(user.id, conversation.userId))
    .leftJoin(workspace, eq(workspace.id, conversation.workspaceId))
    .where(eq(conversation.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  const messages = await db
    .select({
      id: message.id,
      role: message.role,
      content: message.content,
      citations: message.citations,
      metadata: message.metadata,
      createdAt: message.createdAt,
    })
    .from(message)
    .where(eq(message.conversationId, id))
    .orderBy(asc(message.createdAt));

  return NextResponse.json({
    conversation: {
      ...row,
      createdAt: row.createdAt.toISOString(),
    },
    messages: messages.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

const DELETE_SCHEMA = z.object({
  reason: z.string().trim().min(10).max(500),
});

export async function DELETE(request: Request, { params }: Params) {
  let admin;
  try {
    admin = await requireAdminRole(['SUPER_ADMIN', 'ADMIN']);
  } catch (err) {
    if (isGuardResponse(err)) return err;
    throw err;
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = DELETE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { reason } = parsed.data;

  const hdr = await headers();
  const meta = getAuditMeta(hdr);

  const result = await withAudit(
    { admin, ip: meta.ip, userAgent: meta.userAgent },
    'conversation.delete',
    { type: 'conversation', id },
    async () => {
      const [before] = await db
        .select({ id: conversation.id, title: conversation.title, userId: conversation.userId })
        .from(conversation)
        .where(eq(conversation.id, id))
        .limit(1);
      if (!before) throw new Error('Conversation not found');

      await db.delete(conversation).where(eq(conversation.id, id));

      return { before, after: null, reason, result: { ok: true } };
    },
  );

  return NextResponse.json(result);
}

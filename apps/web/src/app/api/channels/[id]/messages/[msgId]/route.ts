/**
 * /api/channels/[id]/messages/[msgId] — edit + soft-delete message.
 *
 * PUT { content }   : edit own message. Set editedAt = now.
 * DELETE            : soft-delete. Author hoặc MOD+ delete bất kỳ. Set deletedAt = now.
 *
 * Cả 2 broadcast realtime event để các client khác cập nhật UI realtime.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  studyGroupChannel,
  studyGroupMember,
  studyGroupMessage,
  studyGroupMessageRevision,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { can, type GroupRole } from '@/lib/group/permissions';
import { writeAudit } from '@/lib/observability/audit';
import { triggerEvent } from '@/lib/realtime-server';

export const runtime = 'nodejs';

const EDIT_SCHEMA = z.object({
  content: z.string().min(1).max(4000),
});

async function loadMsgContext(channelId: string, msgId: string, userId: string) {
  const [msg] = await db
    .select()
    .from(studyGroupMessage)
    .where(and(eq(studyGroupMessage.id, msgId), eq(studyGroupMessage.channelId, channelId)))
    .limit(1);
  if (!msg) return null;
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return null;
  const [member] = await db
    .select()
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, ch.groupId), eq(studyGroupMember.userId, userId)),
    )
    .limit(1);
  if (!member) return null;
  return { msg, member };
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const { id: channelId, msgId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await loadMsgContext(channelId, msgId, session.user.id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { msg } = ctx;

  // Chỉ author mới edit (mod không edit hộ — như Discord)
  if (msg.authorId !== session.user.id) {
    return NextResponse.json({ error: 'Chỉ tác giả mới edit message' }, { status: 403 });
  }
  if (msg.deletedAt) {
    return NextResponse.json({ error: 'Message đã xoá, không edit được' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = EDIT_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // V2 G2.7: skip update + revision nếu content không đổi (no-op edit)
  if (parsed.data.content === msg.content) {
    return NextResponse.json({ message: msg });
  }

  // V2 G2.7: snapshot content cũ vào revision table TRƯỚC khi update.
  // Wrap trong transaction để snapshot + update atomic (tránh state mất content
  // cũ nếu update OK nhưng insert revision fail).
  const updated = await db.transaction(async (tx) => {
    await tx.insert(studyGroupMessageRevision).values({
      messageId: msgId,
      content: msg.content,
      // editedAt = thời điểm content NÀY trở thành "phiên bản cũ" = lần edit
      // trước đó (hoặc createdAt nếu chưa từng edit). Dùng msg.editedAt nếu
      // có, else msg.createdAt — để timeline đọc "X chỉnh sửa lúc Y" chuẩn.
      editedAt: msg.editedAt ?? msg.createdAt,
    });
    const [u] = await tx
      .update(studyGroupMessage)
      .set({ content: parsed.data.content, editedAt: new Date() })
      .where(eq(studyGroupMessage.id, msgId))
      .returning();
    return u;
  });
  if (!updated) {
    return NextResponse.json({ error: 'Update thất bại' }, { status: 500 });
  }

  void triggerEvent(`private-channel-${channelId}`, 'message:edit', {
    id: updated.id,
    content: updated.content,
    editedAt: updated.editedAt,
  });

  return NextResponse.json({ message: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; msgId: string }> },
) {
  const { id: channelId, msgId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ctx = await loadMsgContext(channelId, msgId, session.user.id);
  if (!ctx) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { msg, member } = ctx;

  const isOwn = msg.authorId === session.user.id;
  if (!isOwn && !can(member.role as GroupRole, 'message.delete-any')) {
    return NextResponse.json({ error: 'Không có quyền xoá message' }, { status: 403 });
  }
  if (msg.deletedAt) {
    return NextResponse.json({ deleted: true, alreadyDeleted: true });
  }

  await db
    .update(studyGroupMessage)
    .set({ deletedAt: new Date() })
    .where(eq(studyGroupMessage.id, msgId));

  void triggerEvent(`private-channel-${channelId}`, 'message:delete', {
    id: msgId,
    deletedBy: session.user.id,
  });

  // Audit log — chỉ ghi khi mod xoá message của user khác
  if (!isOwn) {
    void writeAudit({
      action: 'study_group.message.deleted',
      result: 'success',
      actorId: session.user.id,
      actorType: 'user',
      resourceType: 'study_group_message',
      resourceId: msgId,
      metadata: {
        channelId,
        originalAuthorId: msg.authorId,
        contentPreview: msg.content.slice(0, 200),
      },
    });
  }

  return NextResponse.json({ deleted: true });
}

/**
 * POST /api/channels/[id]/ai-reply — process AI Tutor reply synchronously.
 *
 * Client gọi endpoint này sau khi POST /messages thành công nếu content chứa
 * `@AI`. Server xử lý đồng bộ (giữ request alive tới khi AI generate xong)
 * thay vì fire-and-forget sau response — pattern này reliable trên Next.js
 * serverless/Turbopack.
 *
 * Body: { originalMessageId, prompt }
 *   - originalMessageId: id của message user vừa POST (làm replyToId)
 *   - prompt: content user gõ (đã include `@AI`, server strip ra)
 *
 * Trả: { message } — full AI reply payload, đồng thời broadcast realtime.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, studyGroupChannel, studyGroupMember } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { fireAiReply, hasAiMention } from '@/lib/group/ai-reply';

export const runtime = 'nodejs';
// AI generation có thể 5-15s — Next.js mặc định 10s timeout cho route handler.
export const maxDuration = 30;

const SCHEMA = z.object({
  originalMessageId: z.string().min(1),
  prompt: z.string().min(1).max(4000),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: channelId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify member of channel.groupId. VOICE channel giờ hỗ trợ AI mention
  // qua chat persistent (Discord-style).
  const [ch] = await db
    .select({ groupId: studyGroupChannel.groupId, type: studyGroupChannel.type })
    .from(studyGroupChannel)
    .where(eq(studyGroupChannel.id, channelId))
    .limit(1);
  if (!ch) return NextResponse.json({ error: 'Channel không tồn tại' }, { status: 404 });

  const [member] = await db
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(eq(studyGroupMember.groupId, ch.groupId), eq(studyGroupMember.userId, session.user.id)),
    )
    .limit(1);
  if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (!hasAiMention(parsed.data.prompt, [])) {
    return NextResponse.json({ error: 'Không có mention @AI' }, { status: 400 });
  }

  // Synchronous — keep request alive cho tới khi AI hoàn tất
  try {
    await fireAiReply({
      channelId,
      authorId: session.user.id,
      authorName: session.user.name ?? 'Người dùng',
      originalMessageId: parsed.data.originalMessageId,
      content: parsed.data.prompt,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: 'AI reply thất bại: ' + msg }, { status: 500 });
  }
}

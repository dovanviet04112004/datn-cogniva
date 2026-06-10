/**
 * POST /api/rooms/[id]/ai-message — user gõ `@AI <câu hỏi>` → trigger AI tutor.
 *
 * Flow:
 *   1. Auth + verify user là member ACTIVE của room.
 *   2. Rate limit: 10 req/phút/user/room (AI gọi tốn token, chống spam).
 *   3. Load room + ≤20 message gần nhất từ DB.
 *   4. Insert placeholder AI message (content='', type='AI') để khoá ID
 *      trước khi stream → client subscribe theo messageId.
 *   5. Broadcast `chat:message` ngay (UI hiển thị bubble "AI Tutor đang gõ...").
 *   6. streamRoomTutor() → for-await loop, mỗi chunk broadcast `ai:streaming`.
 *   7. Khi finish: UPDATE message.content = full text → broadcast `ai:complete`.
 *
 * Vì sao tách `ai:streaming` (delta) khỏi `chat:message` (event chính):
 *   - `chat:message` chỉ fire 1 lần với placeholder rỗng (giữ thứ tự + ID).
 *   - `ai:streaming` fire N lần, client accumulate vào message theo `messageId`.
 *   - `ai:complete` fire 1 lần, client lock content + bỏ "đang gõ" indicator.
 *
 * Nếu AI generate fail giữa chừng → catch trong loop, broadcast `ai:error` +
 * UPDATE content = "[AI generation failed]" để DB không có row rỗng vĩnh viễn.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, room, roomMember, roomMessage } from '@cogniva/db';

import { auth } from '@/lib/auth';
import { streamRoomTutor, type TutorChatMessage } from '@/lib/ai/room-tutor';
import { triggerEvent } from '@/lib/realtime-server';
import { checkLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
// AI generation 30-60s với chunks dài — cho phép tới 120s
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };

const POST_SCHEMA = z.object({
  /** Câu hỏi của user (đã strip `@AI` prefix ở client). */
  message: z.string().min(1).max(2000),
});

export async function POST(req: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const userName = session.user.name ?? 'Anonymous';

  const { id: roomId } = await params;

  // 1. Verify member ACTIVE
  const [member] = await db
    .select()
    .from(roomMember)
    .where(
      and(
        eq(roomMember.roomId, roomId),
        eq(roomMember.userId, userId),
        eq(roomMember.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  if (!member) {
    return NextResponse.json({ error: 'Not a member of this room' }, { status: 403 });
  }

  // 2. Rate limit — key gồm roomId để limit theo PHIÊN HỌC, không global.
  // Dùng preset `aiGenerate` (10 req/phút) — AI tốn token, không cho spam.
  const rl = await checkLimit(`ai-tutor:${roomId}:${userId}`, 'aiGenerate');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Quá nhiều câu hỏi AI. Hãy đợi một chút.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  // 3. Parse body
  const body = await req.json().catch(() => null);
  const parsed = POST_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const userQuery = parsed.data.message;

  // 4. Load room + recent messages
  const [roomRow] = await db
    .select({ name: room.name, description: room.description, features: room.features })
    .from(room)
    .where(eq(room.id, roomId))
    .limit(1);
  if (!roomRow) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 });
  }
  // Check feature toggle aiTutor — owner có thể tắt
  const features = (roomRow.features as Record<string, boolean>) ?? {};
  if (features.aiTutor === false) {
    return NextResponse.json({ error: 'AI Tutor đã bị tắt trong phòng này' }, { status: 403 });
  }

  const recent = await db
    .select({
      userId: roomMessage.userId,
      content: roomMessage.content,
      type: roomMessage.type,
    })
    .from(roomMessage)
    .where(eq(roomMessage.roomId, roomId))
    .orderBy(desc(roomMessage.createdAt))
    .limit(20);

  // Map sang TutorChatMessage — reverse (cũ → mới), bỏ SYSTEM/FILE
  const recentMessages: TutorChatMessage[] = recent
    .reverse()
    .filter((m) => m.type === 'TEXT' || m.type === 'AI')
    .map((m) => ({
      role: m.userId === 'AI_TUTOR' ? 'assistant' : 'user',
      content: m.content,
    }));

  // 5. Insert placeholder AI message — content rỗng để stream update sau
  const [placeholder] = await db
    .insert(roomMessage)
    .values({
      roomId,
      userId: 'AI_TUTOR',
      content: '',
      type: 'AI',
      metadata: { askedByUserId: userId, askedByUserName: userName, status: 'streaming' },
    })
    .returning();
  if (!placeholder) {
    return NextResponse.json({ error: 'Failed to create AI message' }, { status: 500 });
  }
  const messageId = placeholder.id;

  // Broadcast placeholder ngay — UI render bubble "AI đang trả lời..."
  await triggerEvent(`presence-room-${roomId}`, 'chat:message', {
    id: messageId,
    userId: 'AI_TUTOR',
    userName: 'AI Tutor',
    userImage: null,
    content: '',
    type: 'AI',
    metadata: { askedByUserId: userId, askedByUserName: userName, status: 'streaming' },
    createdAt: placeholder.createdAt,
  });

  // 6. Stream + broadcast deltas
  let fullText = '';
  let aborted = false;
  let modelId = 'unknown';
  let promptTokens = 0;
  let completionTokens = 0;

  try {
    const stream = await streamRoomTutor({
      userQuery,
      askingUserId: userId,
      roomName: roomRow.name,
      roomDescription: roomRow.description,
      recentMessages,
    });

    for await (const delta of stream.textStream) {
      if (aborted) break;
      fullText += delta;
      // Fire-and-forget: nếu realtime tạm thời lỗi cho 1 chunk, không huỷ stream
      void triggerEvent(`presence-room-${roomId}`, 'ai:streaming', {
        messageId,
        delta,
      });
    }

    const finished = await stream.finishPromise;
    modelId = finished.modelId;
    promptTokens = finished.promptTokens;
    completionTokens = finished.completionTokens;
  } catch (err) {
    aborted = true;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ai-message] stream fail for room=${roomId} msg=${messageId}:`, msg);
    fullText = fullText || '[AI generation failed — vui lòng thử lại]';
    await triggerEvent(`presence-room-${roomId}`, 'ai:error', { messageId, error: msg });
  }

  // 7. Persist final + broadcast complete
  await db
    .update(roomMessage)
    .set({
      content: fullText,
      metadata: {
        askedByUserId: userId,
        askedByUserName: userName,
        status: aborted ? 'error' : 'complete',
        model: modelId,
        promptTokens,
        completionTokens,
      },
    })
    .where(eq(roomMessage.id, messageId));

  await triggerEvent(`presence-room-${roomId}`, 'ai:complete', {
    messageId,
    content: fullText,
  });

  return NextResponse.json({
    ok: true,
    messageId,
    chunksLength: fullText.length,
    aborted,
  });
}

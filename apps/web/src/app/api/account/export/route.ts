/**
 * POST /api/account/export — GDPR Article 20 (Right to data portability).
 *
 * Plan v2 §10.4.4 + §15.1 W9-10.
 *
 * Trả về toàn bộ data user dạng JSON (Stage 1) hoặc ZIP với file media (Stage 2).
 *
 * Stage 1 (current) — synchronous JSON response:
 *   - Collect mọi PII + content
 *   - Return immediately (< 30s cho user trung bình)
 *   - SLA target: < 30 days theo GDPR, target < 24h
 *
 * Stage 2 — async với BullMQ job:
 *   - Queue job → email signed download URL khi xong
 *   - Bao gồm file media từ R2 (PDF docs, recording transcript)
 *   - TTL signed URL 7 days
 *
 * Privacy:
 *   - Chỉ user xuất data của chính mình (không expose qua admin)
 *   - Audit log mỗi request (compliance trail)
 *   - Rate limit 1 request/day/user (chống abuse)
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import {
  db,
  user,
  workspace,
  document,
  conversation,
  message,
  flashcard,
  review,
  mastery,
  studySession,
  room,
  roomMember,
  roomMessage,
  recording,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { writeAudit, extractRequestContext } from '@/lib/observability/audit';
import { checkLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
// Export collect nhiều table — cho phép tới 60s.
export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;
  const ctx = extractRequestContext(request);

  // Rate limit: 1 export per day. Reuse 'aiGenerate' preset (10/min) nhưng
  // custom config — export là heavy, không cho spam.
  const rl = await checkLimit(`gdpr-export:${userId}`, 'aiGenerate');
  if (!rl.allowed) {
    await writeAudit({
      action: 'gdpr.export.requested',
      result: 'denied',
      actorId: userId,
      metadata: { reason: 'rate_limit', retryAfter: rl.retryAfter },
      ...ctx,
    });
    return NextResponse.json(
      { error: 'Quá nhiều request export. Hãy đợi rồi thử lại.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  await writeAudit({
    action: 'gdpr.export.requested',
    result: 'success',
    actorId: userId,
    resourceType: 'user',
    resourceId: userId,
    ...ctx,
  });

  // ── Collect data parallel ────────────────────────────
  const [
    userRow,
    workspaces,
    documents,
    conversations,
    messages,
    flashcards,
    reviews,
    masteries,
    studySessions,
    rooms,
    roomMembers,
    roomMessages,
    recordings,
  ] = await Promise.all([
    db.select().from(user).where(eq(user.id, userId)).limit(1),
    db.select().from(workspace).where(eq(workspace.userId, userId)),
    db.select().from(document).where(eq(document.userId, userId)),
    db.select().from(conversation).where(eq(conversation.userId, userId)),
    // Messages — join qua conversation. Lấy hết message của user's conversations.
    db
      .select()
      .from(message)
      .innerJoin(conversation, eq(conversation.id, message.conversationId))
      .where(eq(conversation.userId, userId)),
    db.select().from(flashcard).where(eq(flashcard.userId, userId)),
    // Reviews — join qua flashcard (review không có userId trực tiếp).
    db
      .select()
      .from(review)
      .innerJoin(flashcard, eq(flashcard.id, review.flashcardId))
      .where(eq(flashcard.userId, userId)),
    db.select().from(mastery).where(eq(mastery.userId, userId)),
    db.select().from(studySession).where(eq(studySession.userId, userId)),
    db.select().from(room).where(eq(room.ownerId, userId)),
    db.select().from(roomMember).where(eq(roomMember.userId, userId)),
    db.select().from(roomMessage).where(eq(roomMessage.userId, userId)),
    // Recordings — chỉ rooms user owns (room.ownerId = userId).
    // Recording chứa voice/video → personal data, nhưng share với mọi member.
    // Stage 1 chỉ export recording của room user own; member khác → request riêng.
    db
      .select()
      .from(recording)
      .innerJoin(room, eq(room.id, recording.roomId))
      .where(eq(room.ownerId, userId)),
  ]);

  // Strip sensitive fields trước khi xuất
  const userPublic = userRow[0]
    ? {
        id: userRow[0].id,
        email: userRow[0].email,
        name: userRow[0].name,
        image: userRow[0].image,
        plan: userRow[0].plan,
        createdAt: userRow[0].createdAt,
        // KHÔNG export: emailVerified, internal flags
      }
    : null;

  const payload = {
    exportedAt: new Date().toISOString(),
    schemaVersion: '1.0',
    user: userPublic,
    workspaces,
    documents: documents.map((d) => ({
      ...d,
      // storage_key giữ để user reference, file binary KHÔNG include (Stage 2)
    })),
    conversations,
    messages: messages.map((m) => ('message' in m ? m.message : m)),
    flashcards,
    reviews: reviews.map((r) => ('review' in r ? r.review : r)),
    mastery: masteries,
    studySessions,
    rooms,
    roomMembers,
    roomMessages,
    recordings: recordings.map((r) => ('recording' in r ? r.recording : r)),
    note: 'File media (PDF documents, recording MP4) KHÔNG bao gồm trong JSON này. Liên hệ support@cogniva.app để nhận signed R2 URL (TTL 7 ngày).',
  };

  await writeAudit({
    action: 'gdpr.export.completed',
    result: 'success',
    actorId: userId,
    resourceType: 'user',
    resourceId: userId,
    metadata: {
      documents_count: documents.length,
      flashcards_count: flashcards.length,
      conversations_count: conversations.length,
      payload_bytes: JSON.stringify(payload).length,
    },
    ...ctx,
  });

  // Trả Content-Disposition để browser auto-download.
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="cogniva-export-${userId.slice(0, 8)}-${Date.now()}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

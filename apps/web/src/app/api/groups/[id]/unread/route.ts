/**
 * GET /api/groups/[id]/unread — count unread message per channel cho user hiện tại.
 *
 * Logic per channel:
 *   - Lấy lastReadMessageId từ study_group_read_state
 *   - Đếm message có created_at > (lastRead.createdAt) AND author_id != currentUser
 *     (KHÔNG count message của chính user — mới gửi đã coi là đã đọc)
 *   - Nếu chưa từng đọc → count tất cả message (trừ của chính user)
 *
 * Trả: { unread: { [channelId]: number } }
 *
 * Cache: V2 sẽ thêm Redis cache 30s — V1 query trực tiếp DB.
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';

import {
  db,
  dbReplica,
  studyGroupChannel,
  studyGroupMember,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: groupId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Access-check (guard) NGOÀI cache ──────────────────────────────────────
  const [me] = await dbReplica
    .select({ id: studyGroupMember.id })
    .from(studyGroupMember)
    .where(
      and(
        eq(studyGroupMember.groupId, groupId),
        eq(studyGroupMember.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!me) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  // ── Unread badge per-user (TTL 30s — ngắn vì đổi liên tục khi có tin mới) ──
  // Key per (group, user). Bust khi user mark-read (onGroupReadChanged) ở route
  // POST /api/channels/[id]/read. dbReplica vì read thuần. Chỉ có count (số) —
  // không có field Date nên không cần re-hydrate.
  const unread = await cached(ck.groupUnread(groupId, session.user.id), 30, async () => {
    // 1 query SQL — left join read_state + count message qua sub-query.
    // Cấu trúc: với mỗi channel TEXT/ANNOUNCEMENT của group, đếm message tạo
    // sau message lastRead (nếu có), trừ message của chính user.
    const rows = await dbReplica.execute<{ channel_id: string; unread: number }>(sql`
      SELECT
        c.id AS channel_id,
        (
          SELECT count(*)::int FROM study_group_message m
          WHERE m.channel_id = c.id
            AND m.author_id <> ${session.user.id}
            AND m.deleted_at IS NULL
            AND (
              rs.last_read_message_id IS NULL
              OR m.created_at > (
                SELECT created_at FROM study_group_message
                WHERE id = rs.last_read_message_id
              )
            )
        ) AS unread
      FROM study_group_channel c
      LEFT JOIN study_group_read_state rs
        ON rs.channel_id = c.id AND rs.user_id = ${session.user.id}
      WHERE c.group_id = ${groupId}
        AND c.type <> 'VOICE'
        AND (rs.muted IS NULL OR rs.muted = false)
    `);

    const map: Record<string, number> = {};
    for (const row of rows as unknown as Array<{ channel_id: string; unread: number }>) {
      if (row.unread > 0) map[row.channel_id] = row.unread;
    }
    return map;
  });

  return NextResponse.json({ unread });
}

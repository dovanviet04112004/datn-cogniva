/**
 * Mapper row Prisma (snake_case) → wire shape route cũ (camelCase, ĐÚNG thứ tự
 * cột khai báo trong Drizzle schema — packages/db/src/schema.ts) để JSON
 * byte-identical với `.returning()`/`db.select()` của route Next.
 */
import type { room as RoomRow } from '@prisma/client';

export function toRoomDto(row: RoomRow) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    type: row.type,
    visibility: row.visibility,
    joinCode: row.join_code,
    maxMembers: row.max_members,
    requireApproval: row.require_approval,
    features: row.features,
    livekitRoomName: row.livekit_room_name,
    scheduledStart: row.scheduled_start,
    scheduledEnd: row.scheduled_end,
    recurringPattern: row.recurring_pattern,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

/**
 * Sinh join code 6 ký tự base32 Crockford — copy NGUYÊN từ
 * apps/web/src/lib/rooms/codes.ts (bỏ I/L/O/U gây nhầm; caller retry khi
 * unique violation trên join_code).
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateJoinCode(): string {
  let code = '';
  // crypto.getRandomValues — không dùng Math.random (insecure)
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[buf[i]! % ALPHABET.length];
  }
  return code;
}

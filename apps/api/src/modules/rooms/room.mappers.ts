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

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateJoinCode(): string {
  let code = '';
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[buf[i]! % ALPHABET.length];
  }
  return code;
}

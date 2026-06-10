/**
 * Tên channel realtime + helper parse/authorize — dùng CHUNG web + mobile + gateway.
 *
 * Channel = "room" trong Socket.IO. Server emit `emitter.to(channel)...`, client
 * `socket.emit('subscribe', channel)`. Quy ước prefix (giữ NGUYÊN từ thời Pusher để
 * tương thích auth + không phải sửa call-site):
 *   - `private-channel-{channelId}` : text channel của study group (member ACTIVE)
 *   - `presence-voice-{channelId}`  : voice/stage channel (member + type VOICE/STAGE)
 *   - `presence-room-{roomId}`      : study room (roomMember ACTIVE)
 *   - `presence-user-{userId}`      : noti 1-1 (chỉ chính chủ)
 *   - `presence-group-{groupId}`    : group presence/unread/status (member)
 *   - `private-dm-{threadId}`       : DM thread (thành viên thread)
 *
 * `parseChannel` + `isPresenceChannel` dùng ở Next auth route (authorize membership)
 * và gateway (join room + track presence) → 1 nguồn chân lý cho quy ước tên.
 */

/** Builder tên channel — luôn dùng thay vì nối chuỗi tay. */
export const ch = {
  privateChannel: (channelId: string) => `private-channel-${channelId}`,
  presenceVoice: (channelId: string) => `presence-voice-${channelId}`,
  presenceRoom: (roomId: string) => `presence-room-${roomId}`,
  presenceUser: (userId: string) => `presence-user-${userId}`,
  presenceGroup: (groupId: string) => `presence-group-${groupId}`,
  privateDm: (threadId: string) => `private-dm-${threadId}`,
} as const;

/** Loại channel — quyết định luật authorize ở server. */
export type ChannelKind =
  | 'private-channel'
  | 'presence-voice'
  | 'presence-room'
  | 'presence-user'
  | 'presence-group'
  | 'private-dm';

// Thứ tự không quan trọng vì không prefix nào là tiền tố của prefix khác
// (`private-channel-` vs `private-dm-`, `presence-voice-` vs `presence-group-`…).
const PREFIXES: Array<{ kind: ChannelKind; prefix: string }> = [
  { kind: 'private-channel', prefix: 'private-channel-' },
  { kind: 'private-dm', prefix: 'private-dm-' },
  { kind: 'presence-voice', prefix: 'presence-voice-' },
  { kind: 'presence-room', prefix: 'presence-room-' },
  { kind: 'presence-user', prefix: 'presence-user-' },
  { kind: 'presence-group', prefix: 'presence-group-' },
];

/** Tách `{kind, id}` từ tên channel. Trả null nếu prefix không hợp lệ. */
export function parseChannel(name: string): { kind: ChannelKind; id: string } | null {
  for (const { kind, prefix } of PREFIXES) {
    if (name.startsWith(prefix)) {
      const id = name.slice(prefix.length);
      if (!id) return null;
      return { kind, id };
    }
  }
  return null;
}

/** Channel presence (gateway track member + phát presence:state/join/leave) hay không. */
export function isPresenceChannel(name: string): boolean {
  return name.startsWith('presence-');
}

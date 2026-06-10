/**
 * Presence — thay cơ chế presence built-in của Pusher (subscription_succeeded /
 * member_added / member_removed) bằng 3 event chuẩn hoá: presence:state/join/leave.
 *
 * Lưu trữ: Redis HASH `rt:presence:{channel}` = { userId: refCount }. REF-COUNT theo
 * (channel, userId) để chịu:
 *   - multi-tab : 1 user mở nhiều tab = nhiều socket → chỉ phát `join` khi 0→1, `leave` khi 1→0.
 *   - multi-replica : hash share trên Redis nên mọi gateway thấy cùng state; broadcast qua
 *     adapter tới socket ở mọi replica.
 *
 * Lưu ý (chấp nhận được): nếu 1 replica CRASH, refCount của socket nó giữ không được trừ →
 * có thể "kẹt online". Đây là best-effort (chỉ là chấm xanh online), giống Pusher cũng mất
 * presence khi node chết. Không bù trừ phức tạp ở đây.
 */
import type { Server, Socket } from 'socket.io';

import { EV } from '@cogniva/shared/realtime';

import { redis } from './redis';

const key = (channel: string) => `rt:presence:${channel}`;

/** User vừa subscribe 1 presence channel: tăng ref, gửi snapshot, broadcast join nếu là socket đầu. */
export async function onJoin(io: Server, socket: Socket, channel: string): Promise<void> {
  const uid = socket.data.user?.id as string | undefined;
  if (!uid) return;

  const n = await redis.hincrby(key(channel), uid, 1);
  // Snapshot toàn bộ user online → chỉ gửi cho socket vừa vào.
  const all = await redis.hgetall(key(channel));
  socket.emit(EV.presenceState, { channel, userIds: Object.keys(all) });
  // Chỉ phát join ở lần kết nối ĐẦU của user này (0→1) để tránh nhân đôi với multi-tab.
  if (n === 1) io.to(channel).emit(EV.presenceJoin, { channel, userId: uid });
}

/** User rời 1 presence channel (unsubscribe hoặc disconnect): giảm ref, broadcast leave nếu hết. */
export async function onLeave(io: Server, socket: Socket, channel: string): Promise<void> {
  const uid = socket.data.user?.id as string | undefined;
  if (!uid) return;

  const n = await redis.hincrby(key(channel), uid, -1);
  if (n <= 0) {
    await redis.hdel(key(channel), uid);
    io.to(channel).emit(EV.presenceLeave, { channel, userId: uid });
  }
}

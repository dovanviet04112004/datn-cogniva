import type { Server, Socket } from 'socket.io';

import { EV } from '@cogniva/shared/realtime';

import { redis } from './redis';

const key = (channel: string) => `rt:presence:${channel}`;

export async function onJoin(io: Server, socket: Socket, channel: string): Promise<void> {
  const uid = socket.data.user?.id as string | undefined;
  if (!uid) return;

  const n = await redis.hincrby(key(channel), uid, 1);
  const all = await redis.hgetall(key(channel));
  socket.emit(EV.presenceState, { channel, userIds: Object.keys(all) });
  if (n === 1) io.to(channel).emit(EV.presenceJoin, { channel, userId: uid });
}

export async function onLeave(io: Server, socket: Socket, channel: string): Promise<void> {
  const uid = socket.data.user?.id as string | undefined;
  if (!uid) return;

  const n = await redis.hincrby(key(channel), uid, -1);
  if (n <= 0) {
    await redis.hdel(key(channel), uid);
    io.to(channel).emit(EV.presenceLeave, { channel, userId: uid });
  }
}

/**
 * @cogniva/realtime — Socket.IO gateway self-host (thay Soketi/Pusher).
 *
 * Luồng:
 *   1. CONNECT  : middleware verify session qua Next (cookie web / bearer mobile). Fail → từ chối.
 *   2. SUBSCRIBE: client `emit('subscribe', channel)` → authorize membership qua Next → join room.
 *                 Channel presence → track + phát presence:state/join/leave.
 *   3. EMIT     : apps/web KHÔNG emit trực tiếp ở đây — nó publish qua @socket.io/redis-emitter;
 *                 redis-adapter ở gateway fan-out tới socket trong room. Quy ước domain event:
 *                 `emit(event, channel, data)` (channel = arg #1) để client lọc đúng channel.
 *
 * Transport WS-only (bỏ long-polling) → không cần sticky session khi chạy nhiều replica.
 */
import { createServer } from 'node:http';

import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';

import { isPresenceChannel, parseChannel } from '@cogniva/shared/realtime';

import { authorizeChannel, verifySession, type Identity } from './auth';
import { cfg } from './config';
import { onJoin, onLeave } from './presence';
import { pubClient, subClient } from './redis';

// HTTP server: phục vụ /healthz cho health-check.sh; còn lại Socket.IO tự cầm (/socket.io).
const httpServer = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(httpServer, {
  transports: ['websocket'],
  serveClient: false,
  cors: { origin: cfg.corsOrigin.includes('*') ? true : cfg.corsOrigin, credentials: true },
  adapter: createAdapter(pubClient, subClient),
});

// 1) Verify session lúc handshake.
io.use(async (socket, next) => {
  const user = await verifySession(socket.handshake);
  if (!user) return next(new Error('unauthorized'));
  (socket.data as { user: Identity }).user = user;
  next();
});

// 2) Subscribe có authorize + join room + presence.
io.on('connection', (socket: Socket) => {
  // Channel presence đã ĐẾM cho socket này — đảm bảo onJoin/onLeave đúng 1 lần/socket/channel,
  // kể cả khi 2 'subscribe' trùng xen kẽ nhau qua await authorize (check+add đồng bộ = atomic
  // trong event loop nên không double-count ref presence).
  const presenceJoined = new Set<string>();

  socket.on('subscribe', async (channel: string, ack?: (ok: boolean) => void) => {
    if (typeof channel !== 'string' || !parseChannel(channel)) return ack?.(false);
    // Đã ở trong room rồi (component khác đã subscribe trên cùng socket) → idempotent.
    if (socket.rooms.has(channel)) return ack?.(true);

    const ok = await authorizeChannel(socket.handshake, channel);
    if (!ok) return ack?.(false);

    await socket.join(channel);
    if (isPresenceChannel(channel) && !presenceJoined.has(channel)) {
      presenceJoined.add(channel);
      await onJoin(io, socket, channel);
    }
    ack?.(true);
  });

  socket.on('unsubscribe', async (channel: string) => {
    if (typeof channel !== 'string' || !socket.rooms.has(channel)) return;
    await socket.leave(channel);
    if (presenceJoined.delete(channel)) await onLeave(io, socket, channel);
  });

  // Rời mọi presence đã đếm khi mất kết nối (đóng tab / mạng rớt). Fire-and-forget +
  // .catch để Redis lỗi không thành unhandled rejection.
  socket.on('disconnecting', () => {
    for (const channel of presenceJoined) {
      void onLeave(io, socket, channel).catch(() => {});
    }
    presenceJoined.clear();
  });
});

httpServer.listen(cfg.port, () => {
  console.log(`[realtime] Socket.IO gateway nghe cổng ${cfg.port} (WS-only)`);
});

// Graceful shutdown — đóng socket + Redis khi nhận tín hiệu dừng.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`[realtime] ${sig} — đang tắt…`);
    io.close(() => {
      pubClient.quit();
      subClient.quit();
      process.exit(0);
    });
  });
}

import { createServer } from 'node:http';

import { createAdapter } from '@socket.io/redis-adapter';
import { Server, type Socket } from 'socket.io';

import { isPresenceChannel, parseChannel } from '@cogniva/shared/realtime';

import { authorizeChannel, verifySession, type Identity } from './auth';
import { cfg } from './config';
import { onJoin, onLeave } from './presence';
import { pubClient, subClient } from './redis';

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

io.use(async (socket, next) => {
  const user = await verifySession(socket.handshake);
  if (!user) return next(new Error('unauthorized'));
  (socket.data as { user: Identity }).user = user;
  next();
});

io.on('connection', (socket: Socket) => {
  const presenceJoined = new Set<string>();

  socket.on('subscribe', async (channel: string, ack?: (ok: boolean) => void) => {
    if (typeof channel !== 'string' || !parseChannel(channel)) return ack?.(false);
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

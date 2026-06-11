# @cogniva/realtime — Socket.IO gateway

Gateway WebSocket self-host thay **Soketi/Pusher**. Deploy trên VPS sau Caddy
(`wss://realtime.cogniva.com`), scale N replica nhờ `@socket.io/redis-adapter`.

## Vai trò

- **Transport thuần**: nhận kết nối WS, authorize, join room, fan-out event.
- **KHÔNG** chứa logic DB/auth — gọi ngược Next `POST /api/realtime/auth` để verify
  session (cookie web / bearer mobile) + authorize membership (1 nguồn chân lý).
- **Presence** (online dot): ref-count theo (channel, user) trên Redis → phát
  `presence:state/join/leave` (thay presence built-in của Pusher).
- apps/web **không** kết nối gateway để emit — nó publish qua
  `@socket.io/redis-emitter`; adapter ở đây nhận và đẩy tới client trong room.

## Env

| Biến               | Bắt buộc | Ý nghĩa                                           |
| ------------------ | -------- | ------------------------------------------------- |
| `PORT`             | –        | Cổng WS (mặc định 6002)                           |
| `REDIS_URL`        | ✓        | Phải TRÙNG Redis của apps/web (emitter ↔ adapter) |
| `INTERNAL_API_URL` | ✓        | Base URL Next.js (vd `http://localhost:3000`)     |
| `CORS_ORIGIN`      | –        | Origin web (cookie). `*` = mọi origin (chỉ dev)   |

## Chạy

```bash
# Dev (cạnh `next dev`): cần Redis local (docker compose -f infrastructure/docker-compose.dev.yml up -d redis)
REDIS_URL=redis://localhost:6379 INTERNAL_API_URL=http://localhost:3000 \
  pnpm --filter @cogniva/realtime dev

# Prod: chạy qua Docker (xem infrastructure/docker-compose.prod.yml, service `realtime`)
```

## Giao thức event

- **Domain event** (web→client): `emit(event, channel, data)` — `channel` là arg #1 để
  client `useRealtimeEvent(channel, event, h)` lọc đúng channel.
- **Presence** (gateway→client): `presence:state {channel, userIds}` (riêng socket vừa vào),
  `presence:join`/`presence:leave {channel, userId}` (broadcast room).

Chi tiết migration: `docs/plans/socketio-migration.md`.

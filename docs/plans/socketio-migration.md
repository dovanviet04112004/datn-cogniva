# Migrate Realtime: Soketi/Pusher → Socket.IO (self-host VPS)

> Trạng thái: **✅ SHIPPED (2026-06-02)**. Topology = **gateway độc lập**. Phạm vi =
> **migrate 1:1 + fix 5 handler room còn thiếu + bật realtime mobile ngay** — đã làm đủ.
> Mục tiêu: gỡ sạch Soketi **và** Pusher Cloud, thay bằng Socket.IO self-host trên VPS,
> chuẩn theo kiến trúc đã chốt (Redis cache+adapter, `getServerSession`, React Query ở
> `packages/shared` RN-safe, fail-open, mobile-safe). Xem [[feedback_conform_arch_standards]].
>
> **Kết quả verify:** typecheck sạch (shared·realtime·web·mobile) + `next build` ✓ (110 trang,
> 0 error). Container + image Docker `soketi` đã xoá. Adversarial verify: 0 blocker thật
> (2 báo blocker là false-positive — presence dùng envelope 1-arg riêng, refUnsubscribe đã
> null-safe), đã vá 2 hardening (race double-count presence ở gateway = Set per-socket
> exactly-once; `.catch` cho onLeave trong `disconnecting`). Event-contract 31/32 khớp.
>
> **Known gap (pre-existing, KHÔNG do migration):** server bắn `dm:new-message` tới
> `presence-user-{peerId}` nhưng chưa có client nào nghe (badge DM toàn cục). Có từ thời
> Pusher; để lại — wire sau nếu cần badge "có DM mới" khi không ở trong thread.

---

## 0. TL;DR

- **Giữ NGUYÊN chữ ký** 2 hàm lõi `triggerEvent(channel, event, data)` (server) và
  `useRealtimeEvent(channel, event, handler)` (client) ⇒ **~60 call-site server + ~30
  component client KHÔNG phải sửa**. Chỉ viết lại phần *ruột* 2 wrapper + 2 file presence.
- **Gateway Socket.IO độc lập** (`apps/realtime`) thay đúng chỗ container `soketi` cũ
  (sau Caddy, dùng Redis adapter, scale N replica). Next emit qua **`@socket.io/redis-emitter`**.
- **Auth = một nguồn chân lý**: gateway gọi ngược Next `POST /api/realtime/auth` (forward
  cookie/bearer) để verify session + authorize membership. Gateway là **transport thuần**,
  không import `@cogniva/db`/`better-auth`.
- **Hợp đồng dùng chung** ở `packages/shared/src/realtime/` (RN-safe, chỉ zod): tên channel,
  tên event, zod payload → web + mobile + gateway dùng chung.
- **Mobile**: thêm `socket.io-client` + hook tương đương vào `apps/mobile` (sân cỏ trống,
  hiện chưa có realtime).

---

## 1. Hiện trạng (đã đọc kỹ — bề mặt phải đụng)

### 1.1. Lưu ý thực tế
`apps/web/.env.local` đang chạy **Pusher Cloud cluster `ap1`** (không phải Soketi self-host).
Code lõi hỗ trợ **2 mode song song**: Pusher Cloud (`NEXT_PUBLIC_PUSHER_CLUSTER`) **hoặc**
Soketi self-host (`NEXT_PUBLIC_SOKETI_HOST`). Migration này **bỏ cả hai**.

### 1.2. Lõi realtime
| File | Vai trò hiện tại | Số phận |
|---|---|---|
| `apps/web/src/lib/realtime-server.ts` | `getPusherServer()` · `triggerEvent()` · `authorizeChannel()` | **Viết lại ruột** — giữ `triggerEvent` |
| `apps/web/src/lib/realtime-client.ts` | `getPusherClient()` · `useRealtimeEvent()` | **Viết lại ruột** — giữ `useRealtimeEvent` |
| `apps/web/src/app/api/realtime/auth/route.ts` | Verify session + membership + ký Pusher payload | **Đổi mục đích** — trả `{ user }`, bỏ ký Pusher |
| `apps/web/src/lib/query/use-realtime-query.ts` | `useRealtimeSetData` / `useRealtimeInvalidate` (bridge → React Query) | **0 đổi** |

### 1.3. 6 channel + luật authorize (GIỮ NGUYÊN logic)
| Channel | Quyền | Nguồn |
|---|---|---|
| `private-channel-{channelId}` | member ACTIVE của group chứa channel | `studyGroupChannel` → `studyGroupMember` |
| `presence-voice-{channelId}` | như trên + `channel.type ∈ {VOICE, STAGE}` | + check type |
| `presence-room-{roomId}` | `roomMember.status = ACTIVE` | `roomMember` |
| `presence-user-{userId}` | chỉ chính chủ (`targetId === uid`) | session |
| `presence-group-{groupId}` | member của group | `studyGroupMember` |
| `private-dm-{threadId}` | thành viên thread | `dmThread` + `isThreadMember` |

### 1.4. ~32 event (giữ tên y nguyên)
`message:new` · `message:new-in-channel` · `message:edit` · `message:delete` · `message:pin` ·
`message:react` · `forum:solution` · `thread:new-reply` · `user:typing` · `dm:new-message` ·
`notification:new` · `voice:join` · `voice:leave` · `voice:state-changed` · `stage:hand` ·
`stage:promoted` · `stage:demoted` · `recording:started/stopped/deleted/ended/processed` ·
`status:change` · `chat:message` · `ai:streaming` · `ai:complete` · `ai:error` ·
`room:kicked` · `room:unmute-request` · `room:lock-changed` · `room:approved` · `room:rejected`.

### 1.5. Presence (chỗ khó nhất — nhưng bề mặt nhỏ)
Chỉ **2 file** đọc danh sách member của presence channel (Pusher built-in):
- `apps/web/src/components/groups/presence-context.tsx` — `channel.members.each` +
  `pusher:subscription_succeeded/member_added/member_removed` → tập `online` của group.
- `apps/web/src/components/groups/stage-channel.tsx` — chỉ bind `subscription_succeeded/error`
  (không đọc member list; chỉ dùng để `refresh()`).

Voice members (`voice-channel-members.tsx`) KHÔNG dùng Pusher presence — đi qua DB +
event `voice:join/leave/state-changed`. Room participants cũng qua DB/API. ⇒ Chỉ cần tái
hiện "ai đang kết nối tới `presence-group-{id}`" + (ít) `presence-voice`/`presence-room`.

### 1.6. KHÔNG đụng tới
LiveKit (media SFU, JWT riêng — `lib/livekit.ts`, `/api/rooms/[id]/token`), Hocuspocus/Yjs
(collab, JWT riêng — `/api/channels/[id]/collab-token`), Redis client (`lib/redis.ts` — tái
dùng), Better Auth session, Inngest.

### 1.7. Hạ tầng/env/deps phải dọn
- Docker: service `soketi` trong `infrastructure/docker-compose.dev.yml` (+ prod, 2 replicas).
- Caddy: block `soketi.cogniva.com` → `:6001` trong `infrastructure/caddy/Caddyfile`.
- Scripts: `health-check.sh` (container `cogniva-soketi`, `/usage`), `generate-keys.sh`
  (SOKETI secrets), `dns-records.md` (record `soketi`), `infrastructure/README.md`.
- Env: `SOKETI_APP_ID`, `SOKETI_SECRET`, `NEXT_PUBLIC_SOKETI_HOST`, `NEXT_PUBLIC_SOKETI_KEY`,
  `NEXT_PUBLIC_PUSHER_CLUSTER` ở `apps/web/src/lib/env.ts` + `.env.example` +
  `infrastructure/.env.example` + `apps/web/.env.local`.
- Deps: `pusher@^5.3.3`, `pusher-js@^8.5.0` (apps/web).

---

## 2. Thiết kế đích

```
                    ┌─────────────────────────────────────┐
  Browser/Mobile ──►│ Caddy  wss://realtime.cogniva.com    │
                    └───────────────┬─────────────────────┘
                                    ▼  (WS-only, no long-polling)
                    ┌─────────────────────────────────────┐
                    │ apps/realtime — Socket.IO gateway    │  (N replicas)
                    │  • io middleware: verify session ────┼──┐  POST /api/realtime/auth
                    │  • on('subscribe'): authorize ───────┼──┤  (forward cookie/bearer)
                    │  • socket.join(channel)              │  ▼
                    │  • presence: Redis SET + broadcast   │  Next.js (localhost:3000)
                    │  • @socket.io/redis-adapter ◄────────┼─ Redis pub/sub
                    └──────────────────────▲──────────────┘   ▲
  Next API routes ──► triggerEvent() ── @socket.io/redis-emitter ─┘
   (60 call-site, 0 đổi)   (realtime-server.ts viết lại ruột)
```

### 2.1. Vì sao gateway gọi ngược Next để auth
Giữ **một nguồn chân lý** cho session (`getServerSession` + Better Auth secondaryStorage) và
membership (đúng các query đã có). Gateway không cần DB/auth lib → nhẹ, ít coupling. Round-trip
chỉ ở **connect** (1 lần/kết nối) + **subscribe** (1 lần/channel) — đều localhost ~1ms, hiếm;
KHÔNG phải mỗi message. Tương lai muốn tối ưu: gateway đọc thẳng session Redis `ba:` + verify
HMAC (ghi chú ở §9), nhưng mặc định chọn round-trip cho robust.

### 2.2. Khử "event nhầm channel"
Pusher bind theo *object channel*; Socket.IO `socket.on('message:new')` kêu cho **mọi** room.
⇒ Quy ước **emit kèm channel**:
```
// server
emitter.to(channel).emit(event, channel, data);   // arg thứ 1 = channel
// client (trong useRealtimeEvent)
socket.on(event, (ch, data) => { if (ch === channel) handler(data); });
```
Nhờ vậy **chữ ký `useRealtimeEvent(channel, event, handler)` không đổi** → component giữ nguyên.

### 2.3. Transport & sticky session
Ép `transports: ['websocket']` (bỏ long-polling) ở cả server + client ⇒ không cần sticky
session khi chạy >1 replica (long-polling mới cần). Redis adapter lo việc fan-out giữa replica.

### 2.4. Presence protocol (thay Pusher presence)
Gateway tự quản, phát 3 event chuẩn hoá:
- `presence:state` `{ channel, userIds: string[] }` — gửi riêng cho socket vừa subscribe OK.
- `presence:join` `{ channel, userId }` — broadcast tới room khi 1 user (kết nối đầu tiên) vào.
- `presence:leave` `{ channel, userId }` — khi user rời (kết nối cuối cùng) ra.

Lưu trữ: Redis Hash/SET theo room, **đếm ref theo (channel,userId)** để chịu multi-tab (user mở
nhiều tab = nhiều socket; chỉ phát `join` ở ref 0→1, `leave` ở 1→0). Dọn khi `disconnecting`.

---

## 3. Phase 0 — Hợp đồng realtime dùng chung (`packages/shared`)

Tạo `packages/shared/src/realtime/` (RN-safe tuyệt đối — **chỉ `zod`**, KHÔNG redis/db/io):

```
realtime/
├── channels.ts   // builder + parser + detect type
├── events.ts     // hằng số tên event + union type
├── payloads.ts   // zod schema mỗi payload (type-safe web+mobile)
└── index.ts
```

**`channels.ts`** — builder + helper authorize (gateway/Next dùng chung quy ước tên):
```ts
export const ch = {
  privateChannel: (id: string) => `private-channel-${id}`,
  presenceVoice:  (id: string) => `presence-voice-${id}`,
  presenceRoom:   (id: string) => `presence-room-${id}`,
  presenceUser:   (id: string) => `presence-user-${id}`,
  presenceGroup:  (id: string) => `presence-group-${id}`,
  privateDm:      (id: string) => `private-dm-${id}`,
} as const;

/** Tách prefix→{kind,id} để authorize (dùng ở Next auth route + gateway). */
export function parseChannel(name: string): { kind: ChannelKind; id: string } | null { /* ... */ }
/** Channel presence (cần track member) hay không. */
export function isPresenceChannel(name: string): boolean { /* presence-* */ }
```

**`events.ts`** — hằng số + union (tránh stringly-typed):
```ts
export const EV = {
  messageNew: 'message:new', messageEdit: 'message:edit', /* ...đủ 32... */
  presenceState: 'presence:state', presenceJoin: 'presence:join', presenceLeave: 'presence:leave',
} as const;
export type RealtimeEvent = typeof EV[keyof typeof EV];
```

**`payloads.ts`** — zod cho payload hay dùng (typing chung web+mobile; không bắt buộc phủ 100%):
```ts
export const zTyping = z.object({ userId: z.string(), name: z.string(), image: z.string().nullish(), expiresAt: z.number() });
export const zChatMessage = z.object({ /* ... */ });
// ...
```

Export thêm trong `packages/shared/src/index.ts`: `export * as realtime from './realtime';`
(giữ shared RN-safe — đã verify chỉ zod).

---

## 4. Phase 1 — Gateway `apps/realtime`

Thêm vào `pnpm-workspace.yaml` đã cover `apps/*`. Cấu trúc:
```
apps/realtime/
├── package.json        // type: module; deps: socket.io, @socket.io/redis-adapter, ioredis
├── tsconfig.json       // extends @cogniva/tsconfig
├── Dockerfile          // node:20-alpine, build tsx→dist hoặc chạy tsx
└── src/
    ├── index.ts        // boot: http server + io + adapter + /healthz
    ├── auth.ts         // verifySession(headers) + authorizeChannel(headers, channel) → gọi Next
    ├── presence.ts     // ref-count theo (channel,userId) trên Redis + emit state/join/leave
    └── config.ts       // đọc env: PORT(6002), REDIS_URL, INTERNAL_API_URL, CORS_ORIGIN
```

**`index.ts`** (phác thảo):
```ts
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import { realtime } from '@cogniva/shared';            // ch/parseChannel/EV

const pub = new IORedis(env.REDIS_URL); const sub = pub.duplicate();
const httpServer = createServer((req, res) => {        // /healthz cho health-check.sh
  if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
  res.writeHead(404).end();
});
const io = new Server(httpServer, {
  transports: ['websocket'],
  cors: { origin: env.CORS_ORIGIN, credentials: true },
  adapter: createAdapter(pub, sub),
});

// 1) Verify session lúc handshake (forward cookie + Authorization sang Next)
io.use(async (socket, next) => {
  const user = await verifySession(socket.handshake.headers);   // gọi POST /api/realtime/auth (no channel)
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = user; next();
});

// 2) subscribe có authorize membership; join room; presence
io.on('connection', (socket) => {
  socket.on('subscribe', async (channel: string, ack?: (ok: boolean) => void) => {
    const ok = await authorizeChannel(socket.handshake.headers, channel);  // POST .../auth {channel}
    if (!ok) return ack?.(false);
    await socket.join(channel);
    if (realtime.isPresenceChannel(channel)) await presence.onJoin(io, socket, channel);
    ack?.(true);
  });
  socket.on('unsubscribe', async (channel: string) => {
    await socket.leave(channel);
    if (realtime.isPresenceChannel(channel)) await presence.onLeave(io, socket, channel);
  });
  socket.on('disconnecting', async () => {
    for (const room of socket.rooms) if (realtime.isPresenceChannel(room)) await presence.onLeave(io, socket, room);
  });
});
```

**`auth.ts`** — round-trip Next (1 endpoint, channel optional):
```ts
async function call(headers, channel?) {
  const res = await fetch(`${env.INTERNAL_API_URL}/api/realtime/auth`, {
    method: 'POST',
    headers: { cookie: headers.cookie ?? '', authorization: headers.authorization ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ channel }),
  });
  return res.ok ? (await res.json()).user : null;
}
export const verifySession   = (h) => call(h);            // không channel → chỉ whoami
export const authorizeChannel = (h, c) => call(h, c).then(Boolean);
```

**`presence.ts`** — ref-count Redis (chịu multi-tab + multi-replica):
```ts
// key: rt:presence:{channel} = Redis HASH { userId: refCount }
export async function onJoin(io, socket, channel) {
  const uid = socket.data.user.id;
  const n = await redis.hincrby(`rt:presence:${channel}`, uid, 1);
  // gửi snapshot cho chính socket
  const userIds = Object.keys(await redis.hgetall(`rt:presence:${channel}`));
  socket.emit(EV.presenceState, { channel, userIds });
  if (n === 1) io.to(channel).emit(EV.presenceJoin, { channel, userId: uid });  // chỉ phát ở 0→1
}
export async function onLeave(io, socket, channel) {
  const uid = socket.data.user.id;
  const n = await redis.hincrby(`rt:presence:${channel}`, uid, -1);
  if (n <= 0) { await redis.hdel(`rt:presence:${channel}`, uid); io.to(channel).emit(EV.presenceLeave, { channel, userId: uid }); }
}
```
> Cần thêm `hincrby/hgetall/hdel` cho ioredis — gateway dùng `ioredis` trực tiếp (không qua
> adapter `lib/redis.ts` của web). Đơn giản, không đụng web.

**`package.json`** (gateway): `socket.io`, `@socket.io/redis-adapter`, `ioredis`,
`@cogniva/shared` (workspace), dev `tsx`/`typescript`. Script `dev: tsx watch src/index.ts`,
`start: node dist/index.js`.

---

## 5. Phase 2 — Server emit (`apps/web`)

### 5.1. Viết lại ruột `realtime-server.ts` (GIỮ chữ ký `triggerEvent`)
```ts
import { Emitter } from '@socket.io/redis-emitter';
import IORedis from 'ioredis';

let _emitter: Emitter | null = null;
function getEmitter(): Emitter | null {
  if (_emitter) return _emitter;
  const url = process.env.REDIS_URL;
  if (!url) { console.warn('[realtime] REDIS_URL trống — emit no-op'); return null; }
  _emitter = new Emitter(new IORedis(url));
  return _emitter;
}

/** GIỮ NGUYÊN chữ ký + fail-open {ok,error}. Emit kèm channel (arg #1) cho client filter. */
export async function triggerEvent(channel: string, event: string, data: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const em = getEmitter(); if (!em) return { ok: false, error: 'no-emitter' };
    em.to(channel).emit(event, channel, data);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[realtime] emit fail: ${channel}/${event} — ${msg}`);
    return { ok: false, error: msg };
  }
}
// XÓA: getPusherServer, authorizeChannel, requireSoketiEnv, import 'pusher'.
```
> `@socket.io/redis-emitter` chạy ở Node runtime → các route đang `export const runtime='nodejs'`
> ok. Emitter chỉ publish vào Redis (fire-and-forget) → giữ tính fail-open. **60 call-site
> `triggerEvent(...)` KHÔNG đổi.**

### 5.2. Đổi mục đích `api/realtime/auth/route.ts`
Giữ NGUYÊN toàn bộ logic membership (isGroupMember/canAccessChannel/roomMember ACTIVE/isThreadMember),
chỉ đổi I/O: nhận JSON `{ channel? }` thay vì form Pusher; trả `{ user }` thay vì ký Pusher.
```ts
export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });   // cookie HOẶC bearer (mobile)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { channel } = await req.json().catch(() => ({}));
  const uid = session.user.id;

  if (channel) {
    // …NGUYÊN chuỗi if/else theo prefix như cũ, return 403 nếu fail…
  }
  return NextResponse.json({ user: { id: uid, name: session.user.name, image: session.user.image } });
}
```
> Không còn `authorizeChannel`/`socket_id`. `channel` rỗng = connect-verify (whoami).

---

## 6. Phase 3 — Web client (`apps/web`)

### 6.1. Viết lại ruột `realtime-client.ts` (GIỮ chữ ký `useRealtimeEvent`)
```ts
'use client';
import { io, type Socket } from 'socket.io-client';
import { useEffect } from 'react';

let _socket: Socket | null = null;
export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (_socket) return _socket;
  const url = process.env.NEXT_PUBLIC_REALTIME_URL;       // ws://localhost:6002 | wss://realtime.cogniva.com
  if (!url) { console.warn('[realtime] NEXT_PUBLIC_REALTIME_URL chưa set'); return null; }
  _socket = io(url, { transports: ['websocket'], withCredentials: true });  // cookie tự gửi (same-site)
  return _socket;
}

/** GIỮ chữ ký cũ. subscribe(channel) + lọc event theo channel (arg #1) + cleanup. */
export function useRealtimeEvent<T = unknown>(channel: string, event: string, handler: (data: T) => void) {
  useEffect(() => {
    const s = getSocket(); if (!s) return;
    s.emit('subscribe', channel);                          // gateway authorize + join room
    const onEvt = (ch: string, data: T) => { if (ch === channel) handler(data); };
    s.on(event, onEvt);
    return () => { s.off(event, onEvt); };                  // không unsubscribe room (listener khác còn dùng)
  }, [channel, event, handler]);
}

/** MỚI: presence cho component cần member list (thay Pusher presence built-in). */
export function useRealtimePresence(channel: string, cb: {
  onState: (userIds: string[]) => void; onJoin: (userId: string) => void; onLeave: (userId: string) => void;
}) { /* subscribe + bind presence:state/join/leave (lọc theo channel) */ }
```

### 6.2. `use-realtime-query.ts` — **0 đổi** (chỉ phụ thuộc `useRealtimeEvent`).

### 6.3. Sửa 2 file presence
- `presence-context.tsx`: thay `pusher.subscribe(...).members.each` +
  `pusher:subscription_succeeded/member_added/member_removed` → `useRealtimePresence(presence-group-{id}, {onState→setOnline, onJoin→add, onLeave→delete})`. Event `status:change` vẫn qua `useRealtimeEvent`.
- `stage-channel.tsx`: bỏ `pusher:subscription_*`; subscribe + `useRealtimeEvent(stage:*)` như cũ
  (chỉ gọi `refresh()`), không cần member list.

### 6.4. ~30 component còn lại — **0 đổi** (đều xài `useRealtimeEvent`/`useRealtimeSetData`/`useRealtimeInvalidate`).

---

## 7. Phase 3b — Fix 5 handler room còn thiếu (audit phát hiện)

Server đã bắn nhưng client chưa nghe (gap có sẵn, nay làm cho đủ). Wire ở
`apps/web/src/components/rooms/room-client.tsx` (subscribe `presence-user-{me}` +
`presence-room-{roomId}`):
| Event | Channel | Hành vi client |
|---|---|---|
| `room:kicked` | `presence-user-{me}` | toast + `router.push('/rooms')` (đá ra) |
| `room:approved` | `presence-user-{me}` | cập nhật waiting-room → vào phòng |
| `room:rejected` | `presence-user-{me}` | toast + rời waiting-room |
| `room:unmute-request` | `presence-user-{me}` | toast "MC mời bật mic" |
| `room:lock-changed` | `presence-room-{roomId}` | cập nhật badge khoá phòng |
> Dùng `useConfirm/toast` (KHÔNG dialog native — [[feedback_no_native_dialogs]]).

---

## 8. Phase 3c — Mobile realtime (`apps/mobile`)

Hiện chưa có realtime (chỉ Expo push). Thêm:
```
apps/mobile/src/lib/realtime.ts   // getSocket() dùng socket.io-client (RN tự dùng native WS)
                                  // useRealtimeEvent() chữ ký GIỐNG web, import EV/ch từ @cogniva/shared
```
- Auth handshake bằng **bearer token** (Better Auth bearer plugin) thay cookie:
  `io(url, { transports:['websocket'], auth: { token } })` và gateway forward
  `Authorization: Bearer …` sang Next.
- Dùng `realtime` constants/zod từ `@cogniva/shared` → type-safe, không lệch tên với web.
- Phạm vi đợt này: dựng client + 1-2 màn dùng thử (vd notification badge). Mở rộng các màn
  còn lại theo [[project_react_query_migration]] waves.

---

## 9. Phase 4 — Infra

- `docker-compose.dev.yml`: **xoá service `soketi`**, thêm `realtime` (build `apps/realtime`,
  `REDIS_URL=redis://redis:6379`, `INTERNAL_API_URL=http://host.docker.internal:3000`,
  port `6002:6002`, `depends_on: redis`). Dev nhanh hơn: chạy gateway bằng
  `pnpm --filter @cogniva/realtime dev` (tsx watch) cạnh `next dev`.
- `docker-compose.prod.yml`: **xoá `soketi` (2 replicas)**, thêm `realtime` (replicas: 2,
  bind `127.0.0.1:6002`, `depends_on: redis`, `INTERNAL_API_URL=http://127.0.0.1:3000`).
  `caddy depends_on: [realtime]`.
- `caddy/Caddyfile`: đổi block `soketi.cogniva.com → :6001` thành
  `realtime.cogniva.com → :6002` (giữ `flush_interval -1`, `keepalive 5m`; WS-only nên không
  cần sticky, nhưng nếu >1 replica thêm `lb_policy cookie` cho an toàn handshake).
- `scripts/health-check.sh`: `cogniva-soketi`→`cogniva-realtime`, `:6001/usage`→`:6002/healthz`.
- `scripts/generate-keys.sh`: **bỏ** sinh `SOKETI_*` (Socket.IO không có app secret; auth qua
  Better Auth session).
- `scripts/dns-records.md`: record `soketi`→`realtime`.
- `infrastructure/README.md` + `provision-server.sh` (comment role app): Soketi→Socket.IO.

> Ghi chú tối ưu tương lai (KHÔNG làm bây giờ): gateway có thể bỏ round-trip auth bằng cách
> verify chữ ký cookie Better Auth (`BETTER_AUTH_SECRET`) + đọc session Redis `ba:` trực tiếp.
> Đổi lại coupling vào internal format của Better Auth → để sau nếu cần giảm latency.

---

## 10. Phase 5 — Env

**Gỡ** (mọi nơi): `SOKETI_APP_ID`, `SOKETI_SECRET`, `NEXT_PUBLIC_SOKETI_HOST`,
`NEXT_PUBLIC_SOKETI_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER`.
- `apps/web/src/lib/env.ts`: xoá khỏi `serverSchema`/`clientSchema`/`processEnv`; **thêm**
  `NEXT_PUBLIC_REALTIME_URL: z.string().optional()`.
- `.env.example`, `infrastructure/.env.example`, `apps/web/.env.local`: xoá block Soketi/Pusher;
  thêm `NEXT_PUBLIC_REALTIME_URL` (dev `ws://localhost:6002`), và (server emit) đảm bảo `REDIS_URL`
  có mặt. Gateway env: `PORT=6002`, `REDIS_URL`, `INTERNAL_API_URL`, `CORS_ORIGIN`.

---

## 11. Phase 6 — Deps

- `apps/web`: **gỡ** `pusher`, `pusher-js`; **thêm** `socket.io-client`,
  `@socket.io/redis-emitter` (ioredis đã có).
- `apps/realtime`: `socket.io`, `@socket.io/redis-adapter`, `ioredis`, `@cogniva/shared`.
- `apps/mobile`: **thêm** `socket.io-client`.
> Khoá version `socket.io` / `@socket.io/redis-adapter` / `@socket.io/redis-emitter` cùng
> dòng major (giao thức adapter↔emitter phải khớp).

---

## 12. Phase 7 — Docs sync (đúng chuẩn [[feedback_plan_in_sync]])

Cập nhật "Pusher/Soketi → Socket.IO self-host (apps/realtime)": `docs/plans/master.md`
(§3.2 tech stack + Phase 12 checklist), `rooms-and-exam.md`, `study-group.md`,
`study-group-v2.md`, `tutoring.md`, `tutoring-v4.md`, `scale-up.md` (T2), `operations/slo.md`
(SLO-8 đo qua gateway), `infrastructure/README.md`. File này = nguồn plan.

---

## 13. Phase 8 — Verify

1. `pnpm --filter @cogniva/shared build` + `typecheck` toàn repo.
2. `pnpm --filter @cogniva/web build` (eslint.ignoreDuringBuilds đã bật).
3. Dev: docker redis up → `pnpm --filter @cogniva/realtime dev` + `next dev`. Test tay:
   - 2 tab group chat: gửi message → tab kia nhận `message:new` (filter đúng channel).
   - presence-group: mở/đóng tab → dot online đổi; multi-tab không nhân đôi leave.
   - voice join/leave/state; stage hand/promote; recording start/stop.
   - DM `message:new`; notification bell `notification:new`.
   - room moderation: kick → bị đá ra; approve/reject/lock/unmute.
   - Redis down → emit fail-open (route vẫn trả 200, log cảnh báo), reconnect lại OK.
4. Mobile: kết nối bằng bearer token → nhận `notification:new`.

---

## 14. Rollback / an toàn

- Migration theo phase, mỗi phase 1 commit; có thể dừng sau P0 (shared) hoặc P2/P3 (lõi) mà
  vẫn build được. **KHÔNG amend, chỉ commit/push khi user yêu cầu.**
- Vì giữ chữ ký `triggerEvent`/`useRealtimeEvent`, nếu cần quay lại chỉ đổi ruột 2 wrapper.
- Fail-open: gateway/Redis chết → web vẫn chạy (emit no-op, UI mất realtime tạm thời, refetch
  React Query vẫn hoạt động).

---

## 15. Checklist file đụng tới (tóm tắt)

**Tạo:** `packages/shared/src/realtime/{channels,events,payloads,index}.ts`;
`apps/realtime/**`; `apps/mobile/src/lib/realtime.ts`; `docs/plans/socketio-migration.md` (file này).
**Viết lại ruột:** `apps/web/src/lib/realtime-server.ts`, `realtime-client.ts`,
`app/api/realtime/auth/route.ts`.
**Sửa nhỏ:** `presence-context.tsx`, `stage-channel.tsx`, `rooms/room-client.tsx`,
`apps/web/src/lib/env.ts`, `packages/shared/src/index.ts`, 3× `.env*`, `apps/web/package.json`,
`apps/mobile/package.json`, `pnpm-workspace.yaml` (nếu cần), `infrastructure/{docker-compose.dev,docker-compose.prod}.yml`,
`caddy/Caddyfile`, `scripts/{health-check,generate-keys}.sh`, `scripts/dns-records.md`,
`infrastructure/README.md`, + docs §12.
**0 đổi (nhờ giữ chữ ký):** ~60 call-site `triggerEvent`, ~28 component dùng
`useRealtimeEvent/useRealtimeSetData/useRealtimeInvalidate`, `use-realtime-query.ts`.
**KHÔNG đụng:** LiveKit, Hocuspocus, `lib/redis.ts`, Better Auth.

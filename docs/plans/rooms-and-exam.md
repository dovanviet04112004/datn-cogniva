# 🎥 Plan chi tiết: Study Rooms + Exam System (Phase 12-19)

> **Triết lý:** Tự host hoàn toàn, không phụ thuộc SaaS bên ngoài. Production-grade từ ngày đầu. Stack: Next.js 15 + Drizzle + Mastra + LiveKit OSS self-hosted + Socket.IO self-host (gateway `apps/realtime`) + Yjs/Hocuspocus.
>
> **Vị trí:** Đây là V2 của Cogniva, nối tiếp `master.md` (Phase 0-11). Sau khi Launch (Phase 11) xong, bắt đầu Phase 12. Tổng effort: 8 tuần full-time hoặc 16 tuần part-time.

---

## 📑 Mục lục

- [0. Tổng quan & Quyết định kiến trúc](#0-tổng-quan--quyết-định-kiến-trúc)
- [Phase 12: Infrastructure Foundation](#phase-12-infrastructure-foundation-tuần-1)
- [Phase 13: Study Room Core](#phase-13-study-room-core-tuần-2)
- [Phase 14: Room Collaboration](#phase-14-room-collaboration-tuần-3)
- [Phase 15: AI Tutor + Recording](#phase-15-ai-tutor--recording-tuần-4)
- [Phase 16: Exam System Core](#phase-16-exam-system-core-tuần-5)
- [Phase 17: Live Exam (Kahoot-style)](#phase-17-live-exam-kahoot-style-tuần-6)
- [Phase 18: Adaptive Testing + AI Grading](#phase-18-adaptive-testing--ai-grading-tuần-7)
- [Phase 19: Anti-cheat + Production Polish](#phase-19-anti-cheat--production-polish-tuần-8)
- [Tóm tắt Cost / Scale / V2 Bonus](#tóm-tắt-cost--scale--v2-bonus)

---

## 0. Tổng quan & Quyết định kiến trúc

### 0.1. Tự build vs SaaS — quyết định cuối

**Quyết định:** Tự host **LiveKit Open Source** + tự build toàn bộ application layer.

**Lý do KHÔNG viết SFU from scratch:**

- mediasoup/Pion from scratch = 6+ tháng = không justify được effort.
- LiveKit OSS = production-grade SFU (Go, Apache 2.0). Spotify/ClickUp đã dùng.
- Self-host LiveKit = vẫn "tự host" về data/business logic.
- Recruiter nhìn vào = quyết định kỹ thuật khôn ngoan, không reinvent the wheel.

**Cái mình SẼ tự build 100%:**

- Application layer (Next.js, business logic).
- Signaling logic (room creation, permissions, JWT tokens).
- Real-time chat (WebSocket via Socket.IO self-hosted, gateway `apps/realtime`).
- Collaborative whiteboard (Yjs + Hocuspocus self-hosted).
- AI tutor integration trong room (Mastra agent).
- Toàn bộ exam system (builder, grading, adaptive, live).
- Anti-cheat (10+ detection methods).
- Recording post-processing pipeline.
- Analytics & dashboards.

**Cái mình deploy nhưng không viết:**

- LiveKit Server (Docker binary).
- TURN server (coturn).
- Socket.IO gateway `apps/realtime` (self-host, dùng `@socket.io/redis-adapter`).
- Hocuspocus (Yjs server).

### 0.2. Architecture overview

```
┌────────────────────────────────────────────────┐
│              User Browser / PWA                 │
│  Next.js client + LiveKit JS SDK + Yjs client  │
└────────────────────┬───────────────────────────┘
                     │
       ┌─────────────┼─────────────┬──────────────┐
       │             │             │              │
       ▼             ▼             ▼              ▼
┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐
│  LiveKit   │ │ Socket.IO  │ │Hocuspocus│ │  Next.js   │
│  Server    │ │ (WS pubsub)│ │ (Yjs WS) │ │  Backend   │
│  (Go)      │ │ (Node)     │ │ (Node)   │ │            │
└──────┬─────┘ └─────┬──────┘ └────┬─────┘ └─────┬──────┘
       │             │             │              │
       ▼             ▼             ▼              ▼
┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐
│   coturn   │ │   Redis    │ │PostgreSQL│ │PostgreSQL  │
│ TURN/STUN  │ │ (presence) │ │ (Yjs)    │ │ (app data) │
└────────────┘ └────────────┘ └──────────┘ └────────────┘
```

| Service    | Lý do tách            | Scale pattern             |
| ---------- | --------------------- | ------------------------- |
| LiveKit    | CPU-bound, UDP-heavy  | Vertical, geo-distributed |
| Socket.IO  | I/O-bound, nhiều conn | Horizontal, Redis adapter |
| Hocuspocus | I/O-bound, document   | Horizontal, doc affinity  |
| Next.js    | Request-response      | Horizontal, stateless     |

Monolith sẽ fail ở scale — tách từ đầu tiết kiệm refactor sau.

### 0.3. Quy ước trong tài liệu này

- Mỗi Phase có 5 mục cố định: **Mục tiêu**, **Schema delta**, **Infra/Code chính**, **Deliverable**, **Acceptance criteria**.
- Code block là code copy-paste-được, đã wire đúng path. Comment tiếng Việt theo convention Cogniva.
- Phase nào có threat/security đặc thù sẽ kèm sub-section **🔐 Security notes** trong phase đó (không tách riêng).
- Testing strategy gộp vào Phase 19 (polish).

---

## Phase 12: Infrastructure Foundation (Tuần 1)

> **Mục tiêu cuối Phase 12:** Có 1 URL `wss://livekit.cogniva.com` connect được, 2 browser tab join cùng room thấy nhau qua LiveKit OSS self-hosted.

> ⚠️ **Cập nhật realtime (sau migration):** Lớp realtime app-events (chat/presence/voice/notification/room moderation) nay chạy qua **Socket.IO self-host** — gateway riêng `apps/realtime` (Node + `@socket.io/redis-adapter`), web emit qua `@socket.io/redis-emitter`, auth qua `POST /api/realtime/auth`. Các code block Pusher/Soketi bên dưới giữ làm **lịch sử build Phase 12-16**; cơ chế/triển khai thực tế hiện tại xem `docs/plans/socketio-migration.md`. Tên channel (`presence-user-{id}`…), event và hàm `triggerEvent()` GIỮ NGUYÊN.

### 12.1. Mục tiêu chi tiết

- Provision Hetzner CCX23 (4 vCPU, 16GB) × 2 servers: 1 cho media (LiveKit + coturn), 1 cho app (sẽ dùng Phase 13+).
- Deploy 4 service self-hosted bằng Docker Compose: LiveKit, coturn, Socket.IO gateway (`apps/realtime`), Hocuspocus.
- Domain DNS + SSL (Let's Encrypt) cho `livekit.`, `turn.`, `realtime.`, `hocus.` subdomain.
- Reverse proxy (Caddy) trước Socket.IO gateway/Hocuspocus (LiveKit + coturn dùng host network nên không qua proxy).
- Smoke test: dùng LiveKit Meet demo → 2-3 tab thấy nhau, audio/video OK.

### 12.2. Infra files

**`infrastructure/livekit/docker-compose.yml`**

```yaml
# LiveKit OSS Server — SFU chính
services:
  livekit:
    image: livekit/livekit-server:latest
    command: --config /etc/livekit.yaml
    ports:
      - '7880:7880' # WebSocket signaling
      - '7881:7881' # WebRTC over TCP (fallback)
      - '50000-60000:50000-60000/udp' # WebRTC media
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml
    restart: unless-stopped
    network_mode: host # quan trọng cho UDP, đừng bridge

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data

volumes:
  redis-data:
```

**`infrastructure/livekit/livekit.yaml`**

```yaml
# Config production cho LiveKit — chú ý use_external_ip
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true # Cần thiết khi sau NAT

redis:
  address: localhost:6379

keys:
  ${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}

# Webhook gửi event về Next.js — sẽ wire ở Phase 13
webhook:
  api_key: ${LIVEKIT_API_KEY}
  urls:
    - https://app.cogniva.com/api/webhooks/livekit

# Egress (recording) — wire Phase 15
egress:
  ws_url: ws://localhost:7880
  redis:
    address: localhost:6379
  storage:
    s3:
      access_key: ${R2_ACCESS_KEY}
      secret: ${R2_SECRET}
      region: auto
      bucket: cogniva-recordings
      endpoint: https://${R2_ACCOUNT}.r2.cloudflarestorage.com
```

**`infrastructure/coturn/docker-compose.yml`**

```yaml
# TURN server — cần cho ~10-15% user behind symmetric NAT / corp firewall
services:
  coturn:
    image: coturn/coturn:latest
    network_mode: host
    volumes:
      - ./turnserver.conf:/etc/turnserver.conf
      - /etc/letsencrypt:/etc/letsencrypt:ro
    restart: unless-stopped
```

**`infrastructure/coturn/turnserver.conf`**

```conf
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0
relay-ip=${PUBLIC_IP}
external-ip=${PUBLIC_IP}
min-port=49152
max-port=65535

# Auth dynamic — LiveKit sẽ ký credentials qua REST API
lt-cred-mech
realm=cogniva.com
use-auth-secret
static-auth-secret=${TURN_SECRET}

# TLS (Let's Encrypt cert mount ở trên)
cert=/etc/letsencrypt/live/turn.cogniva.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.cogniva.com/privkey.pem

log-file=/var/log/coturn.log
verbose
```

**`infrastructure/docker-compose.*.yml` — service `realtime`** (thay container `soketi` cũ)

```yaml
# Socket.IO gateway cho chat/realtime app events (apps/realtime)
services:
  realtime:
    build: ../apps/realtime
    ports:
      - '6002:6002'
    environment:
      REDIS_URL: ${REDIS_URL} # @socket.io/redis-adapter pub/sub
      PORT: 6002
    depends_on: [redis]
    restart: unless-stopped
```

**`infrastructure/hocuspocus/docker-compose.yml`**

```yaml
# Yjs server tự host — phục vụ whiteboard/notes/code editor collab
services:
  hocuspocus:
    build: .
    ports:
      - '1234:1234'
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
    restart: unless-stopped
```

**`infrastructure/hocuspocus/server.ts`** (build image này từ source)

```typescript
/**
 * Hocuspocus server — Yjs WebSocket gateway.
 * Auth: JWT do Next.js issue (Phase 13).
 * Persistence: Postgres bảng collab_docs (binary state base64).
 * Pub/Sub: Redis cho multi-instance fan-out.
 */
import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';
import { Redis } from '@hocuspocus/extension-redis';
import jwt from 'jsonwebtoken';
import { db } from './db';

const server = Server.configure({
  port: 1234,

  // Mỗi connection phải có JWT hợp lệ + có quyền vào doc đó
  async onAuthenticate({ token, documentName }) {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as any;
    const [type, id] = documentName.split(':');
    if (type === 'room') {
      const member = await db.checkRoomMembership(id, payload.userId);
      if (!member) throw new Error('Forbidden');
    }
    return { user: payload };
  },

  extensions: [
    new Database({
      fetch: async ({ documentName }) => {
        const doc = await db.getCollabDoc(documentName);
        return doc?.state ?? null;
      },
      store: async ({ documentName, state }) => {
        await db.upsertCollabDoc(documentName, state);
      },
    }),
    new Redis({ host: 'redis', port: 6379 }),
  ],
});

server.listen();
```

### 12.3. Reverse proxy (Caddy)

**`infrastructure/caddy/Caddyfile`**

```
# Socket.IO gateway và Hocuspocus có WS gateway cần TLS termination
realtime.cogniva.com {
    reverse_proxy localhost:6002
}

hocus.cogniva.com {
    reverse_proxy localhost:1234
}

# LiveKit signaling đã có TLS internal — chỉ cần DNS, không qua Caddy
# coturn cũng dùng port 5349 trực tiếp với cert Let's Encrypt
```

### 12.4. Env vars chuẩn hoá

Thêm vào `apps/web/.env.local` + `.env.example`:

```bash
# LiveKit
NEXT_PUBLIC_LIVEKIT_URL=wss://livekit.cogniva.com
LIVEKIT_API_KEY=APIxxxxxxxxx
LIVEKIT_API_SECRET=secret_xxxxxxxxx

# Socket.IO gateway (apps/realtime)
NEXT_PUBLIC_REALTIME_URL=wss://realtime.cogniva.com
REDIS_URL=redis://localhost:6379

# Hocuspocus
NEXT_PUBLIC_HOCUSPOCUS_URL=wss://hocus.cogniva.com

# TURN
TURN_SECRET=long-random-string

# R2 cho recordings (Phase 15)
R2_ACCESS_KEY=...
R2_SECRET=...
R2_ACCOUNT=...
```

### 12.5. Deliverable

- [ ] 2 Hetzner server up, Docker Compose healthy.
- [ ] DNS resolve `livekit.cogniva.com`, `turn.cogniva.com`, `realtime.cogniva.com`, `hocus.cogniva.com`.
- [ ] Let's Encrypt cert valid (kiểm tra qua `curl -v https://realtime.cogniva.com`).
- [ ] LiveKit Meet demo (`https://meet.livekit.io`) connect được tới server tự host → 2 tab thấy nhau.
- [ ] Coturn check qua [Trickle ICE test](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/) — relay candidate xuất hiện.

### 12.6. Acceptance criteria

- [ ] `docker compose ps` toàn bộ `healthy` trên 2 server.
- [ ] LiveKit log không có error trong 5 phút smoke test.
- [ ] Trickle ICE trả về cả `host` + `srflx` + `relay` candidates.
- [ ] Socket.IO gateway healthcheck `:6002/healthz` trả OK.
- [ ] Hocuspocus accept 1 test connection với JWT giả lập.

### 🔐 Security notes Phase 12

- LiveKit API key/secret để Vault hoặc env file `chmod 600`, không commit.
- coturn `static-auth-secret` rotate quarterly.
- Caddy auto-renew Let's Encrypt — alert nếu fail.
- Firewall (UFW) chỉ mở: 80/443 (app), 7880/7881 (LK signaling), 50000-60000/udp (LK media), 3478/5349 (TURN), 6002 (Socket.IO gateway qua Caddy → đóng port direct).

### 12.7. Provisioning automation

Day 1-2 phải làm thủ công nhưng có script để tái dùng / disaster recovery.

**`infrastructure/scripts/provision-server.sh`** — chạy 1 lần per server

```bash
#!/usr/bin/env bash
# Provision Hetzner Ubuntu 22.04 server cho Cogniva V2.
# Idempotent — chạy lại an toàn. Chạy với sudo.
set -euo pipefail

# ── Args ──────────────────────────────────────────
ROLE="${1:-media}"          # media | app
HOSTNAME="${2:-cogniva-1}"
PUBLIC_IP="$(curl -fsSL https://api.ipify.org)"

echo "[1/8] Update + base packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  curl ca-certificates gnupg lsb-release ufw fail2ban unattended-upgrades \
  jq htop net-tools

echo "[2/8] Hostname + timezone"
hostnamectl set-hostname "$HOSTNAME"
timedatectl set-timezone UTC

echo "[3/8] Docker CE + Compose plugin"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

echo "[4/8] UFW firewall (deny incoming, allow specific)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    comment 'ssh'
ufw allow 80/tcp    comment 'http (Caddy ACME)'
ufw allow 443/tcp   comment 'https'
if [[ "$ROLE" == "media" ]]; then
  ufw allow 7880/tcp                comment 'livekit signaling'
  ufw allow 7881/tcp                comment 'livekit tcp media'
  ufw allow 50000:60000/udp         comment 'livekit udp media'
  ufw allow 3478/tcp                comment 'coturn'
  ufw allow 3478/udp                comment 'coturn'
  ufw allow 5349/tcp                comment 'coturn tls'
  ufw allow 5349/udp                comment 'coturn dtls'
  ufw allow 49152:65535/udp         comment 'coturn relay range'
fi
if [[ "$ROLE" == "app" ]]; then
  # Socket.IO gateway + Hocuspocus đi qua Caddy 443 → không expose direct port
  echo "app role — chỉ 80/443"
fi
ufw --force enable

echo "[5/8] fail2ban (SSH brute force protection)"
systemctl enable --now fail2ban

echo "[6/8] Caddy (reverse proxy với Let's Encrypt auto)"
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

echo "[7/8] Unattended security upgrades"
echo 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";' > /etc/apt/apt.conf.d/20auto-upgrades

echo "[8/8] Done — public IP: $PUBLIC_IP"
echo "Tiếp theo: clone infrastructure/ repo, set .env, docker compose up -d"
```

**`infrastructure/scripts/dns-records.md`** — Cloudflare DNS bảng

| Type | Name     | Content    | Proxy | TTL  | Note                           |
| ---- | -------- | ---------- | ----- | ---- | ------------------------------ |
| A    | app      | <APP_IP>   | ✓     | Auto | Next.js qua Cloudflare CDN     |
| A    | livekit  | <MEDIA_IP> | ✗     | Auto | WS signaling — KHÔNG proxy     |
| A    | turn     | <MEDIA_IP> | ✗     | Auto | TURN qua TCP/UDP — KHÔNG proxy |
| A    | realtime | <APP_IP>   | ✓     | Auto | WS qua Caddy → Cloudflare OK   |
| A    | hocus    | <APP_IP>   | ✓     | Auto | WS qua Caddy → Cloudflare OK   |
| AAAA | (same)   | <IPv6>     | match | Auto | Dual-stack                     |

**Quan trọng:** LiveKit + coturn KHÔNG được proxy qua Cloudflare (Cloudflare không hỗ trợ WebRTC UDP relay). Socket.IO gateway/Hocuspocus có thể proxy vì là pure WS over 443.

**`infrastructure/scripts/health-check.sh`** — chạy cron mỗi 5 phút

```bash
#!/usr/bin/env bash
# Smoke test toàn bộ stack, alert qua webhook nếu fail.
WEBHOOK="${ALERT_WEBHOOK:-https://hooks.slack.com/...}"
fail() {
  curl -fsS -X POST -H 'Content-Type: application/json' \
    -d "{\"text\":\"🚨 Cogniva health fail: $1\"}" "$WEBHOOK"
  exit 1
}

curl -fsS https://livekit.cogniva.com/rtc/validate >/dev/null || fail 'LiveKit signaling down'
curl -fsS https://realtime.cogniva.com/healthz >/dev/null || fail 'Socket.IO gateway down'
curl -fsS https://hocus.cogniva.com/ >/dev/null || fail 'Hocuspocus down'
nc -zv turn.cogniva.com 3478 2>&1 | grep -q succeeded || fail 'coturn 3478 unreachable'
docker ps --filter 'status=running' --format '{{.Names}}' | grep -q livekit || fail 'livekit container not running'
echo "OK $(date -Iseconds)"
```

Crontab:

```
*/5 * * * * /opt/cogniva/health-check.sh >> /var/log/cogniva-health.log 2>&1
```

---

## Phase 13: Study Room Core (Tuần 2)

> **Mục tiêu cuối Phase 13:** User tạo room qua UI, share invite link, 2-4 user join video call thấy/nghe nhau qua infrastructure đã build Phase 12.

### 13.1. Mục tiêu chi tiết

- Thêm Drizzle schema cho `rooms`, `room_members`, `room_messages`, `room_events`, `recordings`, `collab_docs`.
- API token generation `POST /api/rooms/token` (LiveKit JWT, TTL 2h, permissions theo role).
- API webhook receiver `POST /api/webhooks/livekit` (sync event `room_started/finished/participant_joined…` về DB).
- Pre-join lobby (`/rooms/[id]/lobby`) — test mic/cam, chọn device.
- Main room (`/rooms/[id]`) — video grid + control bar tự build.

### 13.2. Schema delta

**`packages/db/src/schema.ts`** (append vào schema hiện có)

```typescript
/**
 * Phase 13: Study Rooms schema.
 * - rooms: metadata + feature toggles.
 * - room_members: ai trong phòng + role + status.
 * - room_messages: chat history.
 * - room_events: audit trail (joined/left/screen_share…).
 * - recordings: link tới egress output + transcript.
 * - collab_docs: Yjs binary state cho whiteboard/notes.
 */
export const rooms = pgTable('rooms', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull(), // STUDY | CLASSROOM | EXAM | OFFICE_HOURS
  visibility: text('visibility').notNull().default('PRIVATE'), // PRIVATE | UNLISTED | PUBLIC
  joinCode: text('join_code').unique(), // 6-digit ngẫu nhiên cho link-only
  maxMembers: integer('max_members').default(10),
  requireApproval: boolean('require_approval').default(false),
  features: jsonb('features').notNull().default({
    video: true,
    chat: true,
    whiteboard: true,
    notes: true,
    aiTutor: true,
    pomodoro: true,
    recording: false,
  }),
  livekitRoomName: text('livekit_room_name'), // = id, redundant nhưng dễ debug
  yjsDocId: text('yjs_doc_id'),
  scheduledStart: timestamp('scheduled_start'),
  scheduledEnd: timestamp('scheduled_end'),
  recurringPattern: jsonb('recurring_pattern'), // {freq, days, until}
  status: text('status').default('IDLE'), // IDLE | ACTIVE | ENDED
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const roomMembers = pgTable('room_members', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  roomId: text('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  role: text('role').notNull().default('MEMBER'), // OWNER | MODERATOR | MEMBER
  status: text('status').notNull().default('ACTIVE'), // ACTIVE | KICKED | BANNED | PENDING
  joinedAt: timestamp('joined_at').defaultNow(),
  lastSeenAt: timestamp('last_seen_at'),
});

export const roomMessages = pgTable('room_messages', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  roomId: text('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), // có thể là 'AI_TUTOR'
  content: text('content').notNull(),
  type: text('type').notNull().default('TEXT'), // TEXT | FILE | SYSTEM | AI | POLL
  metadata: jsonb('metadata'),
  replyToId: text('reply_to_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const roomEvents = pgTable('room_events', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  roomId: text('room_id')
    .notNull()
    .references(() => rooms.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  type: text('type').notNull(), // JOINED | LEFT | KICKED | SCREEN_SHARE_STARTED…
  metadata: jsonb('metadata'),
  timestamp: timestamp('timestamp').defaultNow().notNull(),
});

export const recordings = pgTable('recordings', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  roomId: text('room_id')
    .notNull()
    .references(() => rooms.id),
  egressId: text('egress_id').unique(),
  fileUrl: text('file_url'),
  duration: integer('duration_seconds'),
  fileSize: integer('file_size_bytes'),
  status: text('status').notNull().default('RECORDING'),
  transcript: text('transcript'),
  summary: text('summary'),
  chapters: jsonb('chapters'),
  highlights: jsonb('highlights'),
  startedAt: timestamp('started_at').defaultNow(),
  endedAt: timestamp('ended_at'),
});

export const collabDocs = pgTable('collab_docs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // WHITEBOARD | NOTES | CODE
  state: text('state').notNull(), // base64 Yjs binary
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const roomsRelations = relations(rooms, ({ one, many }) => ({
  owner: one(user, { fields: [rooms.ownerId], references: [user.id] }),
  members: many(roomMembers),
  messages: many(roomMessages),
  recordings: many(recordings),
}));
```

Tạo migration: `pnpm drizzle-kit generate` → tên `0014_rooms.sql`.

### 13.3. Token endpoint

**`apps/web/src/app/api/rooms/token/route.ts`**

```typescript
/**
 * POST /api/rooms/token — issue LiveKit JWT cho session join room.
 * - Verify user + member + room not full.
 * - Permissions phân theo role (OWNER/MODERATOR có roomAdmin + roomRecord).
 * - TTL 2h (đủ cho 1 buổi học, force refresh nếu lâu hơn).
 */
import { AccessToken } from 'livekit-server-sdk';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { rooms, roomMembers } from '@cogniva/db/schema';
import { and, eq } from 'drizzle-orm';

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });

  const { roomId, name } = await req.json();

  // 1. Tồn tại + có quyền
  const room = await db.query.rooms.findFirst({
    where: eq(rooms.id, roomId),
    with: { members: true },
  });
  if (!room) return Response.json({ error: 'Not found' }, { status: 404 });

  const member = room.members.find((m) => m.userId === session.user.id);
  if (!member && room.visibility === 'PRIVATE') {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. Capacity check (đếm member ACTIVE qua LiveKit room API hoặc presence Redis)
  const activeCount = await getActiveMemberCount(roomId);
  if (activeCount >= (room.maxMembers ?? 10)) {
    return Response.json({ error: 'Room full' }, { status: 403 });
  }

  // 3. Permissions
  const isMod = member?.role === 'OWNER' || member?.role === 'MODERATOR';

  // 4. JWT
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: session.user.id,
    name,
    ttl: '2h',
    metadata: JSON.stringify({
      userId: session.user.id,
      avatarUrl: session.user.image,
      role: member?.role ?? 'GUEST',
    }),
  });
  at.addGrant({
    room: roomId,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: isMod,
    roomRecord: isMod,
  });

  return Response.json({ token: await at.toJwt() });
}
```

### 13.4. Webhook receiver

**`apps/web/src/app/api/webhooks/livekit/route.ts`**

```typescript
/**
 * Webhook từ LiveKit — sync event vào DB + trigger downstream job.
 * LiveKit gửi POST với JWT trong Authorization header.
 */
import { WebhookReceiver } from 'livekit-server-sdk';
import { db } from '@/db';
import { rooms, roomEvents } from '@cogniva/db/schema';
import { eq } from 'drizzle-orm';

const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);

export async function POST(req: Request) {
  const body = await req.text();
  const event = await receiver.receive(body, req.headers.get('Authorization'));

  switch (event.event) {
    case 'room_started':
      await db
        .update(rooms)
        .set({ startedAt: new Date(), status: 'ACTIVE' })
        .where(eq(rooms.id, event.room!.name));
      break;
    case 'room_finished':
      await db
        .update(rooms)
        .set({ endedAt: new Date(), status: 'ENDED' })
        .where(eq(rooms.id, event.room!.name));
      // Phase 15 sẽ enqueue BullMQ job AI summary ở đây
      break;
    case 'participant_joined':
      await db.insert(roomEvents).values({
        roomId: event.room!.name,
        userId: event.participant!.identity,
        type: 'JOINED',
      });
      break;
    case 'participant_left':
      await db.insert(roomEvents).values({
        roomId: event.room!.name,
        userId: event.participant!.identity,
        type: 'LEFT',
      });
      break;
    case 'egress_started':
    case 'egress_ended':
      // Phase 15
      break;
  }
  return Response.json({ ok: true });
}
```

### 13.5. Pre-join lobby + Main room

**`apps/web/src/app/(app)/rooms/[roomId]/lobby/page.tsx`**

```typescript
/**
 * Pre-join lobby — user test mic/cam, chọn device trước khi vào room.
 * Lưu device prefs vào localStorage để lần sau dùng lại.
 */
'use client';
import { PreJoin } from '@livekit/components-react';
import { useRouter } from 'next/navigation';

export default function LobbyPage({ params }: { params: { roomId: string } }) {
  const router = useRouter();
  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30">
      <div className="w-full max-w-2xl bg-card rounded-2xl shadow-xl p-8">
        <h1 className="text-2xl font-semibold mb-2">Sẵn sàng tham gia?</h1>
        <p className="text-muted-foreground mb-6">
          Kiểm tra mic và camera trước khi vào phòng.
        </p>
        <PreJoin
          onSubmit={async (values) => {
            localStorage.setItem('audioInput', values.audioDeviceId ?? '');
            localStorage.setItem('videoInput', values.videoDeviceId ?? '');
            const { token } = await fetch('/api/rooms/token', {
              method: 'POST',
              body: JSON.stringify({ roomId: params.roomId, name: values.username }),
            }).then(r => r.json());
            router.push(`/rooms/${params.roomId}?token=${token}`);
          }}
        />
      </div>
    </div>
  );
}
```

**`apps/web/src/app/(app)/rooms/[roomId]/page.tsx`**

```typescript
/**
 * Main room page — wrap LiveKitRoom + Sidebar Tabs (chat/participants/notes/AI).
 * Adaptive bitrate + Simulcast 3 layers (180p/360p/720p) để slow conn fallback mượt.
 */
'use client';
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { VideoGrid } from '@/components/rooms/VideoGrid';
import { ControlBar } from '@/components/rooms/ControlBar';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
// Phase 14 sẽ thêm các panel — Phase 13 chỉ stub
import { ParticipantList } from '@/components/rooms/ParticipantList';

export default function RoomPage({ params }: { params: { roomId: string } }) {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get('token');
  if (!token) router.replace(`/rooms/${params.roomId}/lobby`);

  return (
    <LiveKitRoom
      token={token!}
      serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL!}
      connect
      video
      audio
      onDisconnected={() => router.push('/dashboard')}
      options={{
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          videoSimulcastLayers: [
            { width: 320, height: 180, encoding: { maxBitrate: 150_000 } },
            { width: 640, height: 360, encoding: { maxBitrate: 500_000 } },
            { width: 1280, height: 720, encoding: { maxBitrate: 1_500_000 } },
          ],
        },
      }}
    >
      <div className="grid grid-cols-[1fr_320px] h-screen">
        <main className="flex flex-col">
          <VideoGrid />
          <ControlBar />
        </main>
        <aside className="border-l flex flex-col">
          <Tabs defaultValue="participants">
            <TabsList>
              <TabsTrigger value="participants">Người tham gia</TabsTrigger>
            </TabsList>
            <TabsContent value="participants"><ParticipantList /></TabsContent>
          </Tabs>
        </aside>
      </div>
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}
```

**`apps/web/src/components/rooms/VideoGrid.tsx`**

```typescript
/**
 * VideoGrid — adaptive grid layout theo số participant.
 * 1 → full; 2-4 → 2 cột; 5-9 → 3 cột; 10-16 → 4 cột; 17+ → 5 cột.
 */
'use client';
import { useTracks, ParticipantTile } from '@livekit/components-react';
import { Track } from 'livekit-client';

export function VideoGrid() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );

  const count = tracks.length;
  const cols = count <= 1 ? 1
             : count <= 4 ? 2
             : count <= 9 ? 3
             : count <= 16 ? 4 : 5;

  return (
    <div
      className="flex-1 grid gap-2 p-4 bg-slate-900"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {tracks.map(t => (
        <ParticipantTile
          key={t.publication?.trackSid ?? t.participant.identity}
          trackRef={t}
          className="rounded-lg overflow-hidden bg-black"
        />
      ))}
    </div>
  );
}
```

**`apps/web/src/components/rooms/ControlBar.tsx`**

```typescript
/**
 * ControlBar — toggle mic/cam/screen + raise hand + leave.
 * Raise hand publish qua LiveKit data channel (reliable).
 */
'use client';
import { useTrackToggle, useRoomContext } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Mic, MicOff, Video, VideoOff, ScreenShare, Hand, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';

export function ControlBar() {
  const router = useRouter();
  const room = useRoomContext();
  const { toggle: toggleMic, enabled: micOn } = useTrackToggle({ source: Track.Source.Microphone });
  const { toggle: toggleCam, enabled: camOn } = useTrackToggle({ source: Track.Source.Camera });
  const { toggle: toggleScreen, enabled: screenOn } = useTrackToggle({ source: Track.Source.ScreenShare });

  const raiseHand = () => {
    room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: 'RAISE_HAND' })),
      { reliable: true },
    );
  };

  return (
    <div className="flex items-center justify-center gap-2 p-4 bg-slate-800">
      <Button onClick={toggleMic} variant={micOn ? 'default' : 'destructive'} size="icon" aria-label="Tắt/bật mic">
        {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </Button>
      <Button onClick={toggleCam} variant={camOn ? 'default' : 'destructive'} size="icon" aria-label="Tắt/bật cam">
        {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      </Button>
      <Button onClick={toggleScreen} variant={screenOn ? 'default' : 'outline'} size="icon" aria-label="Chia sẻ màn hình">
        <ScreenShare className="h-4 w-4" />
      </Button>
      <Button onClick={raiseHand} variant="outline" size="icon" aria-label="Giơ tay">
        <Hand className="h-4 w-4" />
      </Button>
      <div className="flex-1" />
      <Button
        onClick={async () => { await room.disconnect(); router.push('/dashboard'); }}
        variant="destructive"
        size="icon"
        aria-label="Rời phòng"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

### 13.6. Deliverable

- [ ] `pnpm drizzle-kit push` apply migration `0014_rooms.sql` thành công.
- [ ] Tạo room qua API (Insomnia/curl) → row trong `rooms`.
- [ ] `/rooms/[id]/lobby` mở mic/cam OK, click "Join" → vào `/rooms/[id]`.
- [ ] 2 browser tab thấy nhau, audio/video stream.
- [ ] LiveKit webhook fire → row `room_events` ghi `JOINED`.

### 13.7. Acceptance criteria

- [ ] Lighthouse a11y ≥ 90 cho lobby + room page.
- [ ] Reload room mid-call → reconnect tự động (LiveKit SDK).
- [ ] Throttle Network → Slow 3G → simulcast tự fallback 180p, vẫn nghe được audio.
- [ ] Token TTL hết hạn → SDK throw clear error, redirect lobby.
- [ ] User không phải member của PRIVATE room → token endpoint trả 403.

### 🔐 Security notes Phase 13

- JWT TTL tối đa 2h (giảm blast radius nếu leak).
- `addGrant` cấp đúng quyền theo role — không cấp `roomAdmin` cho MEMBER.
- Webhook verify HMAC qua `WebhookReceiver.receive()` (mặc định check Authorization header).
- Rate limit `/api/rooms/token` (10 req/min/user qua middleware Phase 10 đã có).
- `joinCode` random 6-char base32, không sequential.

### 13.8. Waiting room + Scheduled rooms

Schema có sẵn `requireApproval` + `scheduledStart` + `recurringPattern` nhưng flow chưa rõ. Bổ sung:

**Flow waiting room:**

```
1. User click "Join" → token endpoint check `requireApproval`
2. Nếu TRUE + chưa là member ACTIVE → insert roomMembers.status = 'PENDING' (KHÔNG cấp token)
3. Trả 202 Accepted với { pending: true }
4. Client redirect → /rooms/[id]/waiting (poll status mỗi 3s hoặc subscribe Socket.IO)
5. Mod thấy badge "1 người chờ" → click Approve → status = 'ACTIVE'
6. Socket.IO broadcast `room:approved` đến PENDING user → client tự fetch token + redirect
```

**`apps/web/src/app/api/rooms/token/route.ts`** — bổ sung logic

```typescript
// (trong handler — sau "Verify user + member" block)
if (room.requireApproval && (!member || member.status !== 'ACTIVE')) {
  // Insert PENDING nếu chưa có
  if (!member) {
    await db.insert(roomMembers).values({
      roomId,
      userId: session.user.id,
      role: 'MEMBER',
      status: 'PENDING',
    });
  }
  // Notify mod qua Soketi
  const mods = room.members.filter((m) => m.role === 'OWNER' || m.role === 'MODERATOR');
  await Promise.all(
    mods.map((m) =>
      pusherServer.trigger(`presence-user-${m.userId}`, 'room:pending-approval', {
        roomId,
        applicant: { id: session.user.id, name: session.user.name },
      }),
    ),
  );
  return Response.json({ pending: true }, { status: 202 });
}
```

**`apps/web/src/app/api/rooms/[roomId]/approve/route.ts`**

```typescript
/**
 * Mod approve/reject waiting room request.
 * POST body: { userId, action: 'APPROVE' | 'REJECT' }
 */
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { roomMembers } from '@cogniva/db/schema';
import { pusherServer } from '@/lib/realtime-server';
import { and, eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: { roomId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
  const { userId, action } = await req.json();

  // Verify caller là mod
  const callerMember = await db.query.roomMembers.findFirst({
    where: and(eq(roomMembers.roomId, params.roomId), eq(roomMembers.userId, session.user.id)),
  });
  if (!callerMember || (callerMember.role !== 'OWNER' && callerMember.role !== 'MODERATOR')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (action === 'APPROVE') {
    await db
      .update(roomMembers)
      .set({ status: 'ACTIVE', joinedAt: new Date() })
      .where(and(eq(roomMembers.roomId, params.roomId), eq(roomMembers.userId, userId)));
    await pusherServer.trigger(`presence-user-${userId}`, 'room:approved', {
      roomId: params.roomId,
    });
  } else {
    await db
      .update(roomMembers)
      .set({ status: 'BANNED' })
      .where(and(eq(roomMembers.roomId, params.roomId), eq(roomMembers.userId, userId)));
    await pusherServer.trigger(`presence-user-${userId}`, 'room:rejected', {
      roomId: params.roomId,
    });
  }
  return Response.json({ ok: true });
}
```

**`apps/web/src/app/(app)/rooms/[roomId]/waiting/page.tsx`**

```typescript
/**
 * Waiting room page — subscribe room:approved, auto-redirect.
 */
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { pusher } from '@/lib/realtime';
import { Loader2 } from 'lucide-react';

export default function WaitingPage({ params }: { params: { roomId: string } }) {
  const router = useRouter();
  useEffect(() => {
    // Channel `presence-user-${userId}` đã subscribe global ở app layout
    const channel = pusher.channel(`presence-user-${getCurrentUserId()}`);
    const onApproved = (data: { roomId: string }) => {
      if (data.roomId === params.roomId) router.replace(`/rooms/${params.roomId}/lobby`);
    };
    const onRejected = (data: { roomId: string }) => {
      if (data.roomId === params.roomId) router.replace('/rooms?rejected=1');
    };
    channel?.bind('room:approved', onApproved);
    channel?.bind('room:rejected', onRejected);
    return () => {
      channel?.unbind('room:approved', onApproved);
      channel?.unbind('room:rejected', onRejected);
    };
  }, [params.roomId, router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <h1 className="text-xl font-semibold">Đang chờ mod phê duyệt...</h1>
      <p className="text-sm text-muted-foreground max-w-md">
        Yêu cầu của bạn đã được gửi đến mod của phòng. Bạn sẽ tự động vào phòng khi được duyệt.
      </p>
    </div>
  );
}
```

**Scheduled rooms cron** — auto-start room ở `scheduledStart`, notify member.

**`apps/web/src/inngest/functions/scheduled-rooms.ts`**

```typescript
/**
 * Cron mỗi 1 phút: tìm room có scheduledStart <= now + 5min + status IDLE.
 * → Notify member (push notification + email), mark room IS_STARTING.
 * → Recurring: tính next occurrence sau khi room ended.
 */
import { inngest } from '@/inngest/client';
import { db } from '@/db';
import { rooms } from '@cogniva/db/schema';
import { and, eq, lte } from 'drizzle-orm';
import { sendPushNotification } from '@/lib/notifications';

export const scheduledRoomsCron = inngest.createFunction(
  { id: 'scheduled-rooms-poller' },
  { cron: '* * * * *' }, // mỗi phút
  async ({ step }) => {
    const upcoming = await step.run('find-upcoming', async () => {
      const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
      return db.query.rooms.findMany({
        where: and(eq(rooms.status, 'IDLE'), lte(rooms.scheduledStart!, fiveMinFromNow)),
        with: { members: { with: { user: true } } },
      });
    });

    for (const room of upcoming) {
      await step.run(`notify-${room.id}`, async () => {
        await Promise.all(
          room.members.map((m) =>
            sendPushNotification(m.userId, {
              title: `"${room.name}" bắt đầu sau 5 phút`,
              body: 'Click để vào lobby',
              url: `/rooms/${room.id}/lobby`,
            }),
          ),
        );
      });
    }
  },
);

export const scheduledRoomEnded = inngest.createFunction(
  { id: 'scheduled-room-ended' },
  { event: 'room/ended' },
  async ({ event, step }) => {
    const room = await db.query.rooms.findFirst({ where: eq(rooms.id, event.data.roomId) });
    if (!room?.recurringPattern) return;

    const pattern = room.recurringPattern as {
      freq: 'WEEKLY' | 'DAILY';
      days?: number[];
      until?: string;
    };
    const nextStart = computeNextOccurrence(pattern, room.scheduledStart!);
    if (pattern.until && nextStart > new Date(pattern.until)) return;

    // Clone room cho occurrence kế tiếp
    await step.run('clone-recurring', async () => {
      await db.insert(rooms).values({
        ...room,
        id: undefined, // sinh id mới
        status: 'IDLE',
        scheduledStart: nextStart,
        startedAt: null,
        endedAt: null,
        createdAt: new Date(),
      });
    });
  },
);
```

---

## Phase 14: Room Collaboration (Tuần 3)

> **Mục tiêu cuối Phase 14:** Trong room, user có thể chat realtime, vẽ whiteboard chung, viết notes chung, đặt pomodoro đồng bộ, react emoji floating, kick/mute người khác (nếu là mod).

### 14.1. Mục tiêu chi tiết

- Chat realtime qua Socket.IO (gateway `apps/realtime`): gửi/nhận text, file (link upload R2), system events.
- Whiteboard cộng tác (Excalidraw + Yjs + Hocuspocus).
- Shared notes (TipTap + Yjs).
- Pomodoro timer đồng bộ giữa các participant (state qua data channel).
- Reactions floating (emoji bay từ user avatar lên).
- Mod actions: kick, mute force, lock room, approve waiting room.

### 14.2. Realtime layer

> ⚠️ **Sau migration:** lớp realtime nay là **Socket.IO self-host** (gateway `apps/realtime`). Web không còn `pusher-js`/`new Pusher()` — client subscribe qua `useRealtimeEvent()`/`useRealtimePresence()` trong `realtime-client.ts`, server emit qua `triggerEvent()` trong `realtime-server.ts` (dùng `@socket.io/redis-emitter`). Các code block Pusher dưới đây giữ làm lịch sử; chi tiết tại `docs/plans/socketio-migration.md`.

**`apps/web/src/lib/realtime.ts`**

```typescript
/**
 * Pusher-js client point vào Soketi self-hosted.
 * Dùng auth endpoint /api/realtime/auth cho presence/private channel.
 */
import Pusher from 'pusher-js';

export const pusher = new Pusher(process.env.NEXT_PUBLIC_SOKETI_KEY!, {
  wsHost: process.env.NEXT_PUBLIC_SOKETI_HOST!,
  wsPort: 443,
  forceTLS: true,
  cluster: '',
  enabledTransports: ['ws', 'wss'],
  authEndpoint: '/api/realtime/auth',
});
```

**`apps/web/src/lib/realtime-server.ts`**

```typescript
/**
 * Pusher server SDK — trigger event từ route handler.
 */
import Pusher from 'pusher';

export const pusherServer = new Pusher({
  appId: process.env.SOKETI_APP_ID!,
  key: process.env.NEXT_PUBLIC_SOKETI_KEY!,
  secret: process.env.SOKETI_SECRET!,
  host: process.env.NEXT_PUBLIC_SOKETI_HOST!,
  port: '443',
  useTLS: true,
});
```

**`apps/web/src/app/api/realtime/auth/route.ts`**

```typescript
/**
 * Soketi auth endpoint — sign presence/private channel.
 * Verify user phải là member của room/exam tương ứng.
 */
import { auth } from '@/lib/auth';
import { pusherServer } from '@/lib/realtime-server';
import { db } from '@/db';

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });

  const formData = await req.formData();
  const socketId = formData.get('socket_id') as string;
  const channel = formData.get('channel_name') as string;

  // Channel naming: presence-room-{roomId}, presence-exam-{examId}
  if (channel.startsWith('presence-room-')) {
    const roomId = channel.replace('presence-room-', '');
    const member = await db.query.roomMembers.findFirst({
      where: (m, { eq, and }) => and(eq(m.roomId, roomId), eq(m.userId, session.user.id)),
    });
    if (!member) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const authData = pusherServer.authorizeChannel(socketId, channel, {
      user_id: session.user.id,
      user_info: { name: session.user.name, image: session.user.image },
    });
    return Response.json(authData);
  }

  return Response.json({ error: 'Unknown channel' }, { status: 400 });
}
```

### 14.3. Chat panel

**`apps/web/src/app/api/rooms/[roomId]/chat/route.ts`**

```typescript
/**
 * POST /api/rooms/[roomId]/chat — gửi message + broadcast qua Soketi.
 * Save DB trước → broadcast sau (để nếu DB fail thì client không nhận message giả).
 */
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { roomMessages } from '@cogniva/db/schema';
import { pusherServer } from '@/lib/realtime-server';

export async function POST(req: Request, { params }: { params: { roomId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
  const { message, type = 'TEXT', metadata } = await req.json();

  const [saved] = await db
    .insert(roomMessages)
    .values({
      roomId: params.roomId,
      userId: session.user.id,
      content: message,
      type,
      metadata,
    })
    .returning();

  await pusherServer.trigger(`presence-room-${params.roomId}`, 'chat:message', {
    id: saved.id,
    userId: session.user.id,
    userName: session.user.name,
    avatarUrl: session.user.image,
    content: saved.content,
    type: saved.type,
    timestamp: saved.createdAt,
  });

  return Response.json({ ok: true, id: saved.id });
}
```

**`apps/web/src/components/rooms/ChatPanel.tsx`**

```typescript
/**
 * ChatPanel — subscribe Soketi presence channel, render message list.
 * Slash commands /poll, /timer, /summarize sẽ wire Phase 15 (AI).
 */
'use client';
import { useEffect, useState } from 'react';
import { pusher } from '@/lib/realtime';
import { ScrollArea } from '@/components/ui/scroll-area';

type Msg = { id: string; userId: string; userName: string; avatarUrl?: string; content: string; timestamp: string };

export function ChatPanel({ roomId }: { roomId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    const channel = pusher.subscribe(`presence-room-${roomId}`);
    channel.bind('chat:message', (data: Msg) => setMessages(prev => [...prev, data]));
    return () => { pusher.unsubscribe(`presence-room-${roomId}`); };
  }, [roomId]);

  const send = async () => {
    if (!input.trim()) return;
    await fetch(`/api/rooms/${roomId}/chat`, {
      method: 'POST',
      body: JSON.stringify({ message: input }),
    });
    setInput('');
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 p-3 space-y-2">
        {messages.map(m => (
          <div key={m.id} className="flex gap-2 text-sm">
            <span className="font-medium">{m.userName}:</span>
            <span>{m.content}</span>
          </div>
        ))}
      </ScrollArea>
      <div className="border-t p-2 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="Nhập tin nhắn..."
          className="flex-1 rounded-md border px-3 py-1.5 text-sm bg-background"
        />
      </div>
    </div>
  );
}
```

### 14.4. Whiteboard cộng tác

**`apps/web/src/components/rooms/WhiteboardPanel.tsx`**

```typescript
/**
 * WhiteboardPanel — Excalidraw + Yjs CRDT.
 * Doc name format: room:{roomId}:whiteboard (Hocuspocus check membership từ tên).
 */
'use client';
import { Excalidraw } from '@excalidraw/excalidraw';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';

export function WhiteboardPanel({ roomId, jwtToken }: { roomId: string; jwtToken: string }) {
  const [api, setApi] = useState<any>(null);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const p = new HocuspocusProvider({
      url: process.env.NEXT_PUBLIC_HOCUSPOCUS_URL!,
      name: `room:${roomId}:whiteboard`,
      document: ydoc,
      token: jwtToken,
    });
    const yElements = ydoc.getArray('elements');
    yElements.observe(() => {
      const els = yElements.toArray();
      api?.updateScene({ elements: els });
    });
    setProvider(p);
    return () => { p.destroy(); };
  }, [roomId, api, jwtToken]);

  return (
    <Excalidraw
      excalidrawAPI={setApi}
      onChange={(elements) => {
        if (!provider) return;
        const yElements = provider.document.getArray('elements');
        provider.document.transact(() => {
          yElements.delete(0, yElements.length);
          yElements.push(elements as any);
        });
      }}
    />
  );
}
```

### 14.5. Shared notes (TipTap + Yjs)

**`apps/web/src/components/rooms/NotesPanel.tsx`**

```typescript
/**
 * NotesPanel — TipTap editor sync qua Yjs.
 * Tái dùng TipTap setup từ Phase 7 (notes cá nhân), thêm Collaboration extension.
 */
'use client';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';

export function NotesPanel({ roomId, jwtToken, userName }: { roomId: string; jwtToken: string; userName: string }) {
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const p = new HocuspocusProvider({
      url: process.env.NEXT_PUBLIC_HOCUSPOCUS_URL!,
      name: `room:${roomId}:notes`,
      document: ydoc,
      token: jwtToken,
    });
    setProvider(p);
    return () => { p.destroy(); };
  }, [roomId, jwtToken]);

  const editor = useEditor({
    extensions: provider ? [
      StarterKit.configure({ history: false }),  // history phải tắt khi dùng Yjs
      Collaboration.configure({ document: provider.document }),
      CollaborationCursor.configure({ provider, user: { name: userName } }),
    ] : [StarterKit],
  }, [provider]);

  return <EditorContent editor={editor} className="prose max-w-none p-3" />;
}
```

### 14.6. Pomodoro đồng bộ

**`apps/web/src/components/rooms/PomodoroTimer.tsx`**

```typescript
/**
 * Pomodoro đồng bộ — state share qua LiveKit data channel (lightweight, không cần Socket.IO).
 * Mod start/pause/reset, mọi participant nghe data event → render countdown đồng bộ.
 */
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRoomContext, useLocalParticipant } from '@livekit/components-react';

type PomoState = { startAt: number | null; durationSec: number; pausedAt: number | null };

export function PomodoroTimer({ isMod }: { isMod: boolean }) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [state, setState] = useState<PomoState>({ startAt: null, durationSec: 25 * 60, pausedAt: null });
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef<number | null>(null);

  // Lắng nghe data event từ mod
  useEffect(() => {
    const handler = (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === 'POMO_STATE') setState(data.state);
      } catch {}
    };
    room.on('dataReceived', handler);
    return () => { room.off('dataReceived', handler); };
  }, [room]);

  useEffect(() => {
    intervalRef.current = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const broadcast = (next: PomoState) => {
    setState(next);
    localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: 'POMO_STATE', state: next })),
      { reliable: true },
    );
  };

  const remaining = state.startAt
    ? Math.max(0, state.durationSec - Math.floor(((state.pausedAt ?? now) - state.startAt) / 1000))
    : state.durationSec;

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-mono text-lg">
        {String(Math.floor(remaining / 60)).padStart(2, '0')}:{String(remaining % 60).padStart(2, '0')}
      </span>
      {isMod && (
        <>
          <button onClick={() => broadcast({ ...state, startAt: Date.now(), pausedAt: null })}>Start</button>
          <button onClick={() => broadcast({ ...state, pausedAt: Date.now() })}>Pause</button>
          <button onClick={() => broadcast({ startAt: null, durationSec: 25 * 60, pausedAt: null })}>Reset</button>
        </>
      )}
    </div>
  );
}
```

### 14.7. Reactions floating

**`apps/web/src/components/rooms/ReactionsLayer.tsx`**

```typescript
/**
 * ReactionsLayer — emoji bay từ dưới lên khi user click button trên control bar.
 * Broadcast qua LiveKit data channel + CSS animation 2s.
 */
'use client';
import { useEffect, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';

type Reaction = { id: string; emoji: string; x: number };

export function ReactionsLayer() {
  const room = useRoomContext();
  const [items, setItems] = useState<Reaction[]>([]);

  useEffect(() => {
    const handler = (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === 'REACTION') {
          const r = { id: crypto.randomUUID(), emoji: data.emoji, x: Math.random() * 80 + 10 };
          setItems(prev => [...prev, r]);
          setTimeout(() => setItems(prev => prev.filter(i => i.id !== r.id)), 2000);
        }
      } catch {}
    };
    room.on('dataReceived', handler);
    return () => { room.off('dataReceived', handler); };
  }, [room]);

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {items.map(r => (
        <span
          key={r.id}
          className="absolute bottom-20 text-4xl animate-float-up"
          style={{ left: `${r.x}%` }}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}
```

Thêm vào `globals.css`:

```css
@keyframes float-up {
  from {
    transform: translateY(0);
    opacity: 1;
  }
  to {
    transform: translateY(-300px);
    opacity: 0;
  }
}
.animate-float-up {
  animation: float-up 2s ease-out forwards;
}
```

### 14.8. Mod actions

**`apps/web/src/app/api/rooms/[roomId]/moderate/route.ts`**

```typescript
/**
 * Mod actions: kick, mute force, lock, approve waiting room.
 * Dùng LiveKit Server SDK gọi RoomService API.
 */
import { RoomServiceClient } from 'livekit-server-sdk';
import { auth } from '@/lib/auth';
import { db } from '@/db';

const livekit = new RoomServiceClient(
  process.env.NEXT_PUBLIC_LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

export async function POST(req: Request, { params }: { params: { roomId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });

  // Verify mod role
  const member = await db.query.roomMembers.findFirst({
    where: (m, { eq, and }) => and(eq(m.roomId, params.roomId), eq(m.userId, session.user.id)),
  });
  if (!member || (member.role !== 'OWNER' && member.role !== 'MODERATOR')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { action, targetUserId } = await req.json();
  switch (action) {
    case 'KICK':
      await livekit.removeParticipant(params.roomId, targetUserId);
      break;
    case 'MUTE':
      await livekit.mutePublishedTrack(params.roomId, targetUserId, 'audio', true);
      break;
    case 'LOCK':
      await livekit.updateRoomMetadata(params.roomId, JSON.stringify({ locked: true }));
      break;
  }
  return Response.json({ ok: true });
}
```

### 14.9. Deliverable

- [ ] Chat: 2 user gõ, thấy nhau realtime <500ms.
- [ ] Whiteboard: vẽ ở tab A, tab B thấy ngay.
- [ ] Notes: 2 user gõ cùng lúc, không bị overwrite (Yjs merge).
- [ ] Pomodoro mod start → mọi participant count xuống đồng bộ ±1s.
- [ ] Reaction emoji bay từ dưới lên 2s rồi mất.
- [ ] Mod click kick → user kia disconnect ngay.

### 14.10. Acceptance criteria

- [ ] Hocuspocus restart → client tự reconnect, không mất state (Postgres persist).
- [ ] Socket.IO gateway crash → chat hiển thị "Mất kết nối", auto retry sau 5s.
- [ ] Whiteboard 50 elements vẫn smooth 60fps.
- [ ] Yjs binary state < 100KB cho 30 phút sketch trung bình.
- [ ] Notes cursor presence (CollaborationCursor) hiện màu khác nhau cho từng user.

### 🔐 Security notes Phase 14

- Hocuspocus `onAuthenticate` verify JWT + membership theo doc name pattern.
- Presence/private channel authorize qua `POST /api/realtime/auth` server-side (verify session + membership), client không tự cấp quyền.
- Mod action API verify role từ DB, không trust client claim.
- File upload trong chat: virus scan qua ClamAV (deferred V2) hoặc reject MIME ngoài whitelist.

---

## Phase 15: AI Tutor + Recording (Tuần 4)

> **Mục tiêu cuối Phase 15:** Trong room, user gõ `@AI` → Mastra agent trả lời stream qua chat. Mod click "Record" → LiveKit Egress xuất MP4 lên R2, sau buổi: Whisper transcribe + Claude summary + auto-chapter.

### 15.1. Mục tiêu chi tiết

- Mastra agent `roomTutor` aware về context room (topic, recent messages, shared docs, participants).
- AI response stream từng token qua Socket.IO event `ai:streaming`.
- LiveKit Egress trigger qua API → record composite (video + audio mixed) layout `speaker`.
- BullMQ job xử lý recording: extract audio → Whisper transcribe → AI summary → auto-chapter → flashcard gen.
- UI replay: video player + transcript searchable + chapter markers + summary panel.

### 15.2. Mastra agent

**`apps/web/src/mastra/agents/room-tutor.ts`**

```typescript
/**
 * roomTutor — Mastra agent dành cho in-room AI assistant.
 * Context: room topic, 20 message gần nhất, shared docs, list participants.
 * Tools: searchUserDocs (RAG từ Phase 3), genQuiz (Phase 6), translate.
 */
import { Agent } from '@mastra/core/agent';
import { anthropic } from '@ai-sdk/anthropic';
import { searchUserDocsTool } from '@/mastra/tools/search-docs';

export const roomTutor = new Agent({
  name: 'roomTutor',
  instructions: `Bạn là gia sư AI trong một phòng học nhóm. Trả lời gọn (≤200 từ), tiếng Việt mặc định.
Nếu user hỏi về tài liệu họ chia sẻ trong phòng, dùng tool searchUserDocs.
Nếu nhiều người trong phòng đang tranh luận → tóm tắt 2 quan điểm rồi đưa nhận định.
Không trả lời câu hỏi về thông tin nhạy cảm/bạo lực/spam.`,
  model: anthropic('claude-sonnet-4-6'),
  tools: { searchUserDocs: searchUserDocsTool },
});
```

**`apps/web/src/app/api/rooms/[roomId]/ai-message/route.ts`**

```typescript
/**
 * POST /api/rooms/[roomId]/ai-message — user trigger AI response.
 * Stream từng delta qua Soketi để tất cả participant cùng thấy.
 */
import { mastra } from '@/mastra';
import { db } from '@/db';
import { roomMessages } from '@cogniva/db/schema';
import { pusherServer } from '@/lib/realtime-server';
import { auth } from '@/lib/auth';
import { desc, eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: { roomId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
  const { message } = await req.json();

  const room = await db.query.rooms.findFirst({ where: eq(rooms.id, params.roomId) });
  const recent = await db.query.roomMessages.findMany({
    where: eq(roomMessages.roomId, params.roomId),
    orderBy: desc(roomMessages.createdAt),
    limit: 20,
  });

  const agent = mastra.getAgent('roomTutor');
  const messageId = crypto.randomUUID();

  // Save message stub trước (placeholder), update content khi stream xong
  await db.insert(roomMessages).values({
    id: messageId,
    roomId: params.roomId,
    userId: 'AI_TUTOR',
    content: '',
    type: 'AI',
  });

  let full = '';
  const stream = await agent.stream({
    messages: [
      {
        role: 'system',
        content: `Topic phòng: ${room?.name ?? 'Học tự do'}. ${recent.length} message gần đây.`,
      },
      ...recent
        .reverse()
        .map((m) => ({ role: m.userId === 'AI_TUTOR' ? 'assistant' : 'user', content: m.content })),
      { role: 'user', content: message },
    ],
  });

  for await (const chunk of stream.textStream) {
    full += chunk;
    await pusherServer.trigger(`presence-room-${params.roomId}`, 'ai:streaming', {
      messageId,
      delta: chunk,
    });
  }

  await db
    .update(roomMessages)
    .set({ content: full, metadata: { isAI: true, model: 'claude-sonnet-4-6' } })
    .where(eq(roomMessages.id, messageId));

  await pusherServer.trigger(`presence-room-${params.roomId}`, 'ai:complete', { messageId });
  return Response.json({ ok: true, messageId });
}
```

### 15.3. Recording trigger + egress config

**`infrastructure/livekit-egress/docker-compose.yml`**

```yaml
# Egress service tự host — render composite video lên R2
services:
  egress:
    image: livekit/egress:latest
    environment:
      EGRESS_CONFIG_FILE: /etc/egress.yaml
    volumes:
      - ./egress.yaml:/etc/egress.yaml
    cap_add:
      - SYS_ADMIN # headless Chrome cần
    network_mode: host
```

**`infrastructure/livekit-egress/egress.yaml`**

```yaml
api_key: ${LIVEKIT_API_KEY}
api_secret: ${LIVEKIT_API_SECRET}
ws_url: ws://livekit:7880
redis:
  address: redis:6379
s3:
  access_key: ${R2_ACCESS_KEY}
  secret: ${R2_SECRET}
  region: auto
  bucket: cogniva-recordings
  endpoint: https://${R2_ACCOUNT}.r2.cloudflarestorage.com
```

**`apps/web/src/app/api/rooms/[roomId]/record/route.ts`**

```typescript
/**
 * POST /api/rooms/[roomId]/record — start composite recording.
 * Chỉ mod được record. Save egressId để webhook update sau.
 */
import { EgressClient, EncodedFileType, EncodedFileOutput } from 'livekit-server-sdk';
import { db } from '@/db';
import { recordings } from '@cogniva/db/schema';
import { auth } from '@/lib/auth';

const egressClient = new EgressClient(
  process.env.NEXT_PUBLIC_LIVEKIT_URL!,
  process.env.LIVEKIT_API_KEY!,
  process.env.LIVEKIT_API_SECRET!,
);

export async function POST(req: Request, { params }: { params: { roomId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });

  const output = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: `recordings/${params.roomId}/${Date.now()}.mp4`,
  });

  const info = await egressClient.startRoomCompositeEgress(params.roomId, {
    file: output,
    layout: 'speaker', // hoặc 'grid' | 'single-speaker'
  });

  await db.insert(recordings).values({
    roomId: params.roomId,
    egressId: info.egressId,
    status: 'RECORDING',
  });

  return Response.json({ egressId: info.egressId });
}
```

### 15.4. Post-processing pipeline (BullMQ)

**`apps/web/src/inngest/functions/process-recording.ts`**

```typescript
/**
 * Inngest: recording/finished event → pipeline xử lý.
 * Trigger từ webhook LiveKit egress_ended hoặc cron poll.
 */
import { inngest } from '@/inngest/client';
import { extractAudio } from '@/lib/media/ffmpeg';
import { whisperTranscribe } from '@/lib/media/whisper';
import { mastra } from '@/mastra';
import { db } from '@/db';
import { recordings } from '@cogniva/db/schema';
import { eq } from 'drizzle-orm';

export const processRecording = inngest.createFunction(
  { id: 'process-recording', retries: 3 },
  { event: 'recording/finished' },
  async ({ event, step }) => {
    const { recordingId, fileUrl } = event.data as { recordingId: string; fileUrl: string };

    const audioPath = await step.run('extract-audio', () => extractAudio(fileUrl));
    const transcript = await step.run('transcribe', () => whisperTranscribe(audioPath));
    const summary = await step.run('summarize', async () => {
      const agent = mastra.getAgent('summarizer');
      const out = await agent.generate({
        messages: [
          { role: 'user', content: `Tóm tắt buổi học sau (≤300 từ, tiếng Việt):\n\n${transcript}` },
        ],
      });
      return out.text;
    });

    const chapters = await step.run('detect-chapters', async () => {
      // Phát hiện topic shift mỗi 5 phút bằng cosine similarity giữa các đoạn
      return detectTopicShifts(transcript);
    });

    const flashcards = await step.run('generate-cards', async () => {
      const agent = mastra.getAgent('cardGenerator');
      const out = await agent.generate({
        messages: [
          { role: 'user', content: `Tạo 10 flashcard cloze từ transcript:\n${transcript}` },
        ],
      });
      return JSON.parse(out.text);
    });

    await step.run('save', async () => {
      await db
        .update(recordings)
        .set({
          transcript,
          summary,
          chapters,
          status: 'PROCESSED',
        })
        .where(eq(recordings.id, recordingId));
    });

    await step.run('notify', () => notifyParticipants(recordingId));
  },
);
```

**`apps/web/src/lib/media/ffmpeg.ts`** (tách audio)

```typescript
/**
 * Extract audio dùng ffmpeg subprocess.
 * Output 16kHz mono WAV — định dạng Whisper khuyên dùng.
 */
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

export async function extractAudio(videoUrl: string): Promise<string> {
  const tmp = `/tmp/${crypto.randomUUID()}.wav`;
  // Download trước nếu là URL (R2 presigned)
  const videoPath = videoUrl.startsWith('http') ? await downloadToTmp(videoUrl) : videoUrl;
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i',
      videoPath,
      '-vn',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      tmp,
    ]);
    ff.on('close', (code) =>
      code === 0 ? resolve(tmp) : reject(new Error(`ffmpeg exit ${code}`)),
    );
  });
}
```

**`apps/web/src/lib/media/whisper.ts`** (transcribe)

```typescript
/**
 * Whisper transcribe — dùng OpenAI Whisper API hoặc self-host whisper.cpp.
 * Phase 15 v1 dùng OpenAI; V2 self-host khi cost > $50/tháng.
 */
import OpenAI from 'openai';
import { createReadStream } from 'fs';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function whisperTranscribe(audioPath: string): Promise<string> {
  const result = await openai.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: 'whisper-1',
    language: 'vi',
    response_format: 'verbose_json',
  });
  return result.text;
}
```

### 15.5. Replay UI

**`apps/web/src/app/(app)/rooms/[roomId]/recordings/[recId]/page.tsx`**

```typescript
/**
 * Replay page — video player + transcript timeline + chapter markers + summary.
 */
import { db } from '@/db';
import { recordings } from '@cogniva/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';

export default async function ReplayPage({ params }: { params: { recId: string } }) {
  const rec = await db.query.recordings.findFirst({ where: eq(recordings.id, params.recId) });
  if (!rec) notFound();

  return (
    <div className="grid grid-cols-[1fr_400px] h-screen">
      <main className="flex flex-col">
        <video src={rec.fileUrl ?? ''} controls className="w-full bg-black" />
        <div className="p-4">
          <h2 className="font-semibold">Tóm tắt</h2>
          <p className="text-sm text-muted-foreground">{rec.summary}</p>
        </div>
      </main>
      <aside className="border-l overflow-y-auto p-4">
        <h3 className="font-semibold mb-2">Chương</h3>
        <ul className="space-y-2 mb-6">
          {(rec.chapters as any[])?.map((c, i) => (
            <li key={i}>
              <button className="text-sm text-primary underline" onClick={() => seekTo(c.startSec)}>
                {Math.floor(c.startSec / 60)}:{String(c.startSec % 60).padStart(2, '0')} — {c.title}
              </button>
            </li>
          ))}
        </ul>
        <h3 className="font-semibold mb-2">Transcript</h3>
        <p className="text-xs whitespace-pre-wrap">{rec.transcript}</p>
      </aside>
    </div>
  );
}
```

### 15.6. Deliverable

- [ ] Gõ `@AI hãy giải thích lim` trong chat → AI stream từng token, broadcast tất cả tab thấy.
- [ ] Mod click Record → file MP4 xuất hiện trong R2 sau khi end room.
- [ ] Bull Board / admin /admin/system/jobs: job `process-recording` chạy success, transcript + summary trong DB.
- [ ] `/rooms/[id]/recordings/[recId]` chạy video + scroll transcript theo timestamp.

### 15.7. Acceptance criteria

- [ ] AI response < 5s đến token đầu tiên (TTFT P95).
- [ ] Whisper transcribe 60 phút audio < 5 phút.
- [ ] Auto-chapter detect ≥ 3 chapter cho buổi 60 phút có 3+ topic.
- [ ] Recording file size < 500MB / giờ với speaker layout.
- [ ] Replay page seek chapter < 200ms.

### 🔐 Security notes Phase 15

- AI tutor không leak data từ user khác qua searchUserDocs (filter theo `session.user.id`).
- Recording chỉ accessible bởi member (presigned R2 URL TTL 1h).
- Privacy banner: "Buổi học đang được ghi" hiển thị to khi record ON.
- Consent prompt khi join room có record=ON, user có thể từ chối → bị reject join.
- Whisper API: KHÔNG gửi PII (tên thật, email) — Whisper-1 không train trên user data theo OpenAI policy, nhưng audit lại.

---

## Phase 16: Exam System Core (Tuần 5)

> **Mục tiêu cuối Phase 16:** Teacher tạo exam, AI gen questions từ document, students làm Practice mode + Timed mode, auto-grade MCQ/T-F/Fill-blank, AI grade short answer.

### 16.1. Mục tiêu chi tiết

- Drizzle schema cho `exams`, `questions`, `exam_attempts`, `exam_responses`, `exam_violations`.
- Exam builder UI: thêm câu hỏi thủ công + nhập từ AI generator (Mastra agent).
- Practice mode: không giới hạn thời gian, hiển thị giải thích ngay sau mỗi câu.
- Timed mode: countdown global, auto-submit khi hết giờ.
- Auto-grading: MCQ_SINGLE/MULTI, TRUE_FALSE, FILL_BLANK, ORDERING, MATCHING.
- AI grading: SHORT (Claude với rubric).
- Result page: điểm + breakdown từng câu + explanation.

### 16.2. Schema delta

**`packages/db/src/schema.ts`** (append)

```typescript
/**
 * Phase 16: Exam System.
 * Hỗ trợ 6 mode: PRACTICE, TIMED, LIVE (Phase 17), ASYNC, ADAPTIVE (Phase 18), TOURNAMENT.
 * Hỗ trợ 12 question type — không phải tất cả thực thi ngay, schema sẵn sàng.
 */
export const exams = pgTable('exams', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id),
  title: text('title').notNull(),
  description: text('description'),
  mode: text('mode').notNull(), // PRACTICE | TIMED | LIVE | ASYNC | ADAPTIVE | TOURNAMENT
  status: text('status').notNull().default('DRAFT'), // DRAFT | PUBLISHED | IN_PROGRESS | ENDED

  durationSeconds: integer('duration_seconds'),
  startsAt: timestamp('starts_at'),
  endsAt: timestamp('ends_at'),

  passingScore: real('passing_score'),
  maxScore: real('max_score'),
  showResults: text('show_results').notNull().default('IMMEDIATE'), // IMMEDIATE | AFTER_SUBMIT | AFTER_ALL_DONE

  shuffleQuestions: boolean('shuffle_questions').default(true),
  shuffleOptions: boolean('shuffle_options').default(true),
  allowReview: boolean('allow_review').default(true),
  maxAttempts: integer('max_attempts').default(1),

  // Live (Phase 17)
  liveCode: text('live_code').unique(),
  currentQuestionIndex: integer('current_question_index'),

  // Adaptive (Phase 18)
  minQuestions: integer('min_questions').default(10),
  maxQuestions: integer('max_questions').default(30),
  targetSE: real('target_se').default(0.3),

  // Anti-cheat (Phase 19 sẽ wire fully)
  antiCheat: jsonb('anti_cheat').default({
    requireFullscreen: false,
    blockTabSwitch: false,
    blockCopyPaste: true,
    blockContextMenu: true,
    detectDevtools: true,
    requireWebcam: false,
    aiProctor: false,
  }),

  classroomId: text('classroom_id'),
  conceptIds: jsonb('concept_ids'),
  createdAt: timestamp('created_at').defaultNow(),
  publishedAt: timestamp('published_at'),
});

export const questions = pgTable('questions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  examId: text('exam_id').references(() => exams.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  // MCQ_SINGLE | MCQ_MULTI | TRUE_FALSE | SHORT | ESSAY | FILL_BLANK | MATCHING | ORDERING | CODE | MATH | DRAWING

  prompt: text('prompt').notNull(),
  promptHtml: text('prompt_html'),
  attachments: jsonb('attachments'), // [{type, url}]

  options: jsonb('options'),
  correctAnswer: jsonb('correct_answer'),
  acceptableAnswers: jsonb('acceptable_answers'),
  rubric: jsonb('rubric'),
  testCases: jsonb('test_cases'), // Phase 18

  points: real('points').default(1),
  partialCredit: boolean('partial_credit').default(false),

  // IRT (Phase 18)
  difficulty: real('difficulty').default(0),
  discrimination: real('discrimination').default(1),
  guessing: real('guessing').default(0),

  conceptId: text('concept_id'),
  explanation: text('explanation'),
  hint: text('hint'),
  timeLimit: integer('time_limit_seconds'),
  orderIndex: integer('order_index'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const examAttempts = pgTable('exam_attempts', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  examId: text('exam_id')
    .notNull()
    .references(() => exams.id),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  status: text('status').notNull().default('IN_PROGRESS'),
  // IN_PROGRESS | SUBMITTED | TIMED_OUT | AUTO_SUBMITTED | DISQUALIFIED

  startedAt: timestamp('started_at').defaultNow(),
  submittedAt: timestamp('submitted_at'),

  score: real('score'),
  maxScore: real('max_score'),
  percentage: real('percentage'),
  passed: boolean('passed'),

  estimatedTheta: real('estimated_theta'),
  thetaSE: real('theta_se'),

  timeSpentSeconds: integer('time_spent_seconds'),
  questionsAnswered: integer('questions_answered').default(0),

  // Anti-cheat
  violations: jsonb('violations'),
  cheatRiskScore: real('cheat_risk_score'),
  flagged: boolean('flagged').default(false),
  flagReason: text('flag_reason'),

  webcamRecordingUrl: text('webcam_recording_url'),
  proctorNotes: text('proctor_notes'),

  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  browserFingerprint: text('browser_fingerprint'),
});

export const examResponses = pgTable('exam_responses', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  attemptId: text('attempt_id')
    .notNull()
    .references(() => examAttempts.id, { onDelete: 'cascade' }),
  questionId: text('question_id')
    .notNull()
    .references(() => questions.id),
  answer: jsonb('answer'),
  isCorrect: boolean('is_correct'),
  pointsEarned: real('points_earned').default(0),

  startedAt: timestamp('started_at'),
  submittedAt: timestamp('submitted_at'),
  responseTimeMs: integer('response_time_ms'),
  rankAtSubmit: integer('rank_at_submit'),

  aiGrading: jsonb('ai_grading'),
  manualGrading: jsonb('manual_grading'),
  needsReview: boolean('needs_review').default(false),
  reviewedBy: text('reviewed_by'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const examViolations = pgTable('exam_violations', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => createId()),
  attemptId: text('attempt_id')
    .notNull()
    .references(() => examAttempts.id),
  type: text('type').notNull(),
  severity: text('severity').notNull(), // low | medium | high
  metadata: jsonb('metadata'),
  timestamp: timestamp('timestamp').defaultNow(),
});

export const examsRelations = relations(exams, ({ one, many }) => ({
  owner: one(user, { fields: [exams.ownerId], references: [user.id] }),
  questions: many(questions),
  attempts: many(examAttempts),
}));
```

### 16.3. Exam builder API

**`apps/web/src/app/api/exams/route.ts`** (CRUD + AI generate)

```typescript
/**
 * GET /api/exams — list của user.
 * POST /api/exams — tạo exam mới (DRAFT).
 */
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { exams } from '@cogniva/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
  const rows = await db.query.exams.findMany({ where: eq(exams.ownerId, session.user.id) });
  return Response.json({ exams: rows });
}

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
  const body = await req.json();
  const [created] = await db
    .insert(exams)
    .values({
      ownerId: session.user.id,
      title: body.title,
      description: body.description,
      mode: body.mode ?? 'PRACTICE',
      durationSeconds: body.durationSeconds,
    })
    .returning();
  return Response.json({ exam: created });
}
```

**`apps/web/src/app/api/exams/[id]/generate/route.ts`** (AI gen questions)

```typescript
/**
 * AI sinh câu hỏi từ document. Reuse logic Phase 6 (quiz generation), thay nhiệt độ + format.
 */
import { mastra } from '@/mastra';
import { db } from '@/db';
import { questions } from '@cogniva/db/schema';
import { auth } from '@/lib/auth';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
  const { sourceDocId, count, types, difficulty } = await req.json();

  const agent = mastra.getAgent('examQuestionGenerator');
  const out = await agent.generate({
    messages: [
      {
        role: 'user',
        content: `Sinh ${count} câu hỏi dạng ${types.join(', ')} độ khó ${difficulty} từ docId=${sourceDocId}. Output JSON array {type, prompt, options?, correctAnswer, explanation, conceptId?, rubric?}.`,
      },
    ],
  });

  const parsed = JSON.parse(out.text) as Array<any>;
  await db.insert(questions).values(
    parsed.map((q, i) => ({
      examId: params.id,
      type: q.type,
      prompt: q.prompt,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      rubric: q.rubric,
      points: q.points ?? 1,
      conceptId: q.conceptId,
      orderIndex: i,
    })),
  );

  return Response.json({ ok: true, count: parsed.length });
}
```

### 16.4. Attempt + grading logic

**`apps/web/src/lib/exam/grade.ts`**

```typescript
/**
 * Grading dispatcher theo question type.
 * MCQ/T-F/Fill-blank: deterministic.
 * Short answer: AI grade via Claude với rubric.
 * Essay/Code/Math: Phase 18.
 */
import { gradeShortAnswer } from './ai-grade';

export async function gradeResponse(question: any, answer: any) {
  switch (question.type) {
    case 'MCQ_SINGLE':
      return {
        isCorrect: answer === question.correctAnswer,
        points: answer === question.correctAnswer ? question.points : 0,
      };

    case 'MCQ_MULTI': {
      const correct = new Set(question.correctAnswer as number[]);
      const submitted = new Set(answer as number[]);
      const allMatch =
        correct.size === submitted.size && [...correct].every((x) => submitted.has(x));
      if (allMatch) return { isCorrect: true, points: question.points };
      if (!question.partialCredit) return { isCorrect: false, points: 0 };
      // Partial credit: TP/total - FP/total
      const tp = [...submitted].filter((x) => correct.has(x)).length;
      const fp = [...submitted].filter((x) => !correct.has(x)).length;
      const score = Math.max(0, (tp - fp) / correct.size) * question.points;
      return { isCorrect: false, points: score };
    }

    case 'TRUE_FALSE':
      return {
        isCorrect: answer === question.correctAnswer,
        points: answer === question.correctAnswer ? question.points : 0,
      };

    case 'FILL_BLANK': {
      const accept: string[] = [question.correctAnswer, ...(question.acceptableAnswers ?? [])];
      const normalized = String(answer).trim().toLowerCase();
      const ok = accept.some((a) => String(a).trim().toLowerCase() === normalized);
      return { isCorrect: ok, points: ok ? question.points : 0 };
    }

    case 'ORDERING': {
      const correct = question.correctAnswer as string[];
      const submitted = answer as string[];
      const ok = correct.length === submitted.length && correct.every((c, i) => c === submitted[i]);
      return { isCorrect: ok, points: ok ? question.points : 0 };
    }

    case 'MATCHING': {
      const correct = question.correctAnswer as Record<string, string>;
      const submitted = answer as Record<string, string>;
      const total = Object.keys(correct).length;
      const matched = Object.entries(correct).filter(([k, v]) => submitted[k] === v).length;
      const score = (matched / total) * question.points;
      return { isCorrect: matched === total, points: score };
    }

    case 'SHORT': {
      const ai = await gradeShortAnswer({
        question: question.prompt,
        studentAnswer: answer,
        modelAnswer: question.correctAnswer,
        rubric: question.rubric,
      });
      return { isCorrect: ai.score >= question.points * 0.5, points: ai.score, aiGrading: ai };
    }

    default:
      throw new Error(`Grading not implemented for ${question.type}`);
  }
}
```

**`apps/web/src/lib/exam/ai-grade.ts`**

```typescript
/**
 * AI grade short answer/essay với Claude + rubric.
 * Output JSON: score, breakdown, feedback, suggestImprovement, confidence.
 */
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function gradeShortAnswer(opts: {
  question: string;
  studentAnswer: string;
  modelAnswer: string;
  rubric: any;
}) {
  const prompt = `Bạn là giáo viên chấm bài. Chấm câu trả lời ngắn sau theo rubric.

CÂU HỎI:
${opts.question}

ĐÁP ÁN MẪU (điểm tối đa):
${opts.modelAnswer}

RUBRIC:
${JSON.stringify(opts.rubric, null, 2)}

TRẢ LỜI CỦA HỌC SINH:
${opts.studentAnswer}

Chấm chặt theo rubric. Output đúng JSON này:
{
  "score": <số, 0 đến max>,
  "maxScore": <số>,
  "breakdown": [{ "criterion": "...", "earned": <số>, "max": <số>, "comment": "..." }],
  "feedback": "<phản hồi xây dựng cho học sinh, tiếng Việt>",
  "suggestImprovement": "<gợi ý cụ thể>",
  "confidence": <0-1>
}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content[0] as any).text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch![0]);
}

export async function gradeEssay(opts: any) {
  // Phase 18 — dùng plagiarism check + 2-stage grading
  return gradeShortAnswer(opts);
}
```

### 16.5. Practice/Timed flow

**`apps/web/src/app/(app)/exams/[examId]/attempt/page.tsx`**

```typescript
/**
 * Trang làm exam — Practice + Timed unified.
 * Practice: hiển thị explanation sau mỗi câu submit.
 * Timed: hidden explanation, countdown global, auto-submit khi 0.
 */
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function AttemptPage({ params }: { params: { examId: string } }) {
  const router = useRouter();
  const [exam, setExam] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [explanation, setExplanation] = useState<any>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/exams/${params.examId}/start`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        setExam(d.exam);
        setQuestions(d.questions);
        if (d.exam.mode === 'TIMED' && d.exam.durationSeconds) {
          setSecondsLeft(d.exam.durationSeconds);
        }
      });
  }, [params.examId]);

  useEffect(() => {
    if (secondsLeft === null) return;
    const t = setInterval(() => {
      setSecondsLeft(s => {
        if (s === null) return null;
        if (s <= 1) {
          clearInterval(t);
          submitExam();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [secondsLeft !== null]);

  const submitAnswer = async () => {
    const q = questions[idx];
    const res = await fetch(`/api/exams/${params.examId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ questionId: q.id, answer: answers[q.id] }),
    }).then(r => r.json());
    if (exam.mode === 'PRACTICE') setExplanation({ ...res, question: q });
  };

  const nextQuestion = () => {
    setExplanation(null);
    setIdx(i => i + 1);
  };

  const submitExam = async () => {
    await fetch(`/api/exams/${params.examId}/finish`, { method: 'POST' });
    router.push(`/exams/${params.examId}/result`);
  };

  if (!exam) return <p>Loading...</p>;
  const q = questions[idx];

  return (
    <div className="mx-auto max-w-2xl p-6 space-y-4">
      <header className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Câu {idx + 1}/{questions.length}</span>
        {secondsLeft !== null && (
          <span className="font-mono text-lg">
            {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}
          </span>
        )}
      </header>

      <h2 className="text-lg font-medium">{q.prompt}</h2>

      {q.type === 'MCQ_SINGLE' && (
        <div className="space-y-2">
          {q.options.map((opt: string, i: number) => (
            <label key={i} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted">
              <input
                type="radio" name="ans" value={i}
                checked={answers[q.id] === i}
                onChange={() => setAnswers(a => ({ ...a, [q.id]: i }))}
              />
              <span>{opt}</span>
            </label>
          ))}
        </div>
      )}

      {q.type === 'SHORT' && (
        <textarea
          value={answers[q.id] ?? ''}
          onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
          className="w-full rounded-md border p-2"
          rows={4}
        />
      )}

      {explanation && (
        <div className={`rounded-md p-3 ${explanation.isCorrect ? 'bg-green-50' : 'bg-red-50'}`}>
          <p className="font-medium">{explanation.isCorrect ? '✓ Đúng' : '✗ Sai'}</p>
          <p className="text-sm mt-1">{q.explanation}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {!explanation && <Button onClick={submitAnswer}>Trả lời</Button>}
        {explanation && idx < questions.length - 1 && <Button onClick={nextQuestion}>Câu tiếp</Button>}
        {(idx === questions.length - 1) && <Button onClick={submitExam}>Nộp bài</Button>}
      </div>
    </div>
  );
}
```

### 16.6. Deliverable

- [ ] Builder UI cho phép thêm 5+ question type thủ công.
- [ ] AI gen 10 câu hỏi từ 1 document trong < 30s.
- [ ] Student làm Practice mode → thấy explanation sau mỗi câu.
- [ ] Timed mode → countdown đếm ngược, auto-submit khi hết.
- [ ] Result page hiển thị điểm + breakdown từng câu.

### 16.7. Acceptance criteria

- [ ] MCQ_SINGLE grade chính xác 100% (test 100 cases).
- [ ] MCQ_MULTI partial credit đúng công thức (TP-FP)/total.
- [ ] SHORT grade qua Claude trả JSON valid 95%+ runs.
- [ ] Resume attempt sau reload page — state còn nguyên (DB-backed).
- [ ] `examAttempts.timeSpentSeconds` chính xác ±2s với thực tế.

### 🔐 Security notes Phase 16

- API `/api/exams/[id]/answer` không trả `correctAnswer` cho client trong TIMED mode.
- `correctAnswer` strip khỏi response trước khi gửi xuống client (sanitize hàm `pickQuestionPublic`).
- `examAttempts.userId` enforce qua RLS hoặc query filter — không trust client.
- Rate limit `/api/exams/[id]/start` (3/min) tránh spam attempt.

---

## Phase 17: Live Exam (Kahoot-style) (Tuần 6)

> **Mục tiêu cuối Phase 17:** Host tạo Live exam → generate 6-digit code → 50 students join URL public → host start → từng câu hiện 30s → leaderboard realtime → final ranking.

### 17.1. Mục tiêu chi tiết

- Mode `LIVE` với `liveCode` 6-char unique generate khi PUBLISH.
- Host control: Start, Next Question, End, Skip.
- Student flow: join code → enter name → wait → answer → see rank → next.
- Real-time leaderboard qua Redis sorted set + Socket.IO broadcast.
- Speed bonus: faster correct answer = more points.
- Animation cuối exam: top-3 podium + share results.

### 17.2. Live exam APIs

**`apps/web/src/app/api/live-exam/[examId]/start/route.ts`**

```typescript
/**
 * Host start exam → mark IN_PROGRESS + broadcast exam:started.
 */
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { exams } from '@cogniva/db/schema';
import { pusherServer } from '@/lib/realtime-server';
import { eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: { examId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });

  const exam = await db.query.exams.findFirst({ where: eq(exams.id, params.examId) });
  if (!exam || exam.ownerId !== session.user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  await db
    .update(exams)
    .set({ status: 'IN_PROGRESS', startedAt: new Date() })
    .where(eq(exams.id, params.examId));

  await pusherServer.trigger(`exam-${params.examId}`, 'exam:started', { timestamp: Date.now() });
  return Response.json({ ok: true });
}
```

**`apps/web/src/app/api/live-exam/[examId]/next-question/route.ts`**

```typescript
/**
 * Host next-question → save state Redis, broadcast (KHÔNG kèm correctAnswer!), schedule timeout.
 */
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { exams } from '@cogniva/db/schema';
import { pusherServer } from '@/lib/realtime-server';
import { redis } from '@/lib/redis';
import { inngest } from '@/inngest/client';
import { eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: { examId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });

  const { questionIndex } = await req.json();
  const exam = await db.query.exams.findFirst({
    where: eq(exams.id, params.examId),
    with: { questions: true },
  });
  if (exam!.ownerId !== session.user.id) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const question = exam!.questions[questionIndex];

  // Public sanitized (KHÔNG có correctAnswer)
  const sanitized = {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    options: question.options,
    timeLimit: question.timeLimit ?? 30,
    points: question.points,
  };

  // Lưu trạng thái server-side
  await redis.set(
    `exam:${params.examId}:current`,
    JSON.stringify({
      questionIndex,
      questionId: question.id,
      startedAt: Date.now(),
      timeLimit: question.timeLimit ?? 30,
      correctAnswer: question.correctAnswer,
    }),
    { EX: (question.timeLimit ?? 30) + 5 },
  );

  await db
    .update(exams)
    .set({ currentQuestionIndex: questionIndex })
    .where(eq(exams.id, params.examId));

  await pusherServer.trigger(`exam-${params.examId}`, 'question:show', sanitized);

  // Schedule timeout → broadcast results
  await inngest.send({
    name: 'exam/question-timeout',
    data: { examId: params.examId, questionId: question.id },
    ts: Date.now() + (question.timeLimit ?? 30) * 1000,
  });

  return Response.json({ ok: true });
}
```

**`apps/web/src/app/api/live-exam/[examId]/answer/route.ts`**

```typescript
/**
 * Student submit answer — check live state, calculate speed bonus, update leaderboard.
 */
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { examResponses, examAttempts } from '@cogniva/db/schema';
import { pusherServer } from '@/lib/realtime-server';
import { redis } from '@/lib/redis';
import { eq, and } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: { examId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });

  const { questionId, answer } = await req.json();
  const stateRaw = await redis.get(`exam:${params.examId}:current`);
  if (!stateRaw) return Response.json({ error: 'No active question' }, { status: 400 });
  const state = JSON.parse(stateRaw);

  if (state.questionId !== questionId) {
    return Response.json({ error: 'Question expired' }, { status: 400 });
  }

  // Duplicate guard — đã trả lời rồi thì không cho submit lại
  const dup = await redis.get(`exam:${params.examId}:answered:${session.user.id}:${questionId}`);
  if (dup) return Response.json({ error: 'Already answered' }, { status: 400 });
  await redis.set(`exam:${params.examId}:answered:${session.user.id}:${questionId}`, '1', {
    EX: 60,
  });

  const responseTime = Date.now() - state.startedAt;
  const isCorrect = JSON.stringify(answer) === JSON.stringify(state.correctAnswer);

  // Speed bonus: nhanh hơn → điểm cao hơn
  const basePoints = 1000;
  const timeBonus = isCorrect ? Math.max(0, 1 - responseTime / (state.timeLimit * 1000)) * 500 : 0;
  const points = isCorrect ? Math.round(basePoints + timeBonus) : 0;

  // Find/create attempt
  let attempt = await db.query.examAttempts.findFirst({
    where: and(eq(examAttempts.examId, params.examId), eq(examAttempts.userId, session.user.id)),
  });
  if (!attempt) {
    [attempt] = await db
      .insert(examAttempts)
      .values({
        examId: params.examId,
        userId: session.user.id,
        status: 'IN_PROGRESS',
      })
      .returning();
  }

  await db.insert(examResponses).values({
    attemptId: attempt.id,
    questionId,
    answer,
    isCorrect,
    responseTimeMs: responseTime,
    pointsEarned: points,
  });

  // Update Redis sorted leaderboard
  await redis.zIncrBy(`exam:${params.examId}:leaderboard`, points, session.user.id);
  const rank = await redis.zRevRank(`exam:${params.examId}:leaderboard`, session.user.id);

  await pusherServer.trigger(`presence-user-${session.user.id}`, 'exam:rank-updated', {
    examId: params.examId,
    rank: (rank ?? 0) + 1,
    points,
  });

  return Response.json({ isCorrect, points, rank: (rank ?? 0) + 1 });
}
```

### 17.3. Question timeout handler

**`apps/web/src/inngest/functions/exam-question-timeout.ts`**

```typescript
/**
 * Khi hết giờ câu hỏi → broadcast results + leaderboard top 10.
 */
import { inngest } from '@/inngest/client';
import { redis } from '@/lib/redis';
import { pusherServer } from '@/lib/realtime-server';
import { db } from '@/db';

export const questionTimeout = inngest.createFunction(
  { id: 'exam-question-timeout' },
  { event: 'exam/question-timeout' },
  async ({ event }) => {
    const { examId, questionId } = event.data as { examId: string; questionId: string };
    const stateRaw = await redis.get(`exam:${examId}:current`);
    if (!stateRaw) return;
    const state = JSON.parse(stateRaw);

    // Tổng hợp stats (số người trả lời mỗi option)
    const stats = await aggregateAnswerStats(examId, questionId);

    // Top 10 leaderboard
    const lbRaw = await redis.zRangeWithScores(`exam:${examId}:leaderboard`, 0, 9, { REV: true });
    const userIds = lbRaw.map((e) => e.value);
    const users = await db.query.user.findMany({
      where: (u, { inArray }) => inArray(u.id, userIds),
    });
    const leaderboard = lbRaw.map((e) => ({
      userId: e.value,
      name: users.find((u) => u.id === e.value)?.name ?? 'Anonymous',
      points: e.score,
    }));

    await pusherServer.trigger(`exam-${examId}`, 'question:results', {
      questionId,
      correctAnswer: state.correctAnswer,
      stats,
      leaderboard,
    });
  },
);
```

### 17.4. Student client UI

**`apps/web/src/app/(public)/live-exam/[code]/page.tsx`**

```typescript
/**
 * Student live exam UI — colored buttons, real-time rank.
 * 4-color Kahoot-style: red, blue, yellow, green.
 */
'use client';
import { useEffect, useState } from 'react';
import { pusher } from '@/lib/realtime';
import { cn } from '@/lib/utils';

type Phase = 'waiting' | 'question' | 'results' | 'ended';

export default function LiveExamPage({ params }: { params: { code: string } }) {
  const [examId, setExamId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [question, setQuestion] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [hasAnswered, setHasAnswered] = useState(false);

  // Join by code → resolve to examId
  useEffect(() => {
    fetch('/api/live-exam/join', { method: 'POST', body: JSON.stringify({ code: params.code }) })
      .then(r => r.json()).then(d => setExamId(d.examId));
  }, [params.code]);

  useEffect(() => {
    if (!examId) return;
    const channel = pusher.subscribe(`exam-${examId}`);
    channel.bind('exam:started', () => setPhase('waiting'));
    channel.bind('question:show', (data: any) => {
      setQuestion(data); setTimeLeft(data.timeLimit); setHasAnswered(false); setPhase('question');
    });
    channel.bind('question:results', (data: any) => {
      setLeaderboard(data.leaderboard); setPhase('results');
    });
    channel.bind('exam:ended', () => setPhase('ended'));
    return () => { pusher.unsubscribe(`exam-${examId}`); };
  }, [examId]);

  useEffect(() => {
    if (phase !== 'question') return;
    const t = setInterval(() => setTimeLeft(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const submit = async (answer: number) => {
    if (hasAnswered) return;
    setHasAnswered(true);
    const res = await fetch(`/api/live-exam/${examId}/answer`, {
      method: 'POST',
      body: JSON.stringify({ questionId: question.id, answer }),
    }).then(r => r.json());
    setMyRank(res.rank);
  };

  if (phase === 'question' && question) {
    return (
      <div className="min-h-screen flex flex-col">
        <div className="bg-card p-4 shadow flex items-center justify-between">
          <span className="font-mono text-2xl">{timeLeft}s</span>
          <h1 className="text-xl font-medium">{question.prompt}</h1>
        </div>
        <div className="grid grid-cols-2 gap-4 p-4 flex-1">
          {(question.options as string[]).map((opt, i) => (
            <button
              key={i}
              disabled={hasAnswered}
              onClick={() => submit(i)}
              className={cn(
                'rounded-2xl text-2xl font-medium text-white transition-all hover:scale-105 disabled:opacity-50',
                ['bg-red-500', 'bg-blue-500', 'bg-yellow-500', 'bg-green-500'][i],
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (phase === 'results') {
    return (
      <div className="min-h-screen p-6 mx-auto max-w-xl">
        <h2 className="text-2xl font-semibold mb-4">Bảng xếp hạng</h2>
        <ul className="space-y-2">
          {leaderboard.map((e, i) => (
            <li key={e.userId} className="flex justify-between rounded-md border p-3">
              <span>#{i + 1} {e.name}</span>
              <span className="font-mono">{e.points} pts</span>
            </li>
          ))}
        </ul>
        {myRank !== null && <p className="mt-4">Hạng của bạn: <strong>#{myRank}</strong></p>}
      </div>
    );
  }

  return <p className="p-6">Chờ host bắt đầu...</p>;
}
```

### 17.5. Deliverable

- [ ] Host UI: Start, Next, End, hiển thị # đã join.
- [ ] Student join qua code 6-char, không cần đăng ký (guest mode optional).
- [ ] Câu hỏi đếm ngược 30s đồng bộ giữa 50 client (lệch < 2s).
- [ ] Leaderboard top 10 update sau mỗi câu.
- [ ] Final podium animation top 3.

### 17.6. Acceptance criteria

- [ ] 50 student concurrent join cùng exam, latency P95 < 500ms.
- [ ] Duplicate submit cùng câu → reject 400.
- [ ] Submit sau hết giờ → reject "Question expired".
- [ ] Redis crash → exam vẫn complete (graceful degrade, leaderboard rebuild từ examResponses).
- [ ] Speed bonus chính xác: trả đúng ở 1s đầu = 1500pts, 30s = 1000pts.

### 🔐 Security notes Phase 17

- `correctAnswer` luôn server-side, KHÔNG bao giờ gửi cho student trước khi hết giờ.
- Sanitize question với hàm `pickQuestionPublic({ id, type, prompt, options, timeLimit, points })`.
- Anti-spam: rate limit 1 answer/user/question.
- `joinCode` lookup phải có check `exam.status === 'PUBLISHED'` hoặc `'IN_PROGRESS'`.
- IP fingerprint cho live exam guest mode (chống multi-account).

### 17.7. Tournament mode (bracket elimination)

Mode `TOURNAMENT` — N user (power of 2) đấu 1v1 theo vòng cho tới chung kết.

**Schema delta:**

```typescript
/**
 * Bảng phụ cho tournament: bracket tree + match state.
 * matchId = `${examId}-r${round}-m${matchIndex}`.
 */
export const tournamentMatches = pgTable('tournament_matches', {
  id: text('id').primaryKey(),
  examId: text('exam_id')
    .notNull()
    .references(() => exams.id, { onDelete: 'cascade' }),
  round: integer('round').notNull(), // 1 = round of N, log2(N) = final
  matchIndex: integer('match_index').notNull(),
  player1Id: text('player1_id'),
  player2Id: text('player2_id'),
  winnerId: text('winner_id'),
  player1Score: real('player1_score'),
  player2Score: real('player2_score'),
  status: text('status').notNull().default('PENDING'), // PENDING | ACTIVE | DONE
  questionId: text('question_id'), // câu được dùng cho match này
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
});
```

**`apps/web/src/lib/exam/tournament.ts`**

```typescript
/**
 * Tournament bracket logic.
 * Seed: random shuffle hoặc theo Elo rating (V2).
 * Round 1: N/2 match, winner advance round 2…
 */
export function buildBracket(
  playerIds: string[],
): { round: number; matchIndex: number; p1: string | null; p2: string | null }[] {
  // Pad lên power of 2 với 'BYE'
  const n = playerIds.length;
  const target = Math.pow(2, Math.ceil(Math.log2(n)));
  const padded = [...playerIds];
  while (padded.length < target) padded.push('BYE');
  // Shuffle Fisher-Yates
  for (let i = padded.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [padded[i], padded[j]] = [padded[j]!, padded[i]!];
  }
  // Round 1 matches
  const matches = [];
  for (let i = 0; i < padded.length; i += 2) {
    matches.push({
      round: 1,
      matchIndex: i / 2,
      p1: padded[i] === 'BYE' ? null : padded[i]!,
      p2: padded[i + 1] === 'BYE' ? null : padded[i + 1]!,
    });
  }
  return matches;
}

/**
 * Sau khi match xong, advance winner tới match round kế.
 * Bracket binary tree: round R match M → round R+1 match floor(M/2).
 */
export function advanceWinner(
  round: number,
  matchIndex: number,
): { nextRound: number; nextMatchIndex: number; slot: 'p1' | 'p2' } {
  return {
    nextRound: round + 1,
    nextMatchIndex: Math.floor(matchIndex / 2),
    slot: matchIndex % 2 === 0 ? 'p1' : 'p2',
  };
}
```

**`apps/web/src/app/api/tournament/[examId]/start/route.ts`**

```typescript
/**
 * Host start tournament — build bracket, insert round 1 matches, broadcast bracket.
 */
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { exams, examAttempts, tournamentMatches } from '@cogniva/db/schema';
import { buildBracket } from '@/lib/exam/tournament';
import { pusherServer } from '@/lib/realtime-server';
import { eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: { examId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });

  const exam = await db.query.exams.findFirst({ where: eq(exams.id, params.examId) });
  if (exam!.ownerId !== session.user.id)
    return Response.json({ error: 'Forbidden' }, { status: 403 });

  // Lấy danh sách đã join (qua examAttempts với status WAITING)
  const players = await db.query.examAttempts.findMany({
    where: eq(examAttempts.examId, params.examId),
  });
  const playerIds = players.map((p) => p.userId);

  const bracket = buildBracket(playerIds);
  await db.insert(tournamentMatches).values(
    bracket.map((m) => ({
      id: `${params.examId}-r${m.round}-m${m.matchIndex}`,
      examId: params.examId,
      round: m.round,
      matchIndex: m.matchIndex,
      player1Id: m.p1,
      player2Id: m.p2,
      status: m.p1 && m.p2 ? ('ACTIVE' as const) : ('DONE' as const),
      winnerId: !m.p2 ? m.p1 : !m.p1 ? m.p2 : null, // BYE = auto win
    })),
  );

  await pusherServer.trigger(`tournament-${params.examId}`, 'tournament:started', { bracket });
  return Response.json({ ok: true, bracket });
}
```

**`apps/web/src/components/exam/tournament-bracket.tsx`**

```typescript
/**
 * Visualize bracket — render columns mỗi round, lines giữa các match.
 * SVG-based để dễ scale + animation winner highlight.
 */
'use client';
import { useEffect, useState } from 'react';
import { pusher } from '@/lib/realtime';

type Match = { id: string; round: number; matchIndex: number; player1Id: string | null; player2Id: string | null; winnerId: string | null; status: string };

export function TournamentBracket({ examId, initialMatches }: { examId: string; initialMatches: Match[] }) {
  const [matches, setMatches] = useState<Match[]>(initialMatches);

  useEffect(() => {
    const ch = pusher.subscribe(`tournament-${examId}`);
    ch.bind('match:complete', (data: { match: Match; advanced?: Match }) => {
      setMatches(prev => prev.map(m => m.id === data.match.id ? data.match : (data.advanced && m.id === data.advanced.id ? data.advanced : m)));
    });
    return () => { pusher.unsubscribe(`tournament-${examId}`); };
  }, [examId]);

  const rounds = Array.from(new Set(matches.map(m => m.round))).sort();

  return (
    <div className="flex gap-8 overflow-x-auto p-6">
      {rounds.map(r => (
        <div key={r} className="flex flex-col gap-4 min-w-[200px]">
          <h3 className="text-sm font-semibold">Round {r}</h3>
          {matches.filter(m => m.round === r).map(m => (
            <div key={m.id} className="rounded-md border bg-card p-2 space-y-1 text-xs">
              <div className={m.winnerId === m.player1Id ? 'font-bold text-primary' : ''}>
                {m.player1Id ?? '— BYE —'}
              </div>
              <div className="border-t my-1" />
              <div className={m.winnerId === m.player2Id ? 'font-bold text-primary' : ''}>
                {m.player2Id ?? '— BYE —'}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

---

## Phase 18: Adaptive Testing + AI Grading (Tuần 7)

> **Mục tiêu cuối Phase 18:** Mode `ADAPTIVE` chọn câu hỏi tiếp theo dựa IRT 3PL, hội tụ ability estimate sau ~15 câu. Essay/Code/Math auto-grade qua Claude + Docker sandbox.

### 18.1. Mục tiêu chi tiết

- Implement Item Response Theory 3-Parameter Logistic (3PL).
- Newton-Raphson estimate theta sau mỗi response.
- Pick next question maximizing Fisher information.
- Stop rule: minQ ≥ 10, maxQ ≤ 30, SE ≤ targetSE (default 0.3).
- AI grade essay với 2-stage (rubric grade + plagiarism check).
- Code grading: Docker isolation, run test cases, AI feedback on failures.

### 18.2. IRT module

**`apps/web/src/lib/exam/cat.ts`**

```typescript
/**
 * Computerized Adaptive Testing (CAT) dùng IRT 3PL.
 * - probabilityOfCorrect: P(correct|theta, item)
 * - information: Fisher info — đo lường lượng thông tin item đóng góp tại theta
 * - estimateTheta: Newton-Raphson MLE
 * - pickNextQuestion: greedy max-info
 * - shouldStop: SE threshold + bounds
 */
export interface IRTQuestion {
  id: string;
  difficulty: number; // -3..+3
  discrimination: number; // 0.5..2.5
  guessing: number; // 0 cho short, 0.25 cho MCQ 4 options
}

export function probabilityOfCorrect(theta: number, q: IRTQuestion): number {
  const exp = Math.exp(q.discrimination * (theta - q.difficulty));
  return q.guessing + (1 - q.guessing) * (exp / (1 + exp));
}

export function information(theta: number, q: IRTQuestion): number {
  const p = probabilityOfCorrect(theta, q);
  const num = q.discrimination ** 2 * (p - q.guessing) ** 2;
  const den = (1 - q.guessing) ** 2 * p * (1 - p);
  return num / den;
}

export function estimateTheta(responses: { question: IRTQuestion; correct: boolean }[]): number {
  let theta = 0;
  for (let iter = 0; iter < 20; iter++) {
    let d1 = 0,
      d2 = 0;
    for (const { question, correct } of responses) {
      const p = probabilityOfCorrect(theta, question);
      const factor = (correct ? 1 : 0) - p;
      d1 += question.discrimination * factor;
      d2 -= question.discrimination ** 2 * p * (1 - p);
    }
    if (Math.abs(d2) < 1e-10) break;
    const delta = d1 / d2;
    theta -= delta;
    if (Math.abs(delta) < 0.01) break;
  }
  return Math.max(-4, Math.min(4, theta));
}

export function standardError(
  theta: number,
  responses: { question: IRTQuestion; correct: boolean }[],
): number {
  const totalInfo = responses.reduce((s, r) => s + information(theta, r.question), 0);
  return totalInfo > 0 ? 1 / Math.sqrt(totalInfo) : Infinity;
}

export function pickNextQuestion(
  pool: IRTQuestion[],
  responses: { question: IRTQuestion; correct: boolean }[],
  excludeIds: string[],
): IRTQuestion {
  const theta = estimateTheta(responses);
  return pool
    .filter((q) => !excludeIds.includes(q.id))
    .map((q) => ({ q, info: information(theta, q) }))
    .sort((a, b) => b.info - a.info)[0].q;
}

export function shouldStop(
  responses: { question: IRTQuestion; correct: boolean }[],
  opts: { minQuestions: number; maxQuestions: number; targetSE: number },
): boolean {
  if (responses.length < opts.minQuestions) return false;
  if (responses.length >= opts.maxQuestions) return true;
  const theta = estimateTheta(responses);
  return standardError(theta, responses) <= opts.targetSE;
}

export function thetaToScore(theta: number, scale = 100): number {
  // Mapping theta [-4, 4] → [0, 100] qua sigmoid
  return Math.round((1 / (1 + Math.exp(-theta))) * scale);
}
```

**`apps/web/src/lib/exam/cat.test.ts`** (unit tests)

```typescript
import { describe, it, expect } from 'vitest';
import { probabilityOfCorrect, estimateTheta, pickNextQuestion, shouldStop } from './cat';

describe('IRT 3PL', () => {
  it('P(correct) = guessing khi theta = -∞', () => {
    expect(
      probabilityOfCorrect(-10, { id: 'q', difficulty: 0, discrimination: 1, guessing: 0.25 }),
    ).toBeCloseTo(0.25, 2);
  });
  it('P(correct) → 1 khi theta = +∞', () => {
    expect(
      probabilityOfCorrect(10, { id: 'q', difficulty: 0, discrimination: 1, guessing: 0.25 }),
    ).toBeCloseTo(1, 2);
  });
  it('estimateTheta hội tụ với 10 response', () => {
    const responses = Array.from({ length: 10 }, (_, i) => ({
      question: { id: `q${i}`, difficulty: i * 0.3 - 1.5, discrimination: 1, guessing: 0 },
      correct: i < 7,
    }));
    const theta = estimateTheta(responses);
    expect(theta).toBeGreaterThan(0);
    expect(theta).toBeLessThan(2);
  });
});
```

### 18.3. Adaptive endpoint

**`apps/web/src/app/api/adaptive-exam/[examId]/next/route.ts`**

```typescript
/**
 * POST /api/adaptive-exam/[examId]/next — submit previous response, get next question hoặc done.
 */
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { examAttempts, examResponses, questions } from '@cogniva/db/schema';
import {
  pickNextQuestion,
  shouldStop,
  estimateTheta,
  standardError,
  thetaToScore,
} from '@/lib/exam/cat';
import { gradeResponse } from '@/lib/exam/grade';
import { and, eq } from 'drizzle-orm';

export async function POST(req: Request, { params }: { params: { examId: string } }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
  const { previousResponse } = await req.json();

  let attempt = await db.query.examAttempts.findFirst({
    where: and(
      eq(examAttempts.examId, params.examId),
      eq(examAttempts.userId, session.user.id),
      eq(examAttempts.status, 'IN_PROGRESS'),
    ),
  });
  if (!attempt) {
    [attempt] = await db
      .insert(examAttempts)
      .values({
        examId: params.examId,
        userId: session.user.id,
        status: 'IN_PROGRESS',
      })
      .returning();
  }

  if (previousResponse) {
    const q = await db.query.questions.findFirst({
      where: eq(questions.id, previousResponse.questionId),
    });
    const grading = await gradeResponse(q, previousResponse.answer);
    await db.insert(examResponses).values({
      attemptId: attempt.id,
      questionId: previousResponse.questionId,
      answer: previousResponse.answer,
      isCorrect: grading.isCorrect,
      pointsEarned: grading.points,
      aiGrading: grading.aiGrading,
    });
  }

  const responses = await db.query.examResponses.findMany({
    where: eq(examResponses.attemptId, attempt.id),
    with: { question: true },
  });

  const exam = await db.query.exams.findFirst({ where: eq(exams.id, params.examId) });

  if (
    shouldStop(
      responses.map((r) => ({ question: r.question as any, correct: r.isCorrect ?? false })),
      {
        minQuestions: exam!.minQuestions ?? 10,
        maxQuestions: exam!.maxQuestions ?? 30,
        targetSE: exam!.targetSE ?? 0.3,
      },
    )
  ) {
    const finalTheta = estimateTheta(
      responses.map((r) => ({ question: r.question as any, correct: r.isCorrect ?? false })),
    );
    const se = standardError(
      finalTheta,
      responses.map((r) => ({ question: r.question as any, correct: r.isCorrect ?? false })),
    );
    const score = thetaToScore(finalTheta);
    await db
      .update(examAttempts)
      .set({
        status: 'SUBMITTED',
        submittedAt: new Date(),
        estimatedTheta: finalTheta,
        thetaSE: se,
        score,
        percentage: score,
      })
      .where(eq(examAttempts.id, attempt.id));
    return Response.json({ done: true, score, theta: finalTheta, se });
  }

  const pool = await db.query.questions.findMany({ where: eq(questions.examId, params.examId) });
  const next = pickNextQuestion(
    pool as any,
    responses.map((r) => ({ question: r.question as any, correct: r.isCorrect ?? false })),
    responses.map((r) => r.questionId),
  );

  return Response.json({
    question: {
      id: next.id,
      type: (next as any).type,
      prompt: (next as any).prompt,
      options: (next as any).options,
    },
    progress: { answered: responses.length },
  });
}
```

### 18.4. Code grading sandbox

**`apps/web/src/lib/exam/code-grade.ts`**

```typescript
/**
 * Code grading — chạy student code trong Docker sandbox.
 * Sandbox: --memory=256m --cpus=1 --network=none, image pre-built `cogniva/sandbox-<lang>`.
 * Test case format: { id, input, expectedOutput }.
 */
import { spawn } from 'child_process';
import { mastra } from '@/mastra';

export interface TestCase {
  id: string;
  input: string;
  expectedOutput: string;
}

export async function gradeCode(opts: {
  language: 'python' | 'javascript' | 'cpp' | 'java';
  studentCode: string;
  testCases: TestCase[];
  timeLimit?: number;
  memoryLimit?: number;
}) {
  const timeLimit = opts.timeLimit ?? 5000;
  const memoryLimit = opts.memoryLimit ?? 256;
  const results = [];

  for (const test of opts.testCases) {
    const result = await runInSandbox({
      language: opts.language,
      code: opts.studentCode,
      stdin: test.input,
      timeLimit,
      memoryLimit,
    });
    const passed =
      !result.error &&
      result.exitCode === 0 &&
      normalize(result.stdout) === normalize(test.expectedOutput);
    results.push({
      testCaseId: test.id,
      passed,
      actualOutput: result.stdout,
      expectedOutput: test.expectedOutput,
      executionTime: result.duration,
      error: result.error,
    });
  }

  const passed = results.filter((r) => r.passed).length;
  const score = (passed / results.length) * 100;

  let aiFeedback = null;
  if (passed < results.length) {
    const agent = mastra.getAgent('codeReviewer');
    const out = await agent.generate({
      messages: [
        {
          role: 'user',
          content: `Review code ${opts.language} sau, giải thích vì sao fail test cases:\n${opts.studentCode}\n\nFailed:\n${JSON.stringify(
            results.filter((r) => !r.passed),
            null,
            2,
          )}`,
        },
      ],
    });
    aiFeedback = out.text;
  }

  return { results, score, passed, total: results.length, aiFeedback };
}

function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').replace(/\r\n/g, '\n');
}

async function runInSandbox(opts: any): Promise<any> {
  return new Promise((resolve) => {
    const start = Date.now();
    const proc = spawn('docker', [
      'run',
      '--rm',
      '-i',
      `--memory=${opts.memoryLimit}m`,
      '--cpus=1',
      '--network=none',
      `cogniva/sandbox-${opts.language}`,
    ]);
    let stdout = '',
      stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d;
    });
    proc.stderr.on('data', (d) => {
      stderr += d;
    });
    proc.stdin.write(opts.code + '\n---INPUT---\n' + opts.stdin);
    proc.stdin.end();
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      resolve({ error: 'TIMEOUT', duration: opts.timeLimit });
    }, opts.timeLimit);
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr, duration: Date.now() - start });
    });
  });
}
```

**`infrastructure/sandbox/Dockerfile.python`**

```dockerfile
# Minimal Python 3.12 sandbox — no network, restricted user
FROM python:3.12-alpine
RUN adduser -D sandbox
USER sandbox
WORKDIR /sandbox
CMD ["python", "-c", "import sys; code, stdin = sys.stdin.read().split('---INPUT---'); exec(compile(code, '<student>', 'exec'), {'__builtins__': __builtins__, 'input': lambda: stdin.split('\\n').pop(0)})"]
```

### 18.5. Essay grade with plagiarism check

**`apps/web/src/lib/exam/essay-grade.ts`**

```typescript
/**
 * Essay grade 2 stage: AI rubric grade + plagiarism vs corpus.
 * Flag review nếu confidence < 0.7 hoặc plagiarism > 30%.
 */
import { gradeShortAnswer } from './ai-grade';
import { checkPlagiarism } from './plagiarism';

export async function gradeEssay(opts: {
  prompt: string;
  studentEssay: string;
  rubric: any;
  wordLimit?: number;
}) {
  const [grade, plag] = await Promise.all([
    gradeShortAnswer({
      question: opts.prompt,
      studentAnswer: opts.studentEssay,
      modelAnswer: '',
      rubric: opts.rubric,
    }),
    checkPlagiarism(opts.studentEssay),
  ]);

  const needsReview = grade.confidence < 0.7 || plag.matchPercent > 30;
  return { ...grade, plagiarism: plag, needsReview };
}
```

**`apps/web/src/lib/exam/plagiarism.ts`**

```typescript
/**
 * Plagiarism check — cosine similarity vs corpus (existing essays + user's own docs).
 * Phase 18 v1: chỉ check trong-app; V2 wire Copyleaks/Turnitin nếu cần.
 */
import { embed } from '@/lib/ai/embed';
import { db } from '@/db';
import { sql } from 'drizzle-orm';

export async function checkPlagiarism(text: string) {
  const embedding = await embed(text);
  // Top 5 essay tương tự nhất trong DB (giả định bảng essays có vector column)
  const matches = await db.execute(sql`
    SELECT id, content, 1 - (embedding <=> ${embedding}::vector) as sim
    FROM essays
    WHERE 1 - (embedding <=> ${embedding}::vector) > 0.85
    ORDER BY sim DESC
    LIMIT 5
  `);
  const matchPercent =
    matches.rows.length > 0 ? Math.max(...matches.rows.map((r: any) => r.sim)) * 100 : 0;
  return { matchPercent, matches: matches.rows };
}
```

### 18.6. Deliverable

- [ ] Adaptive exam mở → câu 1 trung bình → trả đúng → câu khó hơn → trả sai → câu dễ hơn.
- [ ] Sau 15 câu, SE ≤ 0.3, exam tự kết thúc.
- [ ] Essay submit → AI grade trong < 10s, có breakdown rubric.
- [ ] Code question Python → chạy 5 test case trong 30s, hiển thị diff fail.
- [ ] Plagiarism > 85% similarity → flag.

### 18.7. Acceptance criteria

- [ ] Unit test `cat.test.ts` pass 100% (Vitest).
- [ ] Theta hội tụ trong 15 câu cho student ability ±2 SD (simulation test).
- [ ] Pick max info — không lặp câu cùng difficulty 3 lần liên tiếp.
- [ ] Docker sandbox không thoát ra host (test `rm -rf /` trong sandbox không ảnh hưởng).
- [ ] AI grade essay returns valid JSON 95%+ runs.

### 🔐 Security notes Phase 18

- Docker sandbox bắt buộc `--network=none` và non-root user.
- Memory/CPU limit cứng — kill khi exceed.
- Code injection trong stdin → sandbox isolated, không exfil được data.
- Plagiarism check không leak essay người khác (chỉ trả % + ID, không trả content).

---

## Phase 19: Anti-cheat + Production Polish (Tuần 8)

> **Mục tiêu cuối Phase 19:** 10+ anti-cheat detection (tab focus, copy-paste, devtools, fullscreen, webcam proctor). Test coverage Vitest + Playwright + k6 load test. Production checklist xong.

### 19.1. Mục tiêu chi tiết

- Client-side proctoring hook (10 detection methods).
- Optional webcam proctoring qua MediaPipe (chạy local, privacy-friendly).
- Cheat risk score aggregation → flag attempt.
- Plagiarism + AI text detection cho essay.
- Item analysis dashboard: difficulty, discrimination, Cronbach's alpha.
- Test strategy: unit (Vitest) + E2E (Playwright) + load (k6).
- Production checklist 18 items.

### 19.2. Proctoring hook

**`apps/web/src/hooks/use-exam-proctoring.ts`**

```typescript
/**
 * Proctoring hook — gắn vào trang làm exam.
 * 10 detection: fullscreen, tab visibility, window blur, contextmenu,
 * clipboard, devtools heuristic, multi-monitor, fingerprint, heartbeat, shortcuts.
 * Sau 3 violation `high` → auto-submit & flag.
 */
'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

export type Severity = 'low' | 'medium' | 'high';
export interface Violation {
  type: string;
  severity: Severity;
  timestamp: number;
  metadata?: any;
}
export interface ProctoringSettings {
  requireFullscreen?: boolean;
  blockCopyPaste?: boolean;
  blockContextMenu?: boolean;
  detectDevtools?: boolean;
}

export function useExamProctoring(
  examId: string,
  settings: ProctoringSettings,
  onAutoSubmit: (reason: string) => void,
) {
  const violations = useRef<Violation[]>([]);
  const warningCount = useRef(0);
  const router = useRouter();

  useEffect(() => {
    const record = (type: string, severity: Severity, extra: any = {}) => {
      const v: Violation = { type, severity, timestamp: Date.now(), metadata: extra };
      violations.current.push(v);
      if (severity === 'high') {
        navigator.sendBeacon('/api/exam/violation', JSON.stringify({ examId, violation: v }));
        warningCount.current++;
        if (warningCount.current >= 3) onAutoSubmit('FLAGGED_CHEATING');
      }
    };

    // 1. Fullscreen
    if (settings.requireFullscreen) {
      document.documentElement.requestFullscreen().catch(() => record('FULLSCREEN_DENIED', 'high'));
      const onFs = () => {
        if (!document.fullscreenElement) record('EXITED_FULLSCREEN', 'high');
      };
      document.addEventListener('fullscreenchange', onFs);
    }

    // 2. Tab visibility
    let hiddenStart = 0;
    const onVis = () => {
      if (document.hidden) {
        hiddenStart = Date.now();
        record('TAB_HIDDEN', 'medium');
      } else if (hiddenStart > 0) {
        const dur = Date.now() - hiddenStart;
        record('TAB_RETURNED', dur > 10000 ? 'medium' : 'low', { hiddenDurationMs: dur });
      }
    };
    document.addEventListener('visibilitychange', onVis);

    // 3. Window blur
    let blurStart = 0;
    const onBlur = () => {
      blurStart = Date.now();
      record('WINDOW_BLUR', 'medium');
    };
    const onFocus = () => {
      if (blurStart > 0) record('WINDOW_FOCUS', 'low', { blurDurationMs: Date.now() - blurStart });
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);

    // 4. Context menu
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      record('CONTEXT_MENU', 'low');
    };
    if (settings.blockContextMenu) document.addEventListener('contextmenu', onCtx);

    // 5. Clipboard
    const onClip = (e: ClipboardEvent) => {
      e.preventDefault();
      record(`CLIPBOARD_${e.type.toUpperCase()}`, 'medium');
    };
    if (settings.blockCopyPaste) {
      document.addEventListener('copy', onClip);
      document.addEventListener('cut', onClip);
      document.addEventListener('paste', onClip);
    }

    // 6. Devtools (heuristic — không 100% reliable)
    const devtoolsTimer = setInterval(() => {
      if (
        window.outerWidth - window.innerWidth > 200 ||
        window.outerHeight - window.innerHeight > 200
      ) {
        record('DEVTOOLS_SUSPECTED', 'high');
      }
    }, 1000);

    // 7. Multi-monitor
    if (window.screen.availWidth > 3000) record('MULTIPLE_MONITORS_DETECTED', 'low');

    // 8. Browser fingerprint
    captureFingerprint().then((fp) => {
      navigator.sendBeacon('/api/exam/fingerprint', JSON.stringify({ examId, fingerprint: fp }));
    });

    // 9. Heartbeat
    const hbTimer = setInterval(() => {
      navigator.sendBeacon(
        '/api/exam/heartbeat',
        JSON.stringify({
          examId,
          timestamp: Date.now(),
          violationCount: violations.current.length,
        }),
      );
    }, 5000);

    // 10. Shortcuts
    const onKey = (e: KeyboardEvent) => {
      const isCtrlBlocked = e.ctrlKey && ['c', 'v', 'p', 'u', 's'].includes(e.key.toLowerCase());
      const isDevtoolsShortcut =
        e.key === 'F12' || (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key));
      if (isCtrlBlocked || isDevtoolsShortcut) {
        e.preventDefault();
        record('SHORTCUT_BLOCKED', 'low', { key: e.key });
      }
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('contextmenu', onCtx);
      document.removeEventListener('copy', onClip);
      document.removeEventListener('cut', onClip);
      document.removeEventListener('paste', onClip);
      document.removeEventListener('keydown', onKey);
      clearInterval(devtoolsTimer);
      clearInterval(hbTimer);
    };
  }, [examId, settings, onAutoSubmit, router]);

  return { violations: violations.current, warningCount: warningCount.current };
}

async function captureFingerprint(): Promise<string> {
  // Lightweight fingerprint — user agent + screen + timezone + canvas
  const parts = [
    navigator.userAgent,
    `${screen.width}x${screen.height}`,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    canvasFingerprint(),
  ];
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function canvasFingerprint(): string {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillText('cogniva-fp-2026', 2, 2);
  return c.toDataURL().slice(-50);
}
```

### 19.3. Webcam proctoring (optional, opt-in)

**`apps/web/src/hooks/use-webcam-proctoring.ts`**

```typescript
/**
 * Webcam proctoring với MediaPipe Tasks Vision — chạy local, không upload frame.
 * Chỉ snapshot occasional (5% chance/check) upload để human review.
 * User PHẢI opt-in explicit.
 */
'use client';
import { useEffect, useRef, useState } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

export function useWebcamProctoring(examId: string) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [violations, setViolations] = useState<any[]>([]);

  useEffect(() => {
    let detector: FaceDetector | null = null;
    let stream: MediaStream | null = null;
    let timer: number | null = null;

    async function init() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm',
      );
      detector = await FaceDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
        },
        runningMode: 'VIDEO',
      });
      timer = window.setInterval(check, 2000);
    }

    function check() {
      if (!detector || !videoRef.current) return;
      const result = detector.detectForVideo(videoRef.current, performance.now());
      const faces = result.detections.length;
      if (faces === 0) record('NO_FACE_DETECTED', 'medium');
      else if (faces > 1) record('MULTIPLE_FACES', 'high');
      if (Math.random() < 0.05) snapshotAndUpload();
    }

    function record(type: string, severity: 'low' | 'medium' | 'high') {
      const v = { type, severity, timestamp: Date.now() };
      setViolations((prev) => [...prev, v]);
      navigator.sendBeacon('/api/exam/violation', JSON.stringify({ examId, violation: v }));
    }

    async function snapshotAndUpload() {
      const video = videoRef.current;
      if (!video) return;
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d')!.drawImage(video, 0, 0);
      c.toBlob(
        (blob) => {
          if (!blob) return;
          const fd = new FormData();
          fd.append('snapshot', blob);
          fd.append('examId', examId);
          fetch('/api/exam/proctor-snapshot', { method: 'POST', body: fd });
        },
        'image/jpeg',
        0.6,
      );
    }

    init();
    return () => {
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      detector?.close();
    };
  }, [examId]);

  return { videoRef, violations };
}
```

### 19.4. Cheat risk aggregation

**`apps/web/src/lib/exam/cheat-risk.ts`**

```typescript
/**
 * Tính cheat risk score 0-100 từ violations.
 * Weight: high=10, medium=3, low=1.
 * >50 = flag, >75 = auto disqualify.
 */
const WEIGHTS = { high: 10, medium: 3, low: 1 } as const;

export function calcCheatRiskScore(violations: { severity: keyof typeof WEIGHTS }[]): number {
  const sum = violations.reduce((s, v) => s + WEIGHTS[v.severity], 0);
  return Math.min(100, sum);
}

export function shouldFlag(score: number): boolean {
  return score >= 50;
}
export function shouldDisqualify(score: number): boolean {
  return score >= 75;
}
```

### 19.5. Item analysis dashboard

Classical Test Theory metrics + IRT calibration. Output 4 chỉ số chính cho mỗi câu hỏi.

**`apps/web/src/lib/exam/item-analysis.ts`**

```typescript
/**
 * Item analysis — Classical Test Theory.
 *
 * Per-question metrics:
 *   1. Difficulty (p-value) = % student trả đúng. Tốt: 0.3-0.8.
 *      < 0.3 = quá khó (revise). > 0.8 = quá dễ (revise/drop).
 *   2. Discrimination = correlation giữa "đúng câu này" và "điểm tổng".
 *      Dùng point-biserial correlation (rpb).
 *      Tốt: rpb > 0.3. < 0.15 = câu hỏi không phân biệt được giỏi/yếu (drop).
 *      Âm = nghi câu lỗi (đúng đáp án ngược).
 *   3. Distractor analysis (cho MCQ): % student chọn mỗi option.
 *      Distractor "tốt" = ≥ 5% chọn. Option 0% = wasted.
 *
 * Exam-level metric:
 *   4. Cronbach's α = reliability. Tốt: > 0.7. < 0.5 = exam không nhất quán.
 *      α = (n/(n-1)) * (1 - Σσi² / σtotal²)
 *
 * Tham khảo: Anastasi & Urbina, "Psychological Testing" 7th ed.
 */

export interface QuestionStat {
  questionId: string;
  prompt: string;
  difficulty: number; // 0..1
  discrimination: number; // -1..1 (typically -0.3..0.7)
  attempts: number;
  distractors?: Record<string, number>; // option → % chosen
  flag: 'too_easy' | 'too_hard' | 'low_discrimination' | 'negative_discrimination' | 'ok';
}

/**
 * Point-biserial correlation = rpb.
 * Công thức: rpb = ((M+ - M-) / SDtotal) * sqrt(p * (1-p))
 *   M+ = mean total score của nhóm trả đúng câu này
 *   M- = mean total score của nhóm trả sai
 *   p  = proportion trả đúng (= difficulty)
 *   SDtotal = std deviation của total score
 */
export function pointBiserial(correctScores: number[], incorrectScores: number[]): number {
  const all = [...correctScores, ...incorrectScores];
  if (all.length < 2) return 0;
  const p = correctScores.length / all.length;
  if (p === 0 || p === 1) return 0;

  const mPlus = mean(correctScores);
  const mMinus = mean(incorrectScores);
  const sdTotal = stdDev(all);
  if (sdTotal === 0) return 0;

  return ((mPlus - mMinus) / sdTotal) * Math.sqrt(p * (1 - p));
}

/**
 * Cronbach's α — exam reliability.
 * - itemScoresPerAttempt: matrix [attempt][item] (0 hoặc 1 nếu MCQ; số nếu partial).
 */
export function cronbachAlpha(itemScoresPerAttempt: number[][]): number {
  const n = itemScoresPerAttempt[0]?.length ?? 0;
  if (n < 2 || itemScoresPerAttempt.length < 2) return 0;

  // Variance của mỗi item
  const itemVariances: number[] = [];
  for (let i = 0; i < n; i++) {
    const col = itemScoresPerAttempt.map((row) => row[i] ?? 0);
    itemVariances.push(variance(col));
  }
  const sumItemVar = itemVariances.reduce((a, b) => a + b, 0);

  // Variance của total score
  const totals = itemScoresPerAttempt.map((row) => row.reduce((a, b) => a + b, 0));
  const totalVar = variance(totals);
  if (totalVar === 0) return 0;

  return (n / (n - 1)) * (1 - sumItemVar / totalVar);
}

function mean(a: number[]): number {
  return a.reduce((s, x) => s + x, 0) / a.length;
}
function variance(a: number[]): number {
  const m = mean(a);
  return a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length;
}
function stdDev(a: number[]): number {
  return Math.sqrt(variance(a));
}

/**
 * Tổng hợp stats cho 1 exam.
 */
export async function computeExamStats(examId: string) {
  const { db } = await import('@/db');
  const { questions, examResponses, examAttempts } = await import('@cogniva/db/schema');
  const { eq, and } = await import('drizzle-orm');

  const qs = await db.query.questions.findMany({ where: eq(questions.examId, examId) });
  const submittedAttempts = (await db.query.examAttempts.findMany({
    where: and(eq(examAttempts.examId, examId), eq(examAttempts.status, 'SUBMITTED')),
    with: { responses: true } as any,
  })) as any[];

  // Matrix [attempt][question] = pointsEarned
  const matrix: number[][] = submittedAttempts.map((a) =>
    qs.map((q) => {
      const r = a.responses.find((r: any) => r.questionId === q.id);
      return r?.pointsEarned ?? 0;
    }),
  );

  // Total score per attempt
  const totals = matrix.map((row) => row.reduce((s, x) => s + x, 0));

  const perQuestion: QuestionStat[] = qs.map((q, qIdx) => {
    const correct: number[] = [],
      incorrect: number[] = [];
    matrix.forEach((row, aIdx) => {
      const earned = row[qIdx] ?? 0;
      const max = (q as any).points ?? 1;
      if (earned >= max * 0.99) correct.push(totals[aIdx]!);
      else incorrect.push(totals[aIdx]!);
    });
    const difficulty = correct.length / (correct.length + incorrect.length || 1);
    const discrimination = pointBiserial(correct, incorrect);

    // Distractor analysis cho MCQ_SINGLE
    let distractors: Record<string, number> | undefined;
    if ((q as any).type === 'MCQ_SINGLE') {
      const counts = new Map<number, number>();
      submittedAttempts.forEach((a) => {
        const r = a.responses.find((r: any) => r.questionId === q.id);
        if (r) counts.set(r.answer, (counts.get(r.answer) ?? 0) + 1);
      });
      const total = submittedAttempts.length;
      distractors = Object.fromEntries(
        Array.from(counts.entries()).map(([opt, c]) => [`option_${opt}`, c / total]),
      );
    }

    const flag: QuestionStat['flag'] =
      discrimination < 0
        ? 'negative_discrimination'
        : difficulty > 0.9
          ? 'too_easy'
          : difficulty < 0.2
            ? 'too_hard'
            : discrimination < 0.15
              ? 'low_discrimination'
              : 'ok';

    return {
      questionId: q.id,
      prompt: (q as any).prompt,
      difficulty,
      discrimination,
      attempts: matrix.length,
      distractors,
      flag,
    };
  });

  const alpha = cronbachAlpha(matrix);

  return {
    questions: perQuestion,
    examLevel: {
      alpha,
      totalAttempts: matrix.length,
      meanScore: totals.length ? mean(totals) : 0,
      maxPossibleScore: qs.reduce((s, q) => s + ((q as any).points ?? 1), 0),
    },
  };
}
```

**`apps/web/src/app/(app)/exams/[examId]/analytics/page.tsx`**

```typescript
/**
 * Item Analysis dashboard — hiển thị metrics + flag câu hỏi cần revise.
 */
import { computeExamStats } from '@/lib/exam/item-analysis';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const FLAG_LABELS: Record<string, { label: string; color: string }> = {
  ok:                       { label: 'OK',                       color: 'bg-green-100 text-green-700' },
  too_easy:                 { label: 'Quá dễ',                   color: 'bg-amber-100 text-amber-700' },
  too_hard:                 { label: 'Quá khó',                  color: 'bg-amber-100 text-amber-700' },
  low_discrimination:       { label: 'Không phân biệt',          color: 'bg-orange-100 text-orange-700' },
  negative_discrimination:  { label: '⚠ Đáng nghi (kiểm tra đáp án)', color: 'bg-red-100 text-red-700' },
};

export default async function ExamAnalyticsPage({ params }: { params: { examId: string } }) {
  const stats = await computeExamStats(params.examId);

  return (
    <div className="p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Item Analysis</h1>
        <p className="text-sm text-muted-foreground">
          Classical Test Theory + IRT metrics. Flag câu hỏi cần revise.
        </p>
      </header>

      {/* Exam-level summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Cronbach α" value={stats.examLevel.alpha.toFixed(3)}
          hint={stats.examLevel.alpha > 0.7 ? 'Tốt' : 'Thấp — revise'} />
        <SummaryCard label="Tổng attempts" value={String(stats.examLevel.totalAttempts)} />
        <SummaryCard label="Mean score" value={stats.examLevel.meanScore.toFixed(1)} />
        <SummaryCard label="Max possible" value={stats.examLevel.maxPossibleScore.toFixed(1)} />
      </div>

      {/* Per-question table */}
      <table className="w-full text-sm border">
        <thead className="bg-muted/40">
          <tr className="border-b text-left">
            <th className="p-2">Câu hỏi</th>
            <th className="p-2">Difficulty (p)</th>
            <th className="p-2">Discrimination (rpb)</th>
            <th className="p-2">Attempts</th>
            <th className="p-2">Flag</th>
          </tr>
        </thead>
        <tbody>
          {stats.questions.map(q => {
            const flag = FLAG_LABELS[q.flag];
            return (
              <tr key={q.questionId} className="border-b">
                <td className="p-2 max-w-md truncate">{q.prompt}</td>
                <td className="p-2 font-mono">{q.difficulty.toFixed(2)}</td>
                <td className={cn('p-2 font-mono', q.discrimination < 0 && 'text-red-600 font-bold')}>
                  {q.discrimination.toFixed(2)}
                </td>
                <td className="p-2">{q.attempts}</td>
                <td className="p-2"><Badge className={flag.color}>{flag.label}</Badge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
```

**Cách dùng output:**

- `flag === 'negative_discrimination'` → ưu tiên kiểm tra đáp án (90% là câu lỗi).
- `flag === 'too_easy' || 'too_hard'` → revise độ khó hoặc drop câu khỏi adaptive pool.
- `flag === 'low_discrimination'` → distractor yếu, viết lại options.
- `α < 0.5` → exam thiếu reliability, gộp nhiều mảng concept không liên quan.

**Calibrate IRT params từ data:**
Sau khi đủ 100+ attempts, có thể fit IRT params (difficulty, discrimination, guessing) từ response matrix dùng MML (Marginal Maximum Likelihood). Phase 19 v1 dùng heuristic mapping:

```typescript
function calibrateIRT(stat: QuestionStat): {
  difficulty: number;
  discrimination: number;
  guessing: number;
} {
  // Difficulty CTT (0-1) → theta scale (-3 to +3): 1 - p mapped via probit
  const difficultyTheta = -Math.log(stat.difficulty / (1 - stat.difficulty)); // logit
  return {
    difficulty: Math.max(-3, Math.min(3, difficultyTheta)),
    discrimination: Math.max(0.3, Math.min(2.5, stat.discrimination * 3)),
    guessing: 0.25, // MCQ 4 options → 25% guess
  };
}
```

### 19.5b. GDPR data export + deletion

Bắt buộc cho compliance EU. Endpoint export + delete user data.

**`apps/web/src/app/api/me/export/route.ts`**

```typescript
/**
 * GET /api/me/export — trả toàn bộ data user dạng ZIP (JSON files).
 * GDPR Article 20 (Right to data portability).
 */
import JSZip from 'jszip';
import { auth } from '@/lib/auth';
import { db } from '@/db';

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });

  const userId = session.user.id;
  const zip = new JSZip();

  // Profile
  zip.file(
    'profile.json',
    JSON.stringify(
      await db.query.user.findFirst({ where: (u, { eq }) => eq(u.id, userId) }),
      null,
      2,
    ),
  );

  // Documents + chunks (chỉ metadata, không file binary — quá lớn)
  const docs = await db.query.document.findMany({ where: (d, { eq }) => eq(d.userId, userId) });
  zip.file('documents.json', JSON.stringify(docs, null, 2));

  // Chats
  const chats = await db.query.chatMessage.findMany({ where: (c, { eq }) => eq(c.userId, userId) });
  zip.file('chats.json', JSON.stringify(chats, null, 2));

  // Flashcards + reviews
  const flashcards = await db.query.flashcard.findMany({
    where: (f, { eq }) => eq(f.userId, userId),
  });
  zip.file('flashcards.json', JSON.stringify(flashcards, null, 2));

  // Notes
  const notes = await db.query.note.findMany({ where: (n, { eq }) => eq(n.userId, userId) });
  zip.file('notes.json', JSON.stringify(notes, null, 2));

  // Rooms + recordings (link, không file)
  const rooms = await db.query.rooms.findMany({ where: (r, { eq }) => eq(r.ownerId, userId) });
  zip.file('rooms.json', JSON.stringify(rooms, null, 2));

  // Exam attempts
  const attempts = await db.query.examAttempts.findMany({
    where: (a, { eq }) => eq(a.userId, userId),
  });
  zip.file('exam_attempts.json', JSON.stringify(attempts, null, 2));

  // README explain format
  zip.file(
    'README.md',
    `# Cogniva Data Export\nUser: ${session.user.email}\nExported: ${new Date().toISOString()}\n\nFiles trong ZIP này là JSON dump của data thuộc về bạn.`,
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="cogniva-export-${userId}.zip"`,
    },
  });
}
```

**`apps/web/src/app/api/me/delete/route.ts`**

```typescript
/**
 * DELETE /api/me/delete — xoá vĩnh viễn user + cascade data.
 * GDPR Article 17 (Right to erasure).
 * Bước:
 *   1. Verify password lần nữa (anti-accident).
 *   2. Anonymize trong shared resources (roomMessages.userId → 'DELETED_USER').
 *   3. Cascade delete: documents, flashcards, notes, rooms own, attempts.
 *   4. Delete user row → revoke session.
 *   5. Audit log để compliance trace.
 */
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { user, roomMessages /* … */ } from '@cogniva/db/schema';
import { eq } from 'drizzle-orm';

export async function DELETE(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: 'Unauthenticated' }, { status: 401 });
  const { confirmPassword } = await req.json();

  // 1. Re-auth
  const ok = await auth.api.verifyPassword({
    body: { userId: session.user.id, password: confirmPassword },
  });
  if (!ok) return Response.json({ error: 'Invalid password' }, { status: 401 });

  // 2. Anonymize messages trong room/exam mà user không own
  await db
    .update(roomMessages)
    .set({ userId: 'DELETED_USER', content: '[đã xoá]' })
    .where(eq(roomMessages.userId, session.user.id));

  // 3. Cascade delete — ON DELETE CASCADE đã setup ở schema
  // Audit log trước khi xoá
  console.log(
    JSON.stringify({
      event: 'user.deleted',
      userId: session.user.id,
      email: session.user.email,
      timestamp: new Date().toISOString(),
    }),
  );

  await db.delete(user).where(eq(user.id, session.user.id));

  // 4. Revoke session
  await auth.api.signOut({ headers: req.headers });

  return Response.json({ ok: true, message: 'Account đã xoá vĩnh viễn.' });
}
```

UI bổ sung vào `/settings` Danger zone (Phase 11 deferred → Phase 19 ship được):

```typescript
// Trong /settings/page.tsx — replace nút "Sẽ ra mắt"
const handleDelete = async () => {
  const pwd = prompt('Nhập mật khẩu để xác nhận xoá vĩnh viễn:');
  if (!pwd) return;
  const res = await fetch('/api/me/delete', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmPassword: pwd }),
  });
  if (res.ok) router.replace('/?deleted=1');
  else toast.error('Mật khẩu sai hoặc lỗi server');
};
```

### 19.6. Testing strategy

**Unit (Vitest):**

```typescript
// src/lib/exam/cat.test.ts — đã viết Phase 18
// src/lib/exam/grade.test.ts
import { describe, it, expect } from 'vitest';
import { gradeResponse } from './grade';

describe('gradeResponse', () => {
  it('MCQ_SINGLE đúng → full points', async () => {
    const r = await gradeResponse({ type: 'MCQ_SINGLE', correctAnswer: 2, points: 1 }, 2);
    expect(r.isCorrect).toBe(true);
    expect(r.points).toBe(1);
  });
  it('MCQ_MULTI partial credit', async () => {
    const r = await gradeResponse(
      { type: 'MCQ_MULTI', correctAnswer: [0, 1, 2], points: 3, partialCredit: true },
      [0, 1, 3],
    );
    expect(r.points).toBeCloseTo(((2 - 1) / 3) * 3);
  });
});
```

**E2E (Playwright):**

```typescript
// apps/web/e2e/rooms.spec.ts
import { test, expect, chromium } from '@playwright/test';

test('2 user join room thấy nhau', async () => {
  const browser1 = await chromium.launch();
  const browser2 = await chromium.launch();
  const page1 = await browser1.newPage();
  const page2 = await browser2.newPage();

  await page1.goto('/rooms/test-room/lobby');
  await page1.fill('input[name="username"]', 'User1');
  await page1.click('button:has-text("Join")');

  await page2.goto('/rooms/test-room/lobby');
  await page2.fill('input[name="username"]', 'User2');
  await page2.click('button:has-text("Join")');

  await expect(page1.locator('text=User2')).toBeVisible({ timeout: 10_000 });
  await expect(page2.locator('text=User1')).toBeVisible({ timeout: 10_000 });

  await browser1.close();
  await browser2.close();
});

test('live exam 5 user', async () => {
  // ... spawn 5 browsers, join code, answer questions, verify leaderboard
});
```

**Load (k6):**

```javascript
// load-test/live-exam.js
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    live_exam: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 50 },
        { duration: '2m', target: 50 },
        { duration: '30s', target: 0 },
      ],
    },
  },
};

export default function () {
  const res = http.post(
    'https://app.cogniva.com/api/live-exam/join',
    JSON.stringify({ code: 'A3K9P2' }),
  );
  check(res, { joined: (r) => r.status === 200 });
  const examId = res.json('examId');
  // subscribe Socket.IO WS + answer questions
  sleep(30);
}
```

### 19.7. Production checklist

- [ ] LiveKit deployed 2 region (SG + FR).
- [ ] coturn cert valid + auto-renew.
- [ ] All services health check OK (`/health` endpoint).
- [ ] Prometheus scrape Socket.IO gateway (apps/realtime), LiveKit Prom export.
- [ ] Grafana dashboard: P95 latency, error rate, concurrent rooms.
- [ ] Sentry capture từ frontend + BullMQ worker.
- [ ] DB backup PITR enabled (Neon Pro auto).
- [ ] R2 lifecycle rule: delete recording > 90 days nếu Free plan.
- [ ] Cloudflare proxy DDoS protection trước app.
- [ ] Rate limit: room/join 10/min, exam/start 3/min, ai-message 30/min.
- [ ] Privacy policy mention recording + webcam proctor.
- [ ] Terms of service cho exam (anti-cheat acknowledgment).
- [ ] Onboarding flow: tutorial step-by-step lần đầu vào room/exam.
- [ ] Loading skeleton cho slow network.
- [ ] Mobile responsive (test iPhone SE + Galaxy A22).
- [ ] PWA install — manifest + service worker.
- [ ] Keyboard shortcuts hint (modal `?` key).
- [ ] Lighthouse a11y ≥ 90 toàn site.
- [ ] Load test 100 concurrent rooms pass.
- [ ] Security audit: try inject, try bypass token — fail tests.
- [ ] Documentation site published (Mintlify hoặc Docusaurus).

### 19.8. Deliverable

- [ ] Anti-cheat catch 90%+ violations trong red team test (10 cheat attempts).
- [ ] E2E test pass: 2 user trong room thấy nhau + Live exam 5 user.
- [ ] k6 load test 50 concurrent live exam: P95 < 500ms, error rate < 1%.
- [ ] Item analysis dashboard hiển thị difficulty/discrimination cho 1 exam mẫu.
- [ ] Production checklist 18/18 ✓.

### 19.9. Acceptance criteria

- [ ] Cheat risk score correlate với manual review (Cohen's kappa > 0.6).
- [ ] Tab switch 2s → record violation, không auto-flag.
- [ ] Tab switch 30s → flag.
- [ ] DevTools open → high severity violation.
- [ ] Webcam: 2 face detected → high severity.
- [ ] Vitest coverage ≥ 70% cho `lib/exam/*`.
- [ ] Playwright spec pass headless on CI.

### 🔐 Security notes Phase 19

**Threat model toàn hệ thống:**

| Threat                   | Mitigation                                               |
| ------------------------ | -------------------------------------------------------- |
| Unauthorized room join   | JWT TTL 2h, server-verify membership                     |
| DDoS signaling           | Cloudflare proxy + rate limit                            |
| Media hijacking          | DTLS-SRTP encryption (LiveKit default)                   |
| Exam cheating            | 10+ client detection + server heuristics + manual review |
| AI prompt injection chat | Sanitize input, strip system prompts                     |
| Recording leak           | R2 presigned URL TTL 1h, member-only                     |
| Identity spoofing        | Browser fingerprint + IP + better-auth session           |

**Compliance:**

- GDPR: data export endpoint `/api/me/export`, deletion `/api/me/delete` (V2).
- COPPA: signup gate < 13 (parent consent V2).
- FERPA: exam data marked education record, retention policy 7 năm.
- Recording: explicit consent banner trong room có record=ON.

---

## Tóm tắt Cost / Scale / V2 Bonus

### Cost analysis (1000 active users)

**Self-hosted Hetzner:**

```
Hetzner CCX23 (4 vCPU, 16GB) × 4 servers       = $120/mo
  ├ 2 cho LiveKit
  ├ 1 cho coturn + Socket.IO gateway (apps/realtime)
  └ 1 cho Hocuspocus + BullMQ workers
Bandwidth (Hetzner free 20TB, $1/TB after)     = $30/mo
Neon Pro (Postgres + pgvector)                 = $19/mo
Upstash Redis                                  = $10/mo
R2 storage 2TB recordings (egress free)        = $30/mo
Domain + SSL (Let's Encrypt)                   = $0/mo
─────────────────────────────────────────────
TOTAL                                          ≈ $210/mo
```

**Managed equivalent:**

- LiveKit Cloud: 1000 user × 60min/day × 30 = 1.8M phút × $0.0003 = $540
- Pusher Channels: 100K conn × $0.01 = $1000
- Total managed ≈ $1540+/mo

**Savings: ~$1300/mo at 1K users → tự host break-even ngay tháng đầu.**

### Scale milestones

| Users    | Architecture changes                                     |
| -------- | -------------------------------------------------------- |
| 0-100    | Single VPS, all-in-one Docker Compose                    |
| 100-1K   | Tách media + app tiers, Caddy reverse proxy              |
| 1K-10K   | Multi-region LiveKit, DB read replicas, Redis cluster    |
| 10K-100K | Kubernetes, HPA autoscale, Postgres sharding (Citus)     |
| 100K+    | Custom SFU tuning, dedicated CDN (Cloudflare Enterprise) |

### V2 Bonus features (sau Phase 19)

**Rooms V2:**

- **Live streaming**: room → public stream (Twitch-style học).
- **Breakout rooms**: tách phòng nhỏ trong phòng lớn (LiveKit native).
- **Polls in room**: realtime voting + chart.
- **Co-watch YouTube**: sync video playback qua data channel.
- **AI translator**: realtime caption đa ngôn ngữ qua Whisper streaming.
- **VR mode**: 3D classroom (WebXR + Three.js).
- **Mobile native**: React Native + LiveKit RN SDK.
- **Recording editor**: trim + clip share trong browser.

**Exam V2:**

- **Tournament mode**: bracket elimination 1v1 theo vòng.
- **Certificates**: auto PDF với verify URL (Ed25519 sign).
- **Question marketplace**: teacher bán question bank, revenue share.
- **AI exam writer**: full exam từ learning objectives.
- **Voice grading**: speak answer → AI grade pronunciation.
- **Group whiteboard exam**: mỗi user own layer riêng.

### Portfolio impact

Khi pitch project cho recruiter:

- "Built and self-hosted a production WebRTC SFU stack (LiveKit + coturn) supporting 1000 concurrent users."
- "Implemented IRT-based adaptive testing với Newton-Raphson MLE, hội tụ trong 15 items."
- "Designed anti-cheat hệ thống 10+ detection methods, recall 90% trong red team test."
- "Achieved P95 latency 200ms cho 50 concurrent live exam users."
- "Saved $1300/month vs managed (Pusher + LiveKit Cloud) qua self-hosted Docker stack."

### Definition of Done — V2 launch

- [ ] User tạo room, invite, video call 8 người smooth (Phase 13-14).
- [ ] AI tutor answer in-room context, stream qua chat (Phase 15).
- [ ] Recording auto-transcribed + summarized + flashcard gen (Phase 15).
- [ ] Live exam Kahoot-style với 50 concurrent students (Phase 17).
- [ ] Adaptive test stable estimate trong 15 questions (Phase 18).
- [ ] Anti-cheat catch 90%+ violations in red team test (Phase 19).
- [ ] All 18 production checklist items ✓.

---

_Plan v2.0 — Phase 12-19 nối tiếp Cogniva master.md (Phase 0-11). Update khi build thực tế._

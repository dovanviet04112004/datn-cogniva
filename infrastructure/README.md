# Cogniva Infrastructure

> Phase 12 — self-hosted realtime stack cho Study Rooms + Exam V2.

## Cấu trúc

```
infrastructure/
├── docker-compose.dev.yml      # Local dev (LiveKit + Redis; gateway chạy qua pnpm)
├── docker-compose.prod.yml     # Production stack (full, gồm service `realtime`)
├── livekit/                    # SFU media server config
├── coturn/                     # TURN/STUN server (relay cho restrictive NAT)
├── caddy/                      # Reverse proxy + Let's Encrypt
└── scripts/                    # Provisioning + health checks
```

> Realtime app events (chat/presence/voice…) dùng **Socket.IO gateway** ở `apps/realtime`
> (thay Soketi/Pusher). Prod: service `realtime` trong docker-compose.prod.yml sau Caddy
> (`realtime.cogniva.com` → :6002). Xem `apps/realtime/README.md`.

## Local development

Chạy stack realtime trên máy local (cần Docker Desktop):

```bash
cd infrastructure
cp .env.example .env             # điền key tạm (script generate-keys.sh giúp)
docker compose -f docker-compose.dev.yml up -d

# Smoke test:
curl http://localhost:7880          # LiveKit signaling endpoint
docker compose -f docker-compose.dev.yml logs -f livekit
```

Chạy Socket.IO gateway trên host (hot-reload, dùng redis của compose):

```bash
REDIS_URL=redis://localhost:6379 INTERNAL_API_URL=http://localhost:3000 \
  pnpm --filter @cogniva/realtime dev   # nghe ws://localhost:6002
curl http://localhost:6002/healthz        # → ok
```

Sau đó set env trong `apps/web/.env.local`:

```bash
NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret_at_least_32_chars_long_xxx
NEXT_PUBLIC_REALTIME_URL=ws://localhost:6002
REDIS_URL=redis://localhost:6379
```

**Lưu ý local:**
- Không có TURN → user behind symmetric NAT sẽ không connect được (95% case OK trên cùng LAN/wifi).
- Không có TLS — chỉ test localhost. Production bắt buộc TLS qua Caddy.
- Không có Hocuspocus — Phase 14 sẽ add khi cần whiteboard/notes collab.
- Gateway Socket.IO chạy qua pnpm (không trong compose dev) để hot-reload nhanh.

## Production deploy

Xem `docs/plans/rooms-and-exam.md` §12 cho chi tiết. Steps tóm tắt:

1. Provision 2 Hetzner CCX23 (Ubuntu 22.04):
   ```bash
   ssh root@<media-server>
   curl -fsSL <repo>/infrastructure/scripts/provision-server.sh | bash -s media cogniva-media-1
   ```
2. Cấu hình DNS Cloudflare (xem `scripts/dns-records.md` — LiveKit + coturn NOT proxied).
3. Clone repo → fill `.env` → `docker compose -f docker-compose.prod.yml up -d`.
4. Crontab: `*/5 * * * * /opt/cogniva/health-check.sh`.

## Tham khảo

- LiveKit OSS docs: https://docs.livekit.io/home/self-hosting/local/
- Socket.IO docs: https://socket.io/docs/v4/ (adapter: https://socket.io/docs/v4/redis-adapter/)
- coturn wiki: https://github.com/coturn/coturn/wiki

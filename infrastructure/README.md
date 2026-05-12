# Cogniva Infrastructure

> Phase 12 — self-hosted realtime stack cho Study Rooms + Exam V2.

## Cấu trúc

```
infrastructure/
├── docker-compose.dev.yml      # Local dev (LiveKit + Soketi + Redis)
├── docker-compose.prod.yml     # Production stack (full)
├── livekit/                    # SFU media server config
├── coturn/                     # TURN/STUN server (relay cho restrictive NAT)
├── soketi/                     # Pusher-compatible WebSocket pub/sub
├── caddy/                      # Reverse proxy + Let's Encrypt
└── scripts/                    # Provisioning + health checks
```

## Local development

Chạy stack realtime trên máy local (cần Docker Desktop):

```bash
cd infrastructure
cp .env.example .env             # điền key tạm (script generate-keys.sh giúp)
docker compose -f docker-compose.dev.yml up -d

# Smoke test:
curl http://localhost:7880          # LiveKit signaling endpoint
curl http://localhost:6001/usage    # Soketi metrics
docker compose -f docker-compose.dev.yml logs -f livekit
```

Sau đó set env trong `apps/web/.env.local`:

```bash
NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret_at_least_32_chars_long_xxx
NEXT_PUBLIC_SOKETI_HOST=localhost
NEXT_PUBLIC_SOKETI_KEY=app-key-dev
SOKETI_APP_ID=cogniva
SOKETI_SECRET=app-secret-dev
```

**Lưu ý local:**
- Không có TURN → user behind symmetric NAT sẽ không connect được (95% case OK trên cùng LAN/wifi).
- Không có TLS — chỉ test localhost. Production bắt buộc TLS qua Caddy.
- Không có Hocuspocus — Phase 14 sẽ add khi cần whiteboard/notes collab.

## Production deploy

Xem `plan-rooms-and-exam.md` §12 cho chi tiết. Steps tóm tắt:

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
- Soketi docs: https://docs.soketi.app/
- coturn wiki: https://github.com/coturn/coturn/wiki

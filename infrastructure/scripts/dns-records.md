# Cloudflare DNS records cho Cogniva production

Setup trong Cloudflare dashboard, zone `cogniva.com`. Lưu ý cột "Proxy".

| Type | Name              | Content       | Proxy | TTL  | Mục đích                       |
|------|-------------------|---------------|-------|------|--------------------------------|
| A    | app               | `<APP_IP>`    | ✓     | Auto | Next.js qua Cloudflare CDN     |
| A    | livekit           | `<MEDIA_IP>`  | ✗     | Auto | WebRTC signaling — không proxy |
| A    | turn              | `<MEDIA_IP>`  | ✗     | Auto | TURN UDP — không proxy         |
| A    | realtime          | `<APP_IP>`    | ✓     | Auto | Socket.IO WS qua Caddy → CF OK |
| A    | hocus             | `<APP_IP>`    | ✓     | Auto | WS qua Caddy → CF OK proxy     |
| AAAA | (cùng tên)        | `<IPv6>`      | match | Auto | Dual-stack IPv6                |
| TXT  | _acme-challenge   | (auto)        | ✗     | Auto | Let's Encrypt DNS-01 (nếu cần) |

## Quan trọng

### Không proxy LiveKit + coturn
- Cloudflare proxy chỉ hỗ trợ HTTP/HTTPS + WebSocket trên port 443.
- LiveKit cần UDP range 50000-60000, coturn cần UDP 3478 + 49152-65535.
- Bật proxy = WebRTC media fail. Để **DNS only (xám)**.

### Proxy được Realtime (Socket.IO) + Hocuspocus
- Cả 2 chạy WebSocket trên port 443 qua Caddy.
- Cloudflare WebSocket proxy hỗ trợ tốt, thêm benefit DDoS + cache.

### TLS cert
- App/Realtime/Hocus: Caddy auto-issue Let's Encrypt qua HTTP-01.
- coturn: cần cert tay (Caddy không quản coturn). Setup riêng:
  ```bash
  apt install certbot
  certbot certonly --standalone -d turn.cogniva.com
  # Renew tự động qua /etc/cron.weekly/
  ```

### Email (nếu cần)
| Type | Name | Content                         | Note          |
|------|------|---------------------------------|---------------|
| MX   | @    | route1.mx.cloudflare.net (10)   | Email routing |
| TXT  | @    | "v=spf1 include:_spf.mx.cloudflare.net ~all" | SPF |

### Sau khi setup DNS
```bash
# Verify từ máy khác
dig +short livekit.cogniva.com
dig +short turn.cogniva.com

# WebRTC trickle ICE test
# https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
# Add: turn:turn.cogniva.com:3478 / turns:turn.cogniva.com:5349
# Phải thấy "relay" candidate xuất hiện.
```

#!/usr/bin/env bash
# Provision Hetzner Ubuntu 22.04 server cho Cogniva V2.
#
# Idempotent — chạy lại an toàn, không phá state hiện có.
# Yêu cầu: chạy với sudo, server đã có internet + SSH key đã setup.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/<repo>/main/infrastructure/scripts/provision-server.sh | sudo bash -s media cogniva-media-1
#   # Hoặc nếu đã clone repo:
#   sudo bash infrastructure/scripts/provision-server.sh media cogniva-media-1
#
# Args:
#   $1 = role  (media | app)   # quyết định firewall rules
#   $2 = hostname              # set hostnamectl
set -euo pipefail

ROLE="${1:-media}"
HOSTNAME="${2:-cogniva-$(date +%s)}"
PUBLIC_IP="$(curl -fsSL https://api.ipify.org)"

log() { echo -e "\033[1;34m[$(date +%H:%M:%S)]\033[0m $*"; }
fail() { echo -e "\033[1;31m[FAIL]\033[0m $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Phải chạy với sudo/root"
[[ "$ROLE" =~ ^(media|app)$ ]] || fail "Role phải là 'media' hoặc 'app', không phải '$ROLE'"

log "[1/8] Cập nhật + cài base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -qq
apt-get install -y -qq \
  curl ca-certificates gnupg lsb-release ufw fail2ban unattended-upgrades \
  jq htop net-tools dnsutils

log "[2/8] Hostname + timezone"
hostnamectl set-hostname "$HOSTNAME"
timedatectl set-timezone UTC

log "[3/8] Docker CE + Compose plugin"
if ! command -v docker &>/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu jammy stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
else
  log "Docker đã cài, bỏ qua"
fi

log "[4/8] UFW firewall (deny incoming, allow theo role)"
ufw --force reset >/dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    comment 'ssh'
ufw allow 80/tcp    comment 'http (Caddy ACME challenge)'
ufw allow 443/tcp   comment 'https'
ufw allow 443/udp   comment 'http3 quic'

if [[ "$ROLE" == "media" ]]; then
  log "    Mở port cho LiveKit + coturn"
  ufw allow 7880/tcp                 comment 'livekit signaling'
  ufw allow 7881/tcp                 comment 'livekit tcp media fallback'
  ufw allow 50000:60000/udp          comment 'livekit udp media'
  ufw allow 3478/tcp                 comment 'coturn'
  ufw allow 3478/udp                 comment 'coturn'
  ufw allow 5349/tcp                 comment 'coturn tls'
  ufw allow 5349/udp                 comment 'coturn dtls'
  ufw allow 49152:65535/udp          comment 'coturn relay range'
elif [[ "$ROLE" == "app" ]]; then
  log "    App role — chỉ 80/443 (Soketi/Hocus qua Caddy)"
fi
ufw --force enable >/dev/null

log "[5/8] fail2ban (chống SSH brute force)"
systemctl enable --now fail2ban
# Cấu hình mặc định Ubuntu đã đủ tốt cho SSH

log "[6/8] Caddy (reverse proxy + Let's Encrypt auto-renew)"
if ! command -v caddy &>/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y -qq
  apt-get install -y -qq caddy
  systemctl enable caddy
else
  log "Caddy đã cài, bỏ qua"
fi

log "[7/8] Unattended security upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

log "[8/8] Hoàn tất"
echo
echo "Server: $HOSTNAME ($ROLE)"
echo "Public IP: $PUBLIC_IP"
echo
echo "Bước tiếp theo:"
echo "  1. Cập nhật Cloudflare DNS theo infrastructure/scripts/dns-records.md"
echo "  2. git clone <repo> /opt/cogniva && cd /opt/cogniva/infrastructure"
echo "  3. cp .env.example .env && nano .env  (điền secret)"
echo "  4. cp livekit/livekit.prod.yaml.example livekit/livekit.prod.yaml && nano livekit/livekit.prod.yaml"
echo "  5. cp coturn/turnserver.conf.example coturn/turnserver.conf && nano coturn/turnserver.conf"
echo "  6. docker compose -f docker-compose.prod.yml up -d"
echo "  7. crontab -e: */5 * * * * /opt/cogniva/infrastructure/scripts/health-check.sh"

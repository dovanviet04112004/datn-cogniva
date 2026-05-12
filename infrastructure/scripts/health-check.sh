#!/usr/bin/env bash
# Health check cho Cogniva realtime stack — chạy cron mỗi 5 phút.
# Alert qua Slack/Discord webhook nếu service down.
#
# Crontab:
#   */5 * * * * /opt/cogniva/infrastructure/scripts/health-check.sh >> /var/log/cogniva-health.log 2>&1
set -uo pipefail

# Webhook URL — set qua env ALERT_WEBHOOK trong .env hoặc crontab
WEBHOOK="${ALERT_WEBHOOK:-}"

alert() {
  echo "[$(date -Iseconds)] FAIL: $1"
  if [[ -n "$WEBHOOK" ]]; then
    curl -fsS -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"🚨 Cogniva health fail: $1\"}" "$WEBHOOK" >/dev/null || true
  fi
}

# 1. Container alive?
CONTAINERS=(cogniva-livekit cogniva-soketi cogniva-redis)
for c in "${CONTAINERS[@]}"; do
  if ! docker ps --filter "name=$c" --filter 'status=running' --format '{{.Names}}' | grep -q "$c"; then
    alert "Container $c not running"
  fi
done

# 2. LiveKit signaling responsive?
if ! curl -fsS --max-time 5 http://localhost:7880/ >/dev/null; then
  alert "LiveKit signaling endpoint unreachable"
fi

# 3. Soketi WS endpoint?
if ! curl -fsS --max-time 5 http://localhost:6001/usage >/dev/null; then
  alert "Soketi unreachable"
fi

# 4. Redis ping?
if ! docker exec cogniva-redis redis-cli ping 2>/dev/null | grep -q PONG; then
  alert "Redis not responding"
fi

# 5. coturn (chỉ check trên media server)
if docker ps --format '{{.Names}}' | grep -q coturn; then
  if ! nc -z -u -w2 localhost 3478 2>/dev/null; then
    alert "coturn UDP 3478 unreachable"
  fi
fi

# 6. Disk space < 90% full
DISK_USED=$(df -h / | awk 'NR==2 {sub(/%/,"",$5); print $5}')
if [[ "$DISK_USED" -gt 90 ]]; then
  alert "Disk usage ${DISK_USED}% — sắp đầy"
fi

# 7. Memory > 90%
MEM_USED=$(free | awk 'NR==2 {printf "%.0f", $3/$2*100}')
if [[ "$MEM_USED" -gt 90 ]]; then
  alert "Memory usage ${MEM_USED}%"
fi

echo "[$(date -Iseconds)] OK"

#!/usr/bin/env bash
# Generate random secrets cho Cogniva infrastructure.
# Output ra stdout — copy paste vào .env / livekit.prod.yaml.
#
# Usage:
#   bash infrastructure/scripts/generate-keys.sh
set -euo pipefail

# Cần openssl
command -v openssl >/dev/null || { echo "openssl chưa cài"; exit 1; }

rand() {
  # $1 = length (bytes), base64 strip non-alphanumeric
  openssl rand -base64 "$1" | tr -dc 'A-Za-z0-9' | head -c "$1"
}

echo "# === Generated $(date -Iseconds) ==="
echo "# Copy vào infrastructure/.env và apps/web/.env.local"
echo
echo "# LiveKit"
echo "LIVEKIT_API_KEY=APIKey$(rand 12)"
echo "LIVEKIT_API_SECRET=$(rand 48)"
echo
echo "# Realtime (Socket.IO gateway) — KHÔNG cần app secret (auth qua Better Auth session)."
echo "# Chỉ cần set ở .env: INTERNAL_API_URL + APP_ORIGIN; apps/web set NEXT_PUBLIC_REALTIME_URL."
echo
echo "# coturn"
echo "TURN_SECRET=$(rand 64)"
echo
echo "# Hocuspocus JWT signing (Phase 14)"
echo "JWT_SECRET=$(rand 48)"
echo
echo "# === Reminder ==="
echo "# - LIVEKIT_API_SECRET phải ≥ 32 ký tự"
echo "# - Save 1 lần, sau đó rotate quarterly"
echo "# - KHÔNG commit .env vào git"

/**
 * Proof e2e Wave 1 — chạy với server :4000 đang bật. Phủ toàn bộ flow JWT:
 * sign-up → me → refresh ROTATION → REUSE-DETECTION (revoke family) →
 * sign-in lại → sai mật khẩu → forgot/reset password → mật khẩu cũ chết →
 * dual-accept session Better Auth cũ. Tự dọn user test ở cuối (xoá cascade).
 */
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const raw of readFileSync(join(apiDir, '.env'), 'utf8').split(/\r?\n/)) {
  const m = raw.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const BASE = 'http://localhost:4000/api/auth';
const prisma = new PrismaClient();
const email = `wave1-proof-${Date.now()}@test.cogniva.local`;
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};
const post = (path, body, headers = {}) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

try {
  // 1. Sign-up
  let r = await post('/sign-up', { email, password: 'matkhau-cu-123', name: 'Wave1 Proof' });
  let d = await r.json();
  check('sign-up 201 + đủ cặp token', r.status === 201 && !!d.accessToken && !!d.refreshToken);
  const { accessToken: at1, refreshToken: rt1 } = d;

  // 2. /me bằng Bearer access token
  r = await fetch(`${BASE}/me`, { headers: { authorization: `Bearer ${at1}` } });
  d = await r.json();
  check('/me Bearer JWT', r.status === 200 && d.user.email === email);

  // 3. Refresh rotation
  r = await post('/refresh', { refreshToken: rt1 });
  d = await r.json();
  check('refresh rotation 200 + token MỚI', r.status === 200 && d.refreshToken && d.refreshToken !== rt1);
  const rt2 = d.refreshToken;

  // 4. Reuse-detection: dùng lại rt1 (đã rotate) → 401 + cả family chết
  r = await post('/refresh', { refreshToken: rt1 });
  check('reuse rt cũ → 401', r.status === 401);
  r = await post('/refresh', { refreshToken: rt2 });
  check('rt mới nhất cũng bị revoke theo family → 401', r.status === 401);

  // 5. Sign-in lại + sai mật khẩu
  r = await post('/sign-in', { email, password: 'matkhau-cu-123' });
  check('sign-in đúng → 200', r.status === 200);
  r = await post('/sign-in', { email, password: 'sai-mat-khau' });
  check('sign-in sai → 401', r.status === 401);

  // 6. Forgot → reset password (devToken vì NODE_ENV=development)
  r = await post('/forgot-password', { email });
  d = await r.json();
  check('forgot-password 200 + devToken', r.status === 200 && !!d.devToken);
  r = await post('/reset-password', { token: d.devToken, newPassword: 'matkhau-moi-456' });
  check('reset-password 200', r.status === 200);
  r = await post('/reset-password', { token: d.devToken, newPassword: 'xxxx-yyyy-1' });
  check('token reset one-time → 401 lần 2', r.status === 401);
  r = await post('/sign-in', { email, password: 'matkhau-cu-123' });
  check('mật khẩu cũ chết → 401', r.status === 401);
  r = await post('/sign-in', { email, password: 'matkhau-moi-456' });
  check('mật khẩu mới sống → 200', r.status === 200);

  // 7. Hash mới phải đúng format Better Auth (salt:key hex) — tương thích 2 chiều
  const acc = await prisma.$queryRaw`
    SELECT a.password FROM "account" a JOIN "user" u ON u.id = a.user_id
    WHERE u.email = ${email} AND a.provider_id = 'credential' LIMIT 1`;
  check('hash format Better Auth-compatible', /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(acc[0]?.password ?? ''));

  // 8. Dual-accept: session Better Auth cũ vẫn vào được /me
  const legacy = await prisma.$queryRaw`
    SELECT token FROM "session" WHERE expires_at > now() ORDER BY expires_at DESC LIMIT 1`;
  if (legacy[0]) {
    const sig = createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(legacy[0].token).digest('base64url');
    r = await fetch(`${BASE}/me`, { headers: { cookie: `better-auth.session_token=${legacy[0].token}.${sig}` } });
    check('dual-accept session BA cũ → /me 200', r.status === 200);
  } else {
    console.log('• bỏ qua dual-accept (DB không có session BA còn hạn)');
  }
} finally {
  await prisma.$executeRaw`DELETE FROM "user" WHERE email = ${email}`;
  await prisma.$disconnect();
}

const pass = results.every(Boolean);
console.log(pass ? `\n✅ WAVE 1 AUTH PROOF PASS (${results.length} checks)` : '\n❌ FAIL');
process.exit(pass ? 0 : 1);

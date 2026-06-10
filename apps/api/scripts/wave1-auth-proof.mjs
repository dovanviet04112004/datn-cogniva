/**
 * Proof e2e Wave 1 — chạy với server :4000 đang bật. Phủ toàn bộ flow JWT:
 * sign-up → me → refresh ROTATION → REUSE-DETECTION → sign-in → forgot/reset
 * → 2FA TOTP (secret mã hoá đúng format Better Auth) → dual-issue session BA
 * → sign-out cả 2 hệ → dual-accept. Tự dọn user test ở cuối (xoá cascade).
 */
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { managedNonce } from '@noble/ciphers/utils.js';

/** TOTP HMAC-SHA1 6 số 30s — y hệt thuật toán server để sinh mã test. */
function totp(secret) {
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(buf).digest();
  const off = mac[mac.length - 1] & 15;
  const t = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return (t % 1e6).toString().padStart(6, '0');
}

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

  // 9. DUAL-ISSUE: sign-in flow mới phải set cookie session Better Auth
  //    (SSR cũ nhận user) — cookie đó tự verify được qua nhánh legacy của /me.
  r = await post('/sign-in', { email, password: 'matkhau-moi-456' });
  const setCookies = r.headers.getSetCookie?.() ?? [];
  const baCookie = setCookies.find((c) => c.startsWith('better-auth.session_token='));
  check('dual-issue set cookie BA', !!baCookie);
  if (baCookie) {
    const baValue = baCookie.split(';')[0];
    r = await fetch(`${BASE}/me`, { headers: { cookie: baValue } });
    check('cookie BA do flow mới phát → /me 200', r.status === 200);
    const sessRows = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM "session" s JOIN "user" u ON u.id = s.user_id WHERE u.email = ${email}`;
    check('session row tồn tại trong DB', (sessRows[0]?.n ?? 0) >= 1);

    // 10. Sign-out: revoke refresh family + xoá session BA
    r = await fetch(`${BASE}/sign-out`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: baValue },
      body: JSON.stringify({}),
    });
    const after = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM "session" WHERE token = ${baValue.split('=')[1].split('.')[0]}`;
    check('sign-out xoá session BA khỏi DB', r.status === 200 && after[0]?.n === 0);
  }

  // 11. 2FA TOTP — bật 2FA cho user test với secret mã hoá ĐÚNG format BA
  const tfSecret = 'PROOF2FASECRET123';
  const key = createHash('sha256').update(process.env.BETTER_AUTH_SECRET).digest();
  const encrypted = Buffer.from(
    managedNonce(xchacha20poly1305)(new Uint8Array(key)).encrypt(Buffer.from(tfSecret, 'utf8')),
  ).toString('hex');
  const u = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  await prisma.two_factor.create({
    data: { id: randomUUID(), user_id: u.id, secret: encrypted, backup_codes: '' },
  });
  await prisma.user.update({ where: { id: u.id }, data: { two_factor_enabled: true } });

  r = await post('/sign-in', { email, password: 'matkhau-moi-456' });
  d = await r.json();
  check('sign-in user 2FA → twoFactorRequired + challenge', r.status === 200 && d.twoFactorRequired === true && !!d.challengeToken);
  r = await post('/sign-in/2fa', { challengeToken: d.challengeToken, code: '000000' });
  check('mã 2FA sai → 401', r.status === 401);
  r = await post('/sign-in/2fa', { challengeToken: d.challengeToken, code: totp(tfSecret) });
  d = await r.json();
  check('mã 2FA đúng → 200 + tokens (decrypt XChaCha tương thích BA)', r.status === 200 && !!d.accessToken);

  // 12. Google OAuth — chưa cấu hình env → 503 (conditional như hệ cũ)
  r = await fetch(`${BASE}/google`, { redirect: 'manual' });
  check('GET /google không env → 503', r.status === 503);
} finally {
  await prisma.$executeRaw`DELETE FROM "user" WHERE email = ${email}`;
  await prisma.$disconnect();
}

const pass = results.every(Boolean);
console.log(pass ? `\n✅ WAVE 1 AUTH PROOF PASS (${results.length} checks)` : '\n❌ FAIL');
process.exit(pass ? 0 : 1);

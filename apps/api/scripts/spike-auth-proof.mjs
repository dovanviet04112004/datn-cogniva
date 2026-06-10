/**
 * ⚠️ SPIKE Wave 0 — XÓA Ở WAVE 1. Proof end-to-end cho AuthGuard:
 *  1. Lấy 1 session token chưa hết hạn từ DB (Neon) → ký HMAC như Better Auth.
 *  2. GET /whoami bằng cookie  → kỳ vọng 200 (nhánh legacy).
 *  3. POST /token              → nhận access token JWT ES256.
 *  4. GET /whoami bằng Bearer JWT → kỳ vọng 200 (nhánh JWT mới).
 *  5. GET /whoami không auth   → kỳ vọng 401.
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

const BASE = 'http://localhost:4000/api/_spike';
const prisma = new PrismaClient();

const rows = await prisma.$queryRaw`
  SELECT s.token, u.email FROM "session" s JOIN "user" u ON u.id = s.user_id
  WHERE s.expires_at > now() ORDER BY s.expires_at DESC LIMIT 1`;
if (!rows[0]) {
  console.error('FAIL: không có session nào còn hạn trong DB — đăng nhập web 1 lần rồi chạy lại.');
  process.exit(1);
}
const { token, email } = rows[0];
const sig = createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(token).digest('base64url');
const cookie = `better-auth.session_token=${token}.${sig}`;

const r1 = await fetch(`${BASE}/whoami`, { headers: { cookie } });
console.log(`1. whoami (cookie legacy)  → ${r1.status} ${r1.ok ? `user=${(await r1.json()).user.email}` : await r1.text()} (kỳ vọng email=${email})`);

const r2 = await fetch(`${BASE}/token`, { method: 'POST', headers: { cookie } });
const { accessToken } = await r2.json();
console.log(`2. đổi JWT                 → ${r2.status} token=${accessToken?.slice(0, 25)}… (3 segment: ${accessToken?.split('.').length === 3})`);

const r3 = await fetch(`${BASE}/whoami`, { headers: { authorization: `Bearer ${accessToken}` } });
console.log(`3. whoami (Bearer JWT mới) → ${r3.status} ${r3.ok ? `sub-email=${(await r3.json()).user.email}` : await r3.text()}`);

const r4 = await fetch(`${BASE}/whoami`);
console.log(`4. whoami (không auth)     → ${r4.status} (kỳ vọng 401)`);

await prisma.$disconnect();
const pass = r1.ok && r2.ok && r3.ok && r4.status === 401;
console.log(pass ? '✅ SPIKE A PASS' : '❌ SPIKE A FAIL');
process.exit(pass ? 0 : 1);

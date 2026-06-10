/**
 * Proof tích hợp client-switch (Wave 1): đi XUYÊN PROXY như browser/mobile thật.
 * Cần 2 server đang chạy: Nest :4000 + Next dev (PROXY_BASE, mặc định :3100).
 *
 *  1. POST {PROXY}/api/auth/sign-up  → rewrite sang Nest, nhận đủ cookie +
 *     header set-auth-token (dual-issue).
 *  2. GET  {PROXY}/api/user/status   → route CŨ của Next (Better Auth guard)
 *     bằng cookie BA dual-issue → 200 = SSR/API cũ nhận user từ flow mới.
 *  3. GET  như trên bằng Bearer set-auth-token (đường mobile) → 200.
 *  4. POST {PROXY}/api/auth/sign-out → revoke; gọi lại route cũ → 401.
 * Tự xoá user test ở cuối.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const raw of readFileSync(join(apiDir, '.env'), 'utf8').split(/\r?\n/)) {
  const m = raw.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const PROXY = process.env.PROXY_BASE ?? 'http://localhost:3100';
const prisma = new PrismaClient();
const email = `proxy-proof-${Date.now()}@test.cogniva.local`;
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

try {
  const r1 = await fetch(`${PROXY}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'proxy-proof-123', name: 'Proxy Proof' }),
  });
  const cookies = r1.headers.getSetCookie?.() ?? [];
  const baCookie = cookies.find((c) => c.startsWith('better-auth.session_token='))?.split(';')[0];
  const bearer = r1.headers.get('set-auth-token');
  check('sign-up qua proxy → 201 + cookie BA + set-auth-token', r1.status === 201 && !!baCookie && !!bearer);

  const r2 = await fetch(`${PROXY}/api/user/status`, { headers: { cookie: baCookie ?? '' } });
  check('route CŨ (Next/BA guard) nhận cookie dual-issue → 200', r2.status === 200, `body=${(await r2.text()).slice(0, 60)}`);

  const r3 = await fetch(`${PROXY}/api/user/status`, {
    headers: { authorization: `Bearer ${bearer}`, 'x-client-name': 'cogniva-mobile' },
  });
  check('route CŨ nhận Bearer set-auth-token (đường mobile) → 200', r3.status === 200);

  const r4 = await fetch(`${PROXY}/api/auth/sign-out`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: baCookie ?? '' },
    body: JSON.stringify({}),
  });
  const r5 = await fetch(`${PROXY}/api/user/status`, { headers: { cookie: baCookie ?? '' } });
  check('sign-out → route cũ từ chối cookie đã revoke (401)', r4.status === 200 && r5.status === 401, `status=${r5.status}`);
} finally {
  await prisma.$executeRaw`DELETE FROM "user" WHERE email = ${email}`;
  await prisma.$disconnect();
}

const pass = results.every(Boolean);
console.log(pass ? `\n✅ PROXY CLIENT-SWITCH PROOF PASS (${results.length} checks)` : '\n❌ FAIL');
process.exit(pass ? 0 : 1);

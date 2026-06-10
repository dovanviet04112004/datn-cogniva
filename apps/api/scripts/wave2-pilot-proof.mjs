/**
 * Proof Wave 2 pilot — GOLDEN DIFF trực tiếp: cùng 1 request bắn vào route CŨ
 * (Next :3100, chưa rewrite các prefix này) và route MỚI (Nest :4000), so sánh
 * JSON sau normalize. Cache key dùng chung nên BUST trước mỗi lần gọi để so
 * implementation thật (không để cache che khác biệt).
 * Cần: Nest :4000 + Next dev :3100 đang chạy. Tự dọn user test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
// server-core là CJS dist — dùng đúng bộ ck/cacheDelete như 2 backend.
const { ck, cacheDelete } = require('@cogniva/server-core');

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const raw of readFileSync(join(apiDir, '.env'), 'utf8').split(/\r?\n/)) {
  const m = raw.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const OLD = 'http://localhost:3100';
const NEW = 'http://localhost:4000';
const prisma = new PrismaClient();
const email = `wave2-proof-${Date.now()}@test.cogniva.local`;
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
/** Thay timestamp bằng placeholder — 2 lần gọi cách nhau vài ms. */
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x)]));
  }
  if (typeof v === 'string' && ISO.test(v)) return '<ts>';
  return v;
}

async function call(base, method, path, body, cookie) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: normalize(await res.json().catch(() => null)) };
}

/** Gọi route trên CẢ 2 backend (bust cacheKeys trước mỗi lần) rồi diff. */
async function compare(name, method, path, { body, cookie, cacheKeys = [] } = {}) {
  if (cacheKeys.length) await cacheDelete(...cacheKeys);
  const a = await call(OLD, method, path, body, cookie);
  if (cacheKeys.length) await cacheDelete(...cacheKeys);
  const b = await call(NEW, method, path, body, cookie);
  const same = JSON.stringify(a) === JSON.stringify(b);
  check(`${method} ${path}`, same, same ? `status=${a.status}` : `\n  OLD=${JSON.stringify(a)}\n  NEW=${JSON.stringify(b)}`);
}

try {
  const r = await fetch(`${NEW}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wave2-proof-123', name: 'Wave2 Proof' }),
  });
  const cookie = r.headers
    .getSetCookie()
    .find((c) => c.startsWith('better-auth.session_token='))
    .split(';')[0];
  const { user } = await r.json();
  console.log(`• user test: ${user.id}\n`);

  await compare('me', 'GET', '/api/profile/me', { cookie, cacheKeys: [ck.profileMe(user.id)] });
  await compare('patch', 'PATCH', '/api/profile/me', {
    cookie,
    body: { isPublic: true, name: 'Wave2 Proof' },
  });
  await compare('pub', 'GET', `/api/profile/${user.id}`, { cookie, cacheKeys: [ck.profilePublic(user.id)] });
  await compare('status-get', 'GET', '/api/user/status', { cookie });
  await compare('status-put', 'PUT', '/api/user/status', {
    cookie,
    body: { status: 'dnd', statusText: 'Đang ôn thi', expiresInSec: 3600 },
  });
  await compare('leaderboard', 'GET', '/api/leaderboard?limit=5', { cookie });
  await compare('analytics', 'GET', '/api/analytics', { cookie, cacheKeys: [ck.analytics(user.id)] });

  // Sai shape validate phải GIỐNG NHAU (zod flatten 400)
  await compare('status-put-invalid', 'PUT', '/api/user/status', { cookie, body: {} });
} finally {
  await prisma.$executeRaw`DELETE FROM "user" WHERE email = ${email}`;
  await prisma.$disconnect();
}

const pass = results.every(Boolean);
console.log(pass ? `\n✅ WAVE 2 PILOT GOLDEN DIFF PASS (${results.length} routes)` : '\n❌ FAIL');
process.exit(pass ? 0 : 1);

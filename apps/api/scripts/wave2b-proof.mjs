/**
 * Proof Wave 2b — golden diff 14 route (mastery/atoms/notes/study-plan/graph/
 * search/chunks): cùng request bắn route CŨ (Next :3100) và MỚI (Nest :4000),
 * normalize rồi so. Route LLM (notes/complete) chỉ so status (output không
 * tất định). DELETE so chéo 2 resource riêng (không double-delete được).
 * Cần cả 2 server đang chạy. Tự dọn user test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { ck, cacheDelete } = require('@cogniva/server-core');

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const raw of readFileSync(join(apiDir, '.env'), 'utf8').split(/\r?\n/)) {
  const m = raw.match(/^([A-Z_]+)="?(.*?)"?$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const OLD = 'http://localhost:3100';
const NEW = 'http://localhost:4000';
const prisma = new PrismaClient();
const email = `wave2b-proof-${Date.now()}@test.cogniva.local`;
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UUIDISH = /^[0-9a-f]{8}-[0-9a-f]{4}|^[a-z0-9]{20,}$/i;
function normalize(v, key = '') {
  if (Array.isArray(v)) return v.map((x) => normalize(x));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x, k)]));
  }
  if (typeof v === 'string' && (ISO.test(v) || (/(^id$|Id$)/.test(key) && UUIDISH.test(v)))) return `<${key || 'ts'}>`;
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

async function compare(name, method, path, { body, cookie, cacheKeys = [], statusOnly = false } = {}) {
  if (cacheKeys.length) await cacheDelete(...cacheKeys);
  const a = await call(OLD, method, path, body, cookie);
  if (cacheKeys.length) await cacheDelete(...cacheKeys);
  const b = await call(NEW, method, path, body, cookie);
  const same = statusOnly ? a.status === b.status : JSON.stringify(a) === JSON.stringify(b);
  check(`${method} ${path}${statusOnly ? ' (status-only)' : ''}`, same,
    same ? `status=${a.status}` : `\n  OLD=${JSON.stringify(a).slice(0, 400)}\n  NEW=${JSON.stringify(b).slice(0, 400)}`);
  return { a, b };
}

try {
  const r = await fetch(`${NEW}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wave2b-proof-12', name: 'Wave2b Proof' }),
  });
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token=')).split(';')[0];
  const { user } = await r.json();
  const concept = (await prisma.concept.findFirst({ select: { id: true } }))?.id;
  console.log(`• user=${user.id} concept=${concept}\n`);

  // ── Mastery + Atoms ────────────────────────────────────────────
  await compare('m1', 'GET', '/api/mastery', { cookie });
  if (concept) {
    await compare('m2', 'POST', '/api/mastery/mark', { cookie, body: { conceptId: concept, level: 'learning' } });
    await compare('m3', 'GET', `/api/atoms/${concept}`, { cookie, cacheKeys: [ck.atomView(user.id, concept)] });
    await compare('m4', 'GET', `/api/atoms/${concept}/items`, { cookie });
    await compare('m5', 'GET', `/api/graph/concept/${concept}`, { cookie });
  }
  await compare('m6', 'GET', '/api/mastery/recommendations', { cookie });
  await compare('m7', 'POST', '/api/mastery/decay', { cookie, body: {} }); // thiếu/sai secret → 403 cả 2

  // ── Notes CRUD ─────────────────────────────────────────────────
  await compare('n1', 'GET', '/api/notes', { cookie });
  await compare('n2', 'POST', '/api/notes', { cookie, body: { title: 'Proof note', content: 'nội dung' } });
  // DELETE so chéo: tạo 2 note rồi old xoá note1, new xoá note2.
  const mk = async (base) => (await call(base, 'POST', '/api/notes', { title: 'del-me', content: 'x' }, cookie)).body?.note;
  const nA = await mk(OLD);
  const nB = await mk(NEW);
  const ids = await prisma.$queryRaw`SELECT id FROM note WHERE user_id = ${user.id} AND title = 'del-me' ORDER BY created_at`;
  if (ids.length >= 2) {
    const dOld = await call(OLD, 'DELETE', `/api/notes/${ids[0].id}`, undefined, cookie);
    const dNew = await call(NEW, 'DELETE', `/api/notes/${ids[1].id}`, undefined, cookie);
    check('DELETE /api/notes/:id (chéo)', JSON.stringify(dOld) === JSON.stringify(dNew), `status=${dOld.status}`);
  }
  await compare('n3', 'GET', '/api/notes/khong-ton-tai', { cookie });
  await compare('n4', 'POST', '/api/notes/complete', { cookie, body: { title: 'Định lý Pytago', content: 'Trong tam giác vuông' }, statusOnly: true });

  // ── Study-plan ─────────────────────────────────────────────────
  const day = new Date().toISOString().slice(0, 10);
  await compare('s1', 'GET', '/api/study-plan/today', { cookie, cacheKeys: [ck.studyPlan(user.id, day)] });
  await compare('s2', 'GET', '/api/study-plan', { cookie });
  await compare('s3', 'PATCH', '/api/study-plan/khong-ton-tai', { cookie, body: { status: 'DONE' } });

  // ── Graph + Search + Chunks ────────────────────────────────────
  await compare('g1', 'GET', '/api/graph', { cookie, cacheKeys: [ck.graph(user.id, 'all')] });
  await compare('g2', 'POST', '/api/graph/mine', { cookie, body: {} }); // user mới <2 concepts → 400 cùng message
  await compare('q1', 'GET', '/api/search?q=test', { cookie });
  await compare('q2', 'GET', '/api/chunks/00000000-0000-4000-8000-000000000000', { cookie });
} finally {
  await prisma.$executeRaw`DELETE FROM "user" WHERE email = ${email}`;
  await prisma.$disconnect();
}

const pass = results.every(Boolean);
console.log(pass ? `\n✅ WAVE 2B GOLDEN DIFF PASS (${results.length} checks)` : '\n❌ FAIL');
process.exit(pass ? 0 : 1);

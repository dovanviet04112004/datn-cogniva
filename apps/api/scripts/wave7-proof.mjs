/**
 * Proof Wave 7 — golden diff CHAT streaming + ADMIN + ACCOUNT + 2FA E2E:
 * OLD Next :3100 vs NEW Nest :4000.
 *
 * Chat stream: LLM non-deterministic → so STRUCTURE (headers, mã frame, shape
 * citations/meta), không so text delta. Admin: mutation twin (mỗi backend 1
 * target riêng), list/detail GET = same-resource cả 2 backend → byte equal.
 * 2FA enable/verify/sign-in/backup/disable: feature MỚI (không có bản cũ) —
 * assert hành vi E2E, tự tính TOTP từ totpURI.
 */
import { createHmac } from 'node:crypto';
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
const stamp = Date.now();
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const IDISH_KEY = /(^id$|Id$|^key$|^url$|^email$|Code$|^code$|^storageKey$|^token$|Url$)/;
const VOLATILE_KEY = /^(ipAddress|timeSpentSeconds|lastMessageAt|affected|lastSeenAt|expiresAt|aiSummary|costUsd|modelUsed|details|providerRef|nextCursor|scheduledFor|daysRemaining|cancelledAt|spentUsd|remainingUsd|spentPct|resetAt|timestamp|latencyMs|stateTtl|counts|sessionId|latestUpload|lastCallAt|ip|userAgent|dateOfBirth)$/;
const UUID_IN_STR = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CUIDISH = /\b[a-z0-9]{24,32}\b/g;
function normalize(v, key = '') {
  if (VOLATILE_KEY.test(key)) return `<${key}>`;
  if (Array.isArray(v)) return v.map((x) => normalize(x, key));
  if (v && typeof v === 'object') {
    // Sort key: thứ tự key JSON khác nhau giữa Drizzle/Prisma là cosmetic.
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, normalize(x, k)]),
    );
  }
  if (typeof v === 'string') {
    if (ISO.test(v)) return '<ts>';
    if (IDISH_KEY.test(key)) return `<${key}>`;
    return v.replace(UUID_IN_STR, '<rid>').replace(CUIDISH, '<rid>');
  }
  if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 1e6) / 1e6;
  return v;
}

async function call(base, method, path, body, cookie, opts = {}) {
  const headers = { ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text || null; }
  return {
    status: res.status,
    body: normalize(parsed),
    raw: text,
    headers: res.headers,
  };
}

async function compare(name, method, opts) {
  const { cacheKeys = [], statusOnly = false } = opts;
  if (cacheKeys.length) await cacheDelete(...cacheKeys);
  const a = await call(OLD, method, opts.pathOld ?? opts.path, opts.bodyOld ?? opts.body, opts.cookieOld ?? opts.cookie, opts);
  if (cacheKeys.length) await cacheDelete(...cacheKeys);
  const b = await call(NEW, method, opts.pathNew ?? opts.path, opts.bodyNew ?? opts.body, opts.cookieNew ?? opts.cookie, opts);
  const pick = (r) => ({ status: r.status, body: r.body });
  const same = statusOnly
    ? a.status === b.status
    : JSON.stringify(pick(a)) === JSON.stringify(pick(b));
  check(`${method} ${name}${statusOnly ? ' (status-only)' : ''}`, same,
    same ? `status=${a.status}` : `\n  OLD=${JSON.stringify(pick(a)).slice(0, 600)}\n  NEW=${JSON.stringify(pick(b)).slice(0, 600)}`);
  return { a, b };
}

async function signUp(tag, displayName) {
  const email = `wave7-${tag}-${stamp}@test.cogniva.local`;
  const r = await fetch(`${NEW}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wave7-proof-12', name: displayName }),
  });
  if (r.status >= 300) throw new Error(`sign-up ${tag} fail ${r.status}`);
  const setCookies = r.headers.getSetCookie();
  const ba = setCookies.find((c) => c.startsWith('better-auth.session_token=')).split(';')[0];
  const cgAt = setCookies.find((c) => c.startsWith('cg_at='))?.split(';')[0];
  const { user } = await r.json();
  // Gửi CẢ 2: route web cũ (app/api sắp xóa) đọc BA; SSR/admin web đã shim cg_at.
  return { email, cookie: `${ba}; ${cgAt}`, cgAt, id: user.id, password: 'wave7-proof-12' };
}

// ── TOTP helper (RFC 6238 SHA1 6 số — khớp TwoFactorService) ──────────────
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.replace(/=+$/, '')) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secretBytes) {
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secretBytes).update(buf).digest();
  const off = mac[mac.length - 1] & 15;
  const t = ((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return (t % 1e6).toString().padStart(6, '0');
}

// ── Setup ──────────────────────────────────────────────────────────────────
const admin = await signUp('admin', 'W7 Admin');
const target = await signUp('target-a', 'W7 Target');
const targetB = await signUp('target-b', 'W7 Target');
const userA = await signUp('user-a', 'W7 User');
const userB = await signUp('user-b', 'W7 User');
await prisma.user.update({ where: { id: admin.id }, data: { admin_role: 'SUPER_ADMIN' } });
console.log(`• admin=${admin.id} targets=${target.id}/${targetB.id}\n`);

try {
  // ════ CHAT STREAMING — structure compare ═══════════════════════════════════
  async function chatStream(base, cookie, message) {
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ id: 'm1', role: 'user', content: message }] }),
    });
    const text = await res.text();
    const lines = text.split('\n').filter(Boolean);
    const codes = lines.map((l) => l.split(':')[0]);
    // Gom run text-delta 0: thành 1 token — số delta tuỳ LLM
    const sig = codes.join(',').replace(/(?:0,)+0?/g, '0*,').replace(/,$/, '');
    let meta = null, citations = null;
    for (const l of lines) {
      if (l.startsWith('2:')) try { meta = JSON.parse(l.slice(2))[0]; } catch {}
      if (l.startsWith('8:')) try { citations = JSON.parse(l.slice(2))[0]; } catch {}
    }
    return {
      status: res.status,
      ct: res.headers.get('content-type'),
      dsHeader: res.headers.get('x-vercel-ai-data-stream'),
      sig,
      metaShape: meta ? Object.keys(meta).sort().join(',') : null,
      hasConvId: Boolean(meta?.conversationId),
      citShape: citations ? `${citations.type}:${Array.isArray(citations.citations)}` : null,
      convId: meta?.conversationId ?? null,
    };
  }
  const sA = await chatStream(OLD, userA.cookie, 'Chào bạn, quang hợp là gì? Trả lời thật ngắn.');
  const sB = await chatStream(NEW, userB.cookie, 'Chào bạn, quang hợp là gì? Trả lời thật ngắn.');
  {
    const strip = ({ convId, ...rest }) => rest;
    const same = JSON.stringify(strip(sA)) === JSON.stringify(strip(sB));
    check('POST /api/chat (stream structure: headers + frame codes + meta/citations shape)', same,
      same ? `sig=${sA.sig} ct=${sA.ct}` : `\n  OLD=${JSON.stringify(strip(sA))}\n  NEW=${JSON.stringify(strip(sB))}`);
  }
  {
    // Side-effect: 2 message (USER + ASSISTANT) persist trên cả 2 bên
    const [mA, mB] = await Promise.all([
      prisma.message.findMany({ where: { conversation_id: sA.convId }, orderBy: { created_at: 'asc' } }),
      prisma.message.findMany({ where: { conversation_id: sB.convId }, orderBy: { created_at: 'asc' } }),
    ]);
    const ok = mA.length === 2 && mB.length === 2
      && mA[0].role === 'USER' && mA[1].role === 'ASSISTANT'
      && mB[0].role === 'USER' && mB[1].role === 'ASSISTANT'
      && mB[1].metadata?.provider && mB[1].metadata?.model;
    check('DB: chat persist USER+ASSISTANT message + metadata provider/model', ok,
      `OLD=${mA.length} msg, NEW=${mB.length} msg, NEW meta=${JSON.stringify({ p: mB[1]?.metadata?.provider, m: mB[1]?.metadata?.model })}`);
  }
  await compare('/api/chat (messages rỗng → 400)', 'POST', {
    path: '/api/chat', body: { messages: [] },
    cookieOld: userA.cookie, cookieNew: userB.cookie,
  });
  await compare('/api/chat (conversationId người khác → 404)', 'POST', {
    pathOld: '/api/chat', pathNew: '/api/chat',
    bodyOld: { messages: [{ id: 'm1', role: 'user', content: 'hi' }], conversationId: sB.convId },
    bodyNew: { messages: [{ id: 'm1', role: 'user', content: 'hi' }], conversationId: sA.convId },
    cookieOld: userA.cookie, cookieNew: userB.cookie,
  });

  await compare('/api/chat/conversations (list + cache)', 'GET', {
    path: '/api/chat/conversations',
    cookieOld: userA.cookie, cookieNew: userB.cookie,
    cacheKeys: [`conversations:v1:${userA.id}`, `conversations:v1:${userB.id}`],
  });
  // same-resource: conversation của A đọc từ CẢ 2 backend
  await compare('/api/chat/conversations/:id (same-resource)', 'GET', {
    path: `/api/chat/conversations/${sA.convId}`,
    cookie: userA.cookie,
  });
  await compare('/api/chat/conversations/:id (user khác → 404)', 'GET', {
    path: `/api/chat/conversations/${sA.convId}`,
    cookie: userB.cookie,
  });
  await compare('/api/ai/quick-gen (LLM)', 'POST', {
    path: '/api/ai/quick-gen',
    body: { prompt: 'Giải thích đạo hàm trong 1 câu' },
    cookieOld: userA.cookie, cookieNew: userB.cookie,
    statusOnly: true,
  });

  // ════ ADMIN — mutation twin, GET same-resource ═════════════════════════════
  const A = admin.cookie;
  await compare('/api/admin/users (list)', 'GET', { path: '/api/admin/users?limit=5', cookie: A });
  await compare('/api/admin/users/:id', 'GET', { path: `/api/admin/users/${target.id}`, cookie: A });
  await compare('/api/admin/users/:id (PATCH name)', 'PATCH', {
    pathOld: `/api/admin/users/${target.id}`, pathNew: `/api/admin/users/${targetB.id}`,
    body: { name: 'W7 Target Renamed', reason: 'proof rename test' },
    cookie: A,
  });
  await compare('/api/admin/users/:id/suspend', 'POST', {
    pathOld: `/api/admin/users/${target.id}/suspend`, pathNew: `/api/admin/users/${targetB.id}/suspend`,
    body: { reason: 'proof suspend test' },
    cookie: A,
  });
  {
    // Deviation CÓ CHỦ ĐÍCH: chỉ NEW revoke refresh family (web cũ chỉ xóa session BA).
    const rb = await prisma.refresh_token.findMany({ where: { user_id: targetB.id } });
    const ok = rb.length > 0 && rb.every((t) => t.revoked_at);
    check('DB: suspend (NEW) revoke toàn bộ refresh_token của target', ok, `B=${rb.length} token`);
  }
  await compare('/api/admin/users/:id/unsuspend', 'POST', {
    pathOld: `/api/admin/users/${target.id}/unsuspend`, pathNew: `/api/admin/users/${targetB.id}/unsuspend`,
    body: { reason: 'proof unsuspend test' },
    cookie: A,
  });
  await compare('/api/admin/users/:id/force-signout', 'POST', {
    pathOld: `/api/admin/users/${target.id}/force-signout`, pathNew: `/api/admin/users/${targetB.id}/force-signout`,
    body: { reason: 'proof signout test' },
    cookie: A,
  });
  await compare('/api/admin/audit (same-resource list)', 'GET', {
    path: '/api/admin/audit?limit=10', cookie: A,
  });
  await compare('/api/admin/search', 'GET', {
    path: `/api/admin/search?q=${encodeURIComponent(target.email)}`, cookie: A,
  });

  // Impersonation — per-side assert cookie format
  for (const [tag, base] of [['OLD', OLD], ['NEW', NEW]]) {
    const res = await fetch(`${base}/api/admin/impersonate`, {
      method: 'POST',
      headers: { cookie: A, 'content-type': 'application/json' },
      body: JSON.stringify({ userId: target.id, reason: 'proof impersonate test' }),
    });
    const setC = res.headers.getSetCookie().find((c) => c.startsWith('cogniva-imp='));
    const val = setC?.split(';')[0]?.slice('cogniva-imp='.length) ?? '';
    const [payload] = val.split('.');
    let decoded = null;
    try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch {}
    const ok = res.status === 200 && val.split('.').length === 2
      && decoded?.targetUserId === target.id && decoded?.mode === 'readonly';
    check(`POST /api/admin/impersonate (${tag} — cookie ký HMAC)`, ok, `status=${res.status}`);
    await fetch(`${base}/api/admin/impersonate`, { method: 'DELETE', headers: { cookie: `${A}; ${setC?.split(';')[0]}` } });
  }

  // System flags/maintenance — twin key
  await compare('/api/admin/system/flags (POST)', 'POST', {
    path: '/api/admin/system/flags',
    bodyOld: { name: `w7-proof-a`, value: true, reason: 'proof flag test' },
    bodyNew: { name: `w7-proof-b`, value: true, reason: 'proof flag test' },
    cookie: A,
  });
  await compare('/api/admin/system/flags (GET same-resource)', 'GET', {
    path: '/api/admin/system/flags', cookie: A,
  });
  await compare('/api/admin/system/maintenance (GET)', 'GET', {
    path: '/api/admin/system/maintenance', cookie: A,
  });
  {
    const a = await call(OLD, 'GET', '/api/admin/system/jobs', undefined, A);
    const b = await call(NEW, 'GET', '/api/admin/system/jobs', undefined, A);
    // Deviation CÓ CHỦ ĐÍCH: web crons=[] sau W6, api crons=11 (cron-v2)
    const ok = a.status === 200 && b.status === 200
      && Array.isArray(a.body.queues) && Array.isArray(b.body.queues)
      && (a.body.crons?.length ?? 0) === 0 && b.body.crons?.length === 11;
    check('GET /api/admin/system/jobs (deviation: OLD crons=0, NEW crons=11)', ok,
      `OLD crons=${a.body.crons?.length} NEW crons=${b.body.crons?.length}`);
  }

  // Moderation — seed twin content_report
  async function seedReport(targetUserId) {
    const id = crypto.randomUUID();
    await prisma.content_report.create({
      data: {
        id, reporter_id: admin.id, target_type: 'user', target_id: targetUserId,
        reason: 'spam', status: 'PENDING',
      },
    });
    return id;
  }
  const repA = await seedReport(target.id);
  const repB = await seedReport(targetB.id);
  await compare('/api/admin/moderation/reports (same-resource)', 'GET', {
    path: '/api/admin/moderation/reports', cookie: A,
  });
  await compare('/api/admin/moderation/reports/:id/resolve (dismiss)', 'POST', {
    pathOld: `/api/admin/moderation/reports/${repA}/resolve`,
    pathNew: `/api/admin/moderation/reports/${repB}/resolve`,
    body: { resolution: 'dismiss', reason: 'proof dismiss test' },
    cookie: A,
  });
  await compare('/api/admin/moderation/banned', 'GET', {
    path: '/api/admin/moderation/banned', cookie: A,
  });

  // Admin AI — seed circuit keys + usage rows
  {
    const { default: IORedis } = await import('ioredis');
    const r = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    await r.set('cb:state:llm:w7proof', 'OPEN', 'EX', 120);
    await r.set('cb:fail:llm:w7proof', '5', 'EX', 120);
    {
      // BUG-FIX: web listCircuits gọi redis.scan trên IoRedisAdapter KHÔNG có
      // method scan → TypeError bị catch → LUÔN trả []. Bản Nest liệt kê đúng.
      const a = await call(OLD, 'GET', '/api/admin/ai/circuits', undefined, A);
      const b = await call(NEW, 'GET', '/api/admin/ai/circuits', undefined, A);
      const ok = a.status === 200 && b.status === 200
        && a.body.circuits?.length === 0
        && b.body.circuits?.some((c) => c.name === 'llm:w7proof' && c.state === 'OPEN');
      check('GET /api/admin/ai/circuits (BUG-FIX: OLD luôn [] vì adapter thiếu scan, NEW liệt kê đúng)', ok,
        `OLD=${a.body.circuits?.length} NEW=${JSON.stringify(b.body.circuits)?.slice(0, 120)}`);
    }
    await compare('/api/admin/ai/circuits/reset', 'POST', {
      pathOld: '/api/admin/ai/circuits/reset', pathNew: '/api/admin/ai/circuits/reset',
      bodyOld: { name: 'llm:w7proof', reason: 'proof reset test' },
      bodyNew: { name: 'llm:w7proof-b', reason: 'proof reset test' },
      cookie: A,
    });
    await r.quit();
  }
  await prisma.ai_usage_log.create({
    data: {
      id: crypto.randomUUID(), user_id: userA.id, feature: 'chat', provider: 'groq',
      model: 'llama-3.3-70b-versatile', tokens_in: 100, tokens_out: 50,
      cost_usd: 0.001, cached: false,
    },
  });
  await compare('/api/admin/ai/cost', 'GET', { path: '/api/admin/ai/cost?days=7', cookie: A });
  await compare('/api/admin/ai/usage', 'GET', { path: '/api/admin/ai/usage', cookie: A });

  // Admin conversations (rows từ chat test) + documents 404 + tutoring rỗng
  await compare('/api/admin/conversations (list)', 'GET', {
    path: '/api/admin/conversations?limit=5', cookie: A,
  });
  await compare('/api/admin/conversations/:id (same-resource)', 'GET', {
    path: `/api/admin/conversations/${sA.convId}`, cookie: A,
  });
  await compare('/api/admin/conversations/:id (DELETE twin)', 'DELETE', {
    pathOld: `/api/admin/conversations/${sA.convId}`,
    pathNew: `/api/admin/conversations/${sB.convId}`,
    body: { reason: 'proof delete test' },
    cookie: A,
  });
  await compare('/api/admin/documents (list)', 'GET', {
    path: '/api/admin/documents?limit=5', cookie: A,
  });
  await compare('/api/admin/documents/:id (404)', 'GET', {
    path: '/api/admin/documents/00000000-0000-4000-8000-000000000000', cookie: A,
  });
  await compare('/api/admin/tutoring/bookings (list)', 'GET', {
    path: '/api/admin/tutoring/bookings?limit=5', cookie: A,
  });
  await compare('/api/admin/tutoring/reviews (list)', 'GET', {
    path: '/api/admin/tutoring/reviews', cookie: A,
  });
  {
    // Deviation CÓ CHỦ ĐÍCH: route KYC cũ auth legacy isAdminEmail (env
    // ADMIN_EMAILS) → admin theo admin_role bị 403; bản Nest đồng nhất AdminGuard.
    const a = await call(OLD, 'GET', '/api/admin/kyc', undefined, A);
    const b = await call(NEW, 'GET', '/api/admin/kyc', undefined, A);
    const ok = a.status === 403 && b.status === 200 && Array.isArray(b.body.tutors);
    check('GET /api/admin/kyc (deviation: OLD legacy email-guard 403, NEW AdminGuard 200)', ok,
      `OLD=${a.status} NEW=${b.status}`);
  }

  // Quyền: user thường gọi admin → 401
  await compare('/api/admin/users (non-admin → 401)', 'GET', {
    path: '/api/admin/users', cookieOld: userA.cookie, cookieNew: userB.cookie,
  });

  // ════ ACCOUNT ═══════════════════════════════════════════════════════════════
  await compare('/api/account/usage', 'GET', {
    path: '/api/account/usage', cookieOld: userA.cookie, cookieNew: userB.cookie,
  });
  // Token là unique per-device — twin phải dùng token RIÊNG mỗi bên.
  await compare('/api/account/push-token (POST)', 'POST', {
    path: '/api/account/push-token',
    bodyOld: { token: `ExponentPushToken[w7proofA${stamp}]`, platform: 'android' },
    bodyNew: { token: `ExponentPushToken[w7proofB${stamp}]`, platform: 'android' },
    cookieOld: userA.cookie, cookieNew: userB.cookie,
  });
  await compare('/api/account/push-token (DELETE)', 'DELETE', {
    path: '/api/account/push-token',
    bodyOld: { token: `ExponentPushToken[w7proofA${stamp}]` },
    bodyNew: { token: `ExponentPushToken[w7proofB${stamp}]` },
    cookieOld: userA.cookie, cookieNew: userB.cookie,
  });
  {
    const a = await call(OLD, 'POST', '/api/account/export', undefined, userA.cookie);
    const b = await call(NEW, 'POST', '/api/account/export', undefined, userB.cookie);
    const keys = (r) => (r.body && typeof r.body === 'object' ? Object.keys(r.body).sort().join(',') : String(r.body));
    const ok = a.status === b.status && keys(a) === keys(b)
      && (a.headers.get('content-disposition') ?? '').startsWith('attachment')
      && (b.headers.get('content-disposition') ?? '').startsWith('attachment');
    check('POST /api/account/export (status + key-set + attachment)', ok,
      ok ? `status=${a.status}` : `\n  OLD keys=${keys(a)}\n  NEW keys=${keys(b)}`);
  }
  await compare('/api/account/delete (POST schedule)', 'POST', {
    path: '/api/account/delete',
    body: { confirm: 'DELETE', reason: 'proof' },
    cookieOld: userA.cookie, cookieNew: userB.cookie,
  });
  await compare('/api/account/delete (POST lần 2 → 409)', 'POST', {
    path: '/api/account/delete',
    body: { confirm: 'DELETE', reason: 'proof' },
    cookieOld: userA.cookie, cookieNew: userB.cookie,
  });
  await compare('/api/account/delete (GET pending)', 'GET', {
    path: '/api/account/delete', cookieOld: userA.cookie, cookieNew: userB.cookie,
  });
  await compare('/api/account/delete (DELETE cancel)', 'DELETE', {
    path: '/api/account/delete', cookieOld: userA.cookie, cookieNew: userB.cookie,
  });
  {
    const a = await call(OLD, 'GET', '/api/health');
    const b = await call(NEW, 'GET', '/api/health');
    const ok = a.status === b.status && a.body?.status === b.body?.status
      && a.body?.checks?.db?.ok === b.body?.checks?.db?.ok
      && a.body?.checks?.redis?.ok === b.body?.checks?.redis?.ok;
    check('GET /api/health (status + db/redis checks)', ok, `status=${a.status} app=${a.body?.status}/${b.body?.status}`);
  }

  // ════ 2FA E2E (feature MỚI — chỉ NEW) ═══════════════════════════════════════
  {
    const u = await signUp('2fa', 'W7 TwoFA');
    const en = await call(NEW, 'POST', '/api/auth/2fa/enable', { password: u.password }, u.cookie);
    const okEnable = en.status === 200 && en.raw.includes('otpauth://totp/')
      && JSON.parse(en.raw).backupCodes?.length === 10;
    check('POST /api/auth/2fa/enable (totpURI + 10 backup codes)', okEnable, `status=${en.status}`);

    const parsed = JSON.parse(en.raw);
    const secretB32 = new URL(parsed.totpURI).searchParams.get('secret');
    const secretBytes = base32Decode(secretB32);
    const ver = await call(NEW, 'POST', '/api/auth/2fa/verify', { code: totp(secretBytes) }, u.cookie);
    const flag = await prisma.user.findUnique({ where: { id: u.id }, select: { two_factor_enabled: true } });
    check('POST /api/auth/2fa/verify (bật two_factor_enabled)', ver.status === 200 && flag.two_factor_enabled === true, `status=${ver.status}`);

    // Sign-in → 2FA required → TOTP
    const si = await call(NEW, 'POST', '/api/auth/sign-in', { email: u.email, password: u.password });
    const okChallenge = si.status === 200 && si.raw.includes('twoFactorRequired');
    const challenge = okChallenge ? JSON.parse(si.raw).challengeToken : null;
    check('POST sign-in (user 2FA → twoFactorRequired + challengeToken)', okChallenge, `status=${si.status}`);

    const fin = await call(NEW, 'POST', '/api/auth/sign-in/2fa', { challengeToken: challenge, code: totp(secretBytes) });
    check('POST sign-in/2fa (TOTP đúng → tokens)', fin.status === 200 && fin.raw.includes('accessToken'), `status=${fin.status}`);

    // Backup code 1 lần
    const si2 = await call(NEW, 'POST', '/api/auth/sign-in', { email: u.email, password: u.password });
    const ch2 = JSON.parse(si2.raw).challengeToken;
    const bc = parsed.backupCodes[0];
    const finB = await call(NEW, 'POST', '/api/auth/sign-in/2fa', { challengeToken: ch2, code: bc });
    const si3 = await call(NEW, 'POST', '/api/auth/sign-in', { email: u.email, password: u.password });
    const ch3 = JSON.parse(si3.raw).challengeToken;
    const finB2 = await call(NEW, 'POST', '/api/auth/sign-in/2fa', { challengeToken: ch3, code: bc });
    check('POST sign-in/2fa (backup code dùng 1 lần: lần 1 OK, lần 2 401)',
      finB.status === 200 && finB2.status === 401, `lần1=${finB.status} lần2=${finB2.status}`);

    const dis = await call(NEW, 'POST', '/api/auth/2fa/disable', { password: u.password }, u.cookie);
    const flag2 = await prisma.user.findUnique({ where: { id: u.id }, select: { two_factor_enabled: true } });
    check('POST /api/auth/2fa/disable', dis.status === 200 && flag2.two_factor_enabled === false, `status=${dis.status}`);
  }

  // ════ AUTH SHIM SSR — page render qua cg_at (web đã bỏ Better Auth session) ═
  {
    const res = await fetch(`${OLD}/dashboard`, { headers: { cookie: userA.cgAt }, redirect: 'manual' });
    check('SSR shim: GET /dashboard với cookie cg_at → 200 (không redirect sign-in)',
      res.status === 200, `status=${res.status}`);
    const res2 = await fetch(`${OLD}/dashboard`, { redirect: 'manual' });
    check('SSR shim: GET /dashboard không cookie → redirect',
      res2.status >= 300 && res2.status < 400, `status=${res2.status}`);
  }
} catch (err) {
  check(`PROOF CRASH: ${err.message}`, false, err.stack?.split('\n').slice(1, 3).join(' '));
} finally {
  const pass = results.filter(Boolean).length;
  console.log(`\n══ KẾT QUẢ: ${pass}/${results.length} PASS ══`);
  await prisma.$disconnect();
  process.exit(pass === results.length ? 0 : 1);
}

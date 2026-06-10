/**
 * Proof Wave 4 — golden diff social/realtime (groups/dm/channels/rooms/
 * notifications/reports/realtime-auth/questions-grade): cùng request bắn
 * route CŨ (Next :3100) và MỚI (Nest :4000), normalize, so byte.
 *
 * Kỹ thuật như Wave 3: đọc shared-resource gọi cả 2 bên; write cross (OLD ghi
 * resource A, NEW ghi resource B mirror). Side-effect realtime/push không
 * hiện trong response — KHÔNG so ở đây (socket smoke riêng sau cutover).
 * LiveKit egress THẬT không chạy (chỉ test token + error paths).
 * Cần cả 2 server + Redis + Neon. Tự dọn user test.
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
const stamp = Date.now();
const results = [];
const check = (name, ok, extra = '') => {
  results.push(ok);
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`);
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const IDISH_KEY = /(^id$|Id$|^key$|^url$|^email$|Code$|^code$|^storageKey$|^token$)/;
// affected: đếm row update phụ thuộc lịch sử (mark-all-read); token LiveKit/collab có jti/exp random.
const VOLATILE_KEY = /^(ipAddress|timeSpentSeconds|lastMessageAt|affected|lastSeenAt|expiresAt)$/;
const UUID_IN_STR = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const CUIDISH = /\b[a-z0-9]{24,32}\b/g;
function normalize(v, key = '') {
  if (VOLATILE_KEY.test(key)) return `<${key}>`;
  if (Array.isArray(v)) return v.map((x) => normalize(x, key));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalize(x, k)]));
  }
  if (typeof v === 'string') {
    if (ISO.test(v)) return '<ts>';
    if (IDISH_KEY.test(key)) return `<${key}>`;
    // uuid lẫn cuid đều thay bằng CÙNG token: id-format deviation (api sinh
    // randomUUID thay cuid2) đã chấp nhận từ Wave 3 — id opaque với client.
    return v.replace(UUID_IN_STR, '<rid>').replace(CUIDISH, '<rid>');
  }
  if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 1e6) / 1e6;
  return v;
}

async function call(base, method, path, body, cookie) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text || null; }
  return { status: res.status, body: normalize(parsed) };
}

async function compare(name, method, opts) {
  const { cacheKeys = [], statusOnly = false } = opts;
  if (cacheKeys.length) await cacheDelete(...cacheKeys);
  const a = await call(OLD, method, opts.pathOld ?? opts.path, opts.bodyOld ?? opts.body, opts.cookieOld ?? opts.cookie);
  if (cacheKeys.length) await cacheDelete(...cacheKeys);
  const b = await call(NEW, method, opts.pathNew ?? opts.path, opts.bodyNew ?? opts.body, opts.cookieNew ?? opts.cookie);
  const same = statusOnly ? a.status === b.status : JSON.stringify(a) === JSON.stringify(b);
  check(`${method} ${name}${statusOnly ? ' (status-only)' : ''}`, same,
    same ? `status=${a.status}` : `\n  OLD=${JSON.stringify(a).slice(0, 500)}\n  NEW=${JSON.stringify(b).slice(0, 500)}`);
  return { a, b };
}

async function signUp(tag) {
  const email = `wave4-${tag}-${stamp}@test.cogniva.local`;
  // Tên CỐ ĐỊNH cho mọi user test: V/W làm peer trong DM cross-compare —
  // tên khác nhau sẽ lệch byte ở field peer.name.
  const r = await fetch(`${NEW}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wave4-proof-12', name: 'W4 Proof' }),
  });
  if (r.status >= 300) throw new Error(`sign-up ${tag} fail ${r.status}`);
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token=')).split(';')[0];
  const { user } = await r.json();
  return { email, cookie, id: user.id };
}

const U = await signUp('owner');
const V = await signUp('member');
const W = await signUp('outsider');
console.log(`• U=${U.id} V=${V.id} W=${W.id}\n`);

try {
  // ════ GROUPS ═══════════════════════════════════════════════════════════
  const gKeys = () => [ck.groupsList(U.id)];
  await compare('/groups (rỗng)', 'GET', { path: '/api/groups', cookie: U.cookie, cacheKeys: gKeys() });
  await compare('/groups (tạo cross)', 'POST', { path: '/api/groups', cookie: U.cookie, body: { name: 'Group Proof' }, cacheKeys: gKeys() });
  const gRows = await prisma.$queryRaw`SELECT id, invite_code FROM study_group WHERE owner_user_id = ${U.id} ORDER BY created_at`;
  const [gA, gB] = [gRows[0], gRows[1]];
  if (!gA || !gB) throw new Error('không tạo được 2 group');
  await compare('/groups (2 group)', 'GET', { path: '/api/groups', cookie: U.cookie, cacheKeys: gKeys() });
  await compare('/groups/:id', 'GET', { path: `/api/groups/${gA.id}`, cookie: U.cookie, cacheKeys: [ck.groupDetail(gA.id)] });
  await compare('/groups/:id (404)', 'GET', { path: '/api/groups/khong-ton-tai', cookie: U.cookie });
  await compare('/groups/:id (PUT cross)', 'PUT', {
    path: '', pathOld: `/api/groups/${gA.id}`, pathNew: `/api/groups/${gB.id}`,
    cookie: U.cookie, body: { name: 'Group Proof v2' }, cacheKeys: [ck.groupDetail(gA.id), ck.groupDetail(gB.id)],
  });

  // V join cả 2 group (mã invite_code của group).
  await compare('/groups/join (cross)', 'POST', {
    path: '/api/groups/join', cookie: V.cookie,
    bodyOld: { code: gA.invite_code }, bodyNew: { code: gB.invite_code },
  });
  await compare('/groups/join (404 code)', 'POST', { path: '/api/groups/join', cookie: V.cookie, body: { code: 'ZZZZZZZZ' } });

  // Categories + channels (cross trên gA/gB, đọc chung trên gA).
  await compare('/groups/:id/categories (POST cross)', 'POST', {
    path: '', pathOld: `/api/groups/${gA.id}/categories`, pathNew: `/api/groups/${gB.id}/categories`,
    cookie: U.cookie, body: { name: 'Cat Proof' },
  });
  await compare('/groups/:id/categories (GET)', 'GET', { path: `/api/groups/${gA.id}/categories`, cookie: U.cookie });
  for (const type of ['TEXT', 'VOICE', 'STAGE', 'FORUM']) {
    await compare(`/groups/:id/channels (POST ${type} cross)`, 'POST', {
      path: '', pathOld: `/api/groups/${gA.id}/channels`, pathNew: `/api/groups/${gB.id}/channels`,
      cookie: U.cookie, body: { name: `kenh-${type.toLowerCase()}`, type },
    });
  }
  await compare('/groups/:id/channels (GET)', 'GET', { path: `/api/groups/${gA.id}/channels`, cookie: U.cookie, cacheKeys: [ck.groupDetail(gA.id)] });
  const chRows = await prisma.$queryRaw`SELECT id, name, type, group_id FROM study_group_channel WHERE group_id IN (${gA.id}, ${gB.id})`;
  const chOf = (g, type) => chRows.find((c) => c.group_id === g && c.type === type)?.id;
  const [textA, textB] = [chOf(gA.id, 'TEXT'), chOf(gB.id, 'TEXT')];
  const [voiceA, voiceB] = [chOf(gA.id, 'VOICE'), chOf(gB.id, 'VOICE')];
  const [stageA, stageB] = [chOf(gA.id, 'STAGE'), chOf(gB.id, 'STAGE')];
  const [forumA, forumB] = [chOf(gA.id, 'FORUM'), chOf(gB.id, 'FORUM')];
  await compare('/groups/:id/channels/:chId (PUT cross)', 'PUT', {
    path: '', pathOld: `/api/groups/${gA.id}/channels/${textA}`, pathNew: `/api/groups/${gB.id}/channels/${textB}`,
    cookie: U.cookie, body: { topic: 'Topic proof' },
  });
  await compare('/groups/:id/channels/:chId/typing (POST)', 'POST', { path: `/api/groups/${gA.id}/channels/${textA}/typing`, cookie: U.cookie, body: {} });

  // Invites + members + mute + roles.
  await compare('/groups/:id/invites (POST cross)', 'POST', {
    path: '', pathOld: `/api/groups/${gA.id}/invites`, pathNew: `/api/groups/${gB.id}/invites`,
    cookie: U.cookie, body: { maxUses: 5 },
  });
  await compare('/groups/:id/invites (GET)', 'GET', { path: `/api/groups/${gA.id}/invites`, cookie: U.cookie });
  await compare('/groups/:id/members (GET)', 'GET', { path: `/api/groups/${gA.id}/members`, cookie: U.cookie, cacheKeys: [ck.groupMembers(gA.id)] });
  await compare('/groups/:id/members/:userId (GET)', 'GET', { path: `/api/groups/${gA.id}/members/${V.id}`, cookie: U.cookie });
  await compare('/groups/:id/members/:userId (PUT nickname cross)', 'PUT', {
    path: '', pathOld: `/api/groups/${gA.id}/members/${V.id}`, pathNew: `/api/groups/${gB.id}/members/${V.id}`,
    cookie: U.cookie, body: { nickname: 'Nick Proof' }, cacheKeys: [ck.groupMembers(gA.id), ck.groupMembers(gB.id)],
  });
  await compare('/groups/:id/members/:userId/mute (POST cross)', 'POST', {
    path: '', pathOld: `/api/groups/${gA.id}/members/${V.id}/mute`, pathNew: `/api/groups/${gB.id}/members/${V.id}/mute`,
    cookie: U.cookie, body: { durationSec: 60 },
  });
  await compare('/groups/:id/members/:userId/mute (DELETE cross)', 'DELETE', {
    path: '', pathOld: `/api/groups/${gA.id}/members/${V.id}/mute`, pathNew: `/api/groups/${gB.id}/members/${V.id}/mute`,
    cookie: U.cookie,
  });
  await compare('/groups/:id/roles (POST cross)', 'POST', {
    path: '', pathOld: `/api/groups/${gA.id}/roles`, pathNew: `/api/groups/${gB.id}/roles`,
    cookie: U.cookie, body: { name: 'Role Proof', color: '#ff8800' },
  });
  await compare('/groups/:id/roles (GET)', 'GET', { path: `/api/groups/${gA.id}/roles`, cookie: U.cookie });
  await compare('/groups/:id/unread (GET)', 'GET', { path: `/api/groups/${gA.id}/unread`, cookie: U.cookie, cacheKeys: [ck.groupUnread(gA.id, U.id)] });
  await compare('/groups/:id/audit (GET)', 'GET', { path: `/api/groups/${gA.id}/audit`, cookie: U.cookie });
  await compare('/groups/:id/search (GET)', 'GET', { path: `/api/groups/${gA.id}/search?q=hello`, cookie: U.cookie });
  await compare('/groups/resource-search (GET)', 'GET', { path: '/api/groups/resource-search?q=proof&type=document', cookie: U.cookie });
  await compare('/groups (403 outsider)', 'GET', { path: `/api/groups/${gA.id}/members`, cookie: W.cookie });

  // ════ DM ═══════════════════════════════════════════════════════════════
  await compare('/dm (POST cross)', 'POST', {
    path: '/api/dm', cookie: U.cookie,
    bodyOld: { peerUserId: V.id }, bodyNew: { peerUserId: W.id },
  });
  await compare('/dm (GET)', 'GET', { path: '/api/dm', cookie: U.cookie });
  const dmRows = await prisma.$queryRaw`SELECT id, user1_id, user2_id FROM dm_thread WHERE user1_id IN (${U.id}) OR user2_id IN (${U.id}) ORDER BY created_at`;
  const dmUV = dmRows.find((t) => [t.user1_id, t.user2_id].includes(V.id))?.id;
  const dmUW = dmRows.find((t) => [t.user1_id, t.user2_id].includes(W.id))?.id;
  await compare('/dm/:threadId/messages (POST cross)', 'POST', {
    path: '', pathOld: `/api/dm/${dmUV}/messages`, pathNew: `/api/dm/${dmUW}/messages`,
    cookie: U.cookie, body: { content: 'DM proof xin chào' },
  });
  await compare('/dm/:threadId/messages (GET)', 'GET', { path: `/api/dm/${dmUV}/messages`, cookie: U.cookie });
  await compare('/dm/:threadId/messages (403 outsider)', 'GET', { path: `/api/dm/${dmUV}/messages`, cookie: W.cookie });

  // ════ CHANNELS — text/forum/thread ═════════════════════════════════════
  await compare('/channels/:id/messages (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${textA}/messages`, pathNew: `/api/channels/${textB}/messages`,
    cookie: U.cookie, body: { content: 'Tin nhắn proof đầu tiên' },
  });
  const msgRows = await prisma.$queryRaw`SELECT id, channel_id FROM study_group_message WHERE author_id = ${U.id} AND channel_id IN (${textA}, ${textB}) ORDER BY created_at`;
  const msgA = msgRows.find((m) => m.channel_id === textA)?.id;
  const msgB = msgRows.find((m) => m.channel_id === textB)?.id;
  await compare('/channels/:id/messages (GET)', 'GET', { path: `/api/channels/${textA}/messages`, cookie: U.cookie });
  await compare('/channels/:id/messages/:msgId (PUT cross)', 'PUT', {
    path: '', pathOld: `/api/channels/${textA}/messages/${msgA}`, pathNew: `/api/channels/${textB}/messages/${msgB}`,
    cookie: U.cookie, body: { content: 'Tin nhắn proof (đã sửa)' },
  });
  await compare('/channels/:id/messages/:msgId/history (GET)', 'GET', { path: `/api/channels/${textA}/messages/${msgA}/history`, cookie: U.cookie });
  await compare('/channels/:id/messages/:msgId/react (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${textA}/messages/${msgA}/react`, pathNew: `/api/channels/${textB}/messages/${msgB}/react`,
    cookie: U.cookie, body: { emoji: '🔥' },
  });
  await compare('/channels/:id/messages/:msgId/pin (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${textA}/messages/${msgA}/pin`, pathNew: `/api/channels/${textB}/messages/${msgB}/pin`,
    cookie: U.cookie, body: { pinned: true },
  });
  await compare('/channels/:id/pinned (GET)', 'GET', { path: `/api/channels/${textA}/pinned`, cookie: U.cookie });
  await compare('/channels/:id/messages/:msgId/thread (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${textA}/messages/${msgA}/thread`, pathNew: `/api/channels/${textB}/messages/${msgB}/thread`,
    cookie: U.cookie, body: { content: 'Reply trong thread proof' },
  });
  await compare('/channels/:id/messages/:msgId/thread (GET)', 'GET', { path: `/api/channels/${textA}/messages/${msgA}/thread`, cookie: U.cookie });
  await compare('/channels/:id/threads (GET)', 'GET', { path: `/api/channels/${textA}/threads`, cookie: U.cookie });
  await compare('/channels/:id/read (POST)', 'POST', { path: `/api/channels/${textA}/read`, cookie: U.cookie, body: {} });
  await compare('/channels/:id/notification-setting (GET)', 'GET', { path: `/api/channels/${textA}/notification-setting`, cookie: U.cookie });
  await compare('/channels/:id/notification-setting (PUT cross)', 'PUT', {
    path: '', pathOld: `/api/channels/${textA}/notification-setting`, pathNew: `/api/channels/${textB}/notification-setting`,
    cookie: U.cookie, body: { setting: 'mention' },
  });
  // Forum: post bài (message kèm title) rồi đọc list.
  await compare('/channels/:id/messages (POST forum cross)', 'POST', {
    path: '', pathOld: `/api/channels/${forumA}/messages`, pathNew: `/api/channels/${forumB}/messages`,
    cookie: U.cookie, body: { content: 'Nội dung bài forum proof', title: 'Bài forum proof' },
  });
  await compare('/channels/:id/forum (GET)', 'GET', { path: `/api/channels/${forumA}/forum`, cookie: U.cookie });
  await compare('/channels/:id/forum (400 non-forum)', 'GET', { path: `/api/channels/${textA}/forum`, cookie: U.cookie });
  await compare('/channels/:id/ai-reply (400 no-mention)', 'POST', { path: `/api/channels/${textA}/ai-reply`, cookie: U.cookie, body: { content: 'hello khong mention' } });

  // ════ CHANNELS — voice/stage/record/collab ═════════════════════════════
  await compare('/channels/:id/voice/join (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${voiceA}/voice/join`, pathNew: `/api/channels/${voiceB}/voice/join`,
    cookie: U.cookie, body: {},
  });
  await compare('/channels/:id/voice/state (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${voiceA}/voice/state`, pathNew: `/api/channels/${voiceB}/voice/state`,
    cookie: U.cookie, body: { selfMuted: false },
  });
  await compare('/channels/:id/voice/participants (GET)', 'GET', { path: `/api/channels/${voiceA}/voice/participants`, cookie: U.cookie });
  await compare('/channels/:id/voice/token (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${voiceA}/voice/token`, pathNew: `/api/channels/${voiceB}/voice/token`,
    cookie: U.cookie, body: {},
  });
  await compare('/channels/:id/voice/leave (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${voiceA}/voice/leave`, pathNew: `/api/channels/${voiceB}/voice/leave`,
    cookie: U.cookie, body: {},
  });
  await compare('/channels/:id/stage (GET)', 'GET', { path: `/api/channels/${stageA}/stage`, cookie: U.cookie });
  await compare('/channels/:id/stage (POST raise-hand cross V)', 'POST', {
    path: '', pathOld: `/api/channels/${stageA}/stage`, pathNew: `/api/channels/${stageB}/stage`,
    cookie: V.cookie, body: { raised: true },
  });
  await compare('/channels/:id/stage/promote/:userId (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${stageA}/stage/promote/${V.id}`, pathNew: `/api/channels/${stageB}/stage/promote/${V.id}`,
    cookie: U.cookie, body: {},
  });
  await compare('/channels/:id/stage/demote/:userId (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${stageA}/stage/demote/${V.id}`, pathNew: `/api/channels/${stageB}/stage/demote/${V.id}`,
    cookie: U.cookie, body: {},
  });
  await compare('/channels/:id/record (GET rỗng)', 'GET', { path: `/api/channels/${voiceA}/record`, cookie: U.cookie });
  await compare('/channels/:id/record/:recId/stop (404)', 'POST', { path: `/api/channels/${voiceA}/record/khong-ton-tai/stop`, cookie: U.cookie, body: {} });
  await compare('/channels/:id/record/:recId (DELETE 404)', 'DELETE', { path: `/api/channels/${voiceA}/record/khong-ton-tai`, cookie: U.cookie });
  await compare('/channels/:id/collab-token (POST cross)', 'POST', {
    path: '', pathOld: `/api/channels/${textA}/collab-token`, pathNew: `/api/channels/${textB}/collab-token`,
    cookie: U.cookie, body: { kind: 'whiteboard' },
  });

  // ════ ROOMS ════════════════════════════════════════════════════════════
  await compare('/rooms (rỗng)', 'GET', { path: '/api/rooms', cookie: U.cookie, cacheKeys: [ck.roomsList(U.id)] });
  await compare('/rooms (POST cross)', 'POST', {
    path: '/api/rooms', cookie: U.cookie, body: { name: 'Room Proof', type: 'STUDY', visibility: 'UNLISTED' },
    cacheKeys: [ck.roomsList(U.id)],
  });
  const roomRows = await prisma.$queryRaw`SELECT id, join_code FROM room WHERE owner_id = ${U.id} ORDER BY created_at`;
  const [rA, rB] = [roomRows[0], roomRows[1]];
  if (!rA || !rB) throw new Error('không tạo được 2 room');
  await compare('/rooms/:id (GET)', 'GET', { path: `/api/rooms/${rA.id}`, cookie: U.cookie });
  await compare('/rooms/join (cross V)', 'POST', {
    path: '/api/rooms/join', cookie: V.cookie,
    bodyOld: { code: rA.join_code }, bodyNew: { code: rB.join_code },
  });
  await compare('/rooms/join (404)', 'POST', { path: '/api/rooms/join', cookie: V.cookie, body: { code: 'ZZZZZZ' } });
  await compare('/rooms/:id/token (POST cross)', 'POST', {
    path: '', pathOld: `/api/rooms/${rA.id}/token`, pathNew: `/api/rooms/${rB.id}/token`,
    cookie: U.cookie, body: {},
  });
  await compare('/rooms/:id/collab-token (POST cross)', 'POST', {
    path: '', pathOld: `/api/rooms/${rA.id}/collab-token`, pathNew: `/api/rooms/${rB.id}/collab-token`,
    cookie: U.cookie, body: { kind: 'whiteboard' },
  });
  await compare('/rooms/:id/chat (POST cross)', 'POST', {
    path: '', pathOld: `/api/rooms/${rA.id}/chat`, pathNew: `/api/rooms/${rB.id}/chat`,
    cookie: U.cookie, body: { content: 'Chat room proof' },
  });
  await compare('/rooms/:id/chat (GET)', 'GET', { path: `/api/rooms/${rA.id}/chat`, cookie: U.cookie });
  await compare('/rooms/:id/ai-message (400 zod)', 'POST', { path: `/api/rooms/${rA.id}/ai-message`, cookie: U.cookie, body: {} });
  await compare('/rooms/:id/moderate (400 zod)', 'POST', { path: `/api/rooms/${rA.id}/moderate`, cookie: U.cookie, body: {} });
  await compare('/rooms/:id/moderate (403 non-host)', 'POST', { path: `/api/rooms/${rA.id}/moderate`, cookie: V.cookie, body: {} });
  await compare('/rooms/:id/record (GET)', 'GET', { path: `/api/rooms/${rA.id}/record`, cookie: U.cookie });
  await compare('/rooms/:id/record/:recId/stop (404)', 'POST', { path: `/api/rooms/${rA.id}/record/khong-ton-tai/stop`, cookie: U.cookie, body: {} });
  await compare('/rooms/:id (DELETE cross)', 'DELETE', {
    path: '', pathOld: `/api/rooms/${rA.id}`, pathNew: `/api/rooms/${rB.id}`, cookie: U.cookie, cacheKeys: [ck.roomsList(U.id)],
  });

  // ════ NOTIFICATIONS + REPORTS ══════════════════════════════════════════
  // V đã nhận notification từ DM/group-join ở trên.
  await compare('/notifications (GET V)', 'GET', { path: '/api/notifications', cookie: V.cookie });
  await compare('/notifications/read (POST all cross)', 'POST', {
    path: '/api/notifications/read', cookieOld: V.cookie, cookieNew: W.cookie, body: { all: true },
  });
  await compare('/reports (POST cross)', 'POST', {
    path: '/api/reports', cookie: U.cookie,
    bodyOld: { targetType: 'user', targetId: V.id, reason: 'Báo cáo proof — nội dung đủ dài.' },
    bodyNew: { targetType: 'user', targetId: W.id, reason: 'Báo cáo proof — nội dung đủ dài.' },
  });
  await compare('/reports (400 zod)', 'POST', { path: '/api/reports', cookie: U.cookie, body: { targetType: 'user' } });

  // ════ REALTIME AUTH ════════════════════════════════════════════════════
  await compare('/realtime/auth (whoami)', 'POST', { path: '/api/realtime/auth', cookie: U.cookie, body: {} });
  await compare('/realtime/auth (presence-user self)', 'POST', { path: '/api/realtime/auth', cookie: U.cookie, body: { channel: `presence-user-${U.id}` } });
  await compare('/realtime/auth (presence-user other 403)', 'POST', { path: '/api/realtime/auth', cookie: U.cookie, body: { channel: `presence-user-${V.id}` } });
  await compare('/realtime/auth (presence-group member)', 'POST', { path: '/api/realtime/auth', cookie: V.cookie, body: { channel: `presence-group-${gA.id}` } });
  await compare('/realtime/auth (presence-group outsider 403)', 'POST', { path: '/api/realtime/auth', cookie: W.cookie, body: { channel: `presence-group-${gA.id}` } });
  await compare('/realtime/auth (private-channel)', 'POST', { path: '/api/realtime/auth', cookie: U.cookie, body: { channel: `private-channel-${textA}` } });
  await compare('/realtime/auth (presence-voice)', 'POST', { path: '/api/realtime/auth', cookie: U.cookie, body: { channel: `presence-voice-${voiceA}` } });
  await compare('/realtime/auth (presence-voice trên TEXT 403)', 'POST', { path: '/api/realtime/auth', cookie: U.cookie, body: { channel: `presence-voice-${textA}` } });
  await compare('/realtime/auth (private-dm)', 'POST', { path: '/api/realtime/auth', cookie: U.cookie, body: { channel: `private-dm-${dmUV}` } });
  await compare('/realtime/auth (private-dm outsider 403)', 'POST', { path: '/api/realtime/auth', cookie: W.cookie, body: { channel: `private-dm-${dmUV}` } });
  await compare('/realtime/auth (channel lạ 403)', 'POST', { path: '/api/realtime/auth', cookie: U.cookie, body: { channel: 'kenh-khong-hop-le' } });

  // ════ QUESTIONS/GRADE (catch-up W3) ════════════════════════════════════
  const mkQz = async (suffix) => {
    const qid = `w4proof-quiz-${suffix}-${stamp}`;
    await prisma.quiz.create({ data: { id: qid, user_id: U.id, title: 'Grade Quiz' } });
    await prisma.question.create({
      data: { id: `${qid}-q1`, quiz_id: qid, type: 'MCQ', prompt: '2+2=?', options: ['3', '4'], correct_answer: 1, explanation: 'Vì 2+2=4', difficulty: 0.2 },
    });
    return `${qid}-q1`;
  };
  const qA = await mkQz('a');
  const qB = await mkQz('b');
  await compare('/questions/:id/grade (POST cross)', 'POST', {
    path: '', pathOld: `/api/questions/${qA}/grade`, pathNew: `/api/questions/${qB}/grade`,
    cookie: U.cookie, body: { answer: 1 },
  });
  await compare('/questions/:id/grade (404)', 'POST', { path: '/api/questions/khong-ton-tai/grade', cookie: U.cookie, body: { answer: 1 } });
} finally {
  await prisma.$executeRaw`DELETE FROM "user" WHERE email IN (${U.email}, ${V.email}, ${W.email})`;
  await prisma.$executeRaw`DELETE FROM quiz WHERE id LIKE ${'w4proof-quiz-%-' + stamp}`;
  await prisma.$disconnect();
}

const pass = results.every(Boolean);
const failed = results.filter((r) => !r).length;
console.log(pass ? `\n✅ WAVE 4 GOLDEN DIFF PASS (${results.length} checks)` : `\n❌ FAIL ${failed}/${results.length}`);
process.exit(pass ? 0 : 1);

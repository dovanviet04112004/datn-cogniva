/**
 * Proof Wave 6 — golden diff TIỀN (tutors · bookings/payments · market ·
 * concierge · wallet · webhooks): OLD Next :3100 vs NEW Nest :4000.
 *
 * Twin-user mỗi backend (tránh unique tutor_profile + rate-limit Redis chung);
 * read same-resource so cả 2 backend trên cùng row. Webhook replay bằng signed
 * fixtures (VNPay HMAC-SHA512, MoMo HMAC-SHA256, LiveKit JWT sha256) + test
 * idempotency double-delivery. LLM routes (verify-quiz, concierge messages)
 * so status/shape-only.
 */
import { createHmac, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { PrismaClient } from '@prisma/client';

const require = createRequire(import.meta.url);
const { ck, cacheDelete } = require('@cogniva/server-core');
const { AccessToken } = require('livekit-server-sdk');

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
// W6 thêm: bioEmbedding/embedding (vector 1024 float), details (text lỗi Prisma
// ≠ Drizzle), providerRef ('stub-{ms}'), nextSlot (phụ thuộc giờ chạy).
const VOLATILE_KEY = /^(ipAddress|timeSpentSeconds|lastMessageAt|affected|lastSeenAt|expiresAt|aiSummary|costUsd|modelUsed|estimatedDurationSec|fileHash|hash|pageCount|fileSizeBytes|sizeBytes|bioEmbedding|embedding|details|providerRef|nextSlot|withdrawableVnd)$/;
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
    return v.replace(UUID_IN_STR, '<rid>').replace(CUIDISH, '<rid>');
  }
  if (typeof v === 'number' && !Number.isInteger(v)) return Math.round(v * 1e6) / 1e6;
  return v;
}

async function call(base, method, path, body, cookie, opts = {}) {
  const headers = { ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) };
  let payload;
  if (opts.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(body).toString();
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text || null; }
  return { status: res.status, body: normalize(parsed), raw: text, ct: res.headers.get('content-type') ?? '' };
}

async function compare(name, method, opts) {
  const { cacheKeys = [], statusOnly = false } = opts;
  if (cacheKeys.length) await cacheDelete(...cacheKeys);
  const a = await call(OLD, method, opts.pathOld ?? opts.path, opts.bodyOld ?? opts.body, opts.cookieOld ?? opts.cookie, opts);
  if (cacheKeys.length) await cacheDelete(...cacheKeys);
  const b = await call(NEW, method, opts.pathNew ?? opts.path, opts.bodyNew ?? opts.body, opts.cookieNew ?? opts.cookie, opts);
  const stripRaw = ({ raw, ct, ...rest }) => rest;
  const same = statusOnly
    ? a.status === b.status
    : JSON.stringify(stripRaw(a)) === JSON.stringify(stripRaw(b));
  check(`${method} ${name}${statusOnly ? ' (status-only)' : ''}`, same,
    same ? `status=${a.status}` : `\n  OLD=${JSON.stringify(stripRaw(a)).slice(0, 600)}\n  NEW=${JSON.stringify(stripRaw(b)).slice(0, 600)}`);
  return { a, b };
}

/** Twin A/B dùng CÙNG display name — response chứa tên không thành false-diff. */
async function signUp(tag, displayName) {
  const email = `wave6-${tag}-${stamp}@test.cogniva.local`;
  const r = await fetch(`${NEW}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wave6-proof-12', name: displayName }),
  });
  if (r.status >= 300) throw new Error(`sign-up ${tag} fail ${r.status}`);
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token=')).split(';')[0];
  const { user } = await r.json();
  return { email, cookie, id: user.id };
}

// ── Fixture signing helpers ────────────────────────────────────────────────
function signVnpay(params) {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([k]) => k !== 'vnp_SecureHash' && k !== 'vnp_SecureHashType'),
  );
  const qs = Object.keys(filtered).sort()
    .map((k) => `${k}=${encodeURIComponent(filtered[k]).replace(/%20/g, '+')}`)
    .join('&');
  return createHmac('sha512', process.env.VNPAY_HASH_SECRET).update(qs).digest('hex');
}

function signMomo(body) {
  const raw =
    `accessKey=${process.env.MOMO_ACCESS_KEY}`
    + `&amount=${body.amount}`
    + `&extraData=${body.extraData ?? ''}`
    + `&message=${body.message ?? ''}`
    + `&orderId=${body.orderId}`
    + `&orderInfo=${body.orderInfo ?? ''}`
    + `&orderType=${body.orderType ?? ''}`
    + `&partnerCode=${body.partnerCode}`
    + `&payType=${body.payType ?? ''}`
    + `&requestId=${body.requestId}`
    + `&responseTime=${body.responseTime}`
    + `&resultCode=${body.resultCode}`
    + `&transId=${body.transId}`;
  return createHmac('sha256', process.env.MOMO_SECRET_KEY).update(raw).digest('hex');
}

async function livekitAuth(rawBody) {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { ttl: 300 });
  at.sha256 = createHash('sha256').update(rawBody).digest('base64');
  return at.toJwt();
}

async function seedPayment(orderCode, bookingId) {
  const id = crypto.randomUUID();
  await prisma.tutoring_payment.create({
    data: { id, booking_id: bookingId, amount_vnd: 200000, fee_vnd: 20000, provider: 'VNPAY', order_code: orderCode, status: 'CREATED' },
  });
  return id;
}

// ── Setup twin users ───────────────────────────────────────────────────────
const tutA = await signUp('tutor-a', 'W6 Tutor');
const tutB = await signUp('tutor-b', 'W6 Tutor');
const stuA = await signUp('student-a', 'W6 Student');
const stuB = await signUp('student-b', 'W6 Student');
console.log(`• tutors A=${tutA.id} B=${tutB.id} · students A=${stuA.id} B=${stuB.id}\n`);

const ALL_DAYS = Array.from({ length: 7 }, (_, d) => ({ dayOfWeek: d, startTime: '00:00', endTime: '23:59' }));
const startAt = new Date(Math.ceil((stamp + 48 * 3600e3) / 3600e3) * 3600e3); // now+48h tròn giờ
const endAt = new Date(startAt.getTime() + 60 * 60e3);

try {
  // ════ TUTORS (cross-write twin) ═══════════════════════════════════════════
  const tp = await compare('/tutors (create)', 'POST', {
    path: '/api/tutors',
    bodyOld: { headline: 'Gia sư Toán luyện thi THPT QG', bio: 'Kinh nghiệm 5 năm luyện thi Toán THPT Quốc Gia, chuyên hàm số, hình học không gian và xác suất. Phương pháp dạy bám sát đề minh hoạ, có lộ trình riêng cho từng học sinh, cam kết tiến bộ sau 2 tháng. Nhận dạy online qua Google Meet và offline tại Hà Nội khu vực Cầu Giấy.'.padEnd(220, ' Học thử buổi đầu.'), hourlyRateVnd: 200000, modality: 'ONLINE' },
    bodyNew: { headline: 'Gia sư Toán luyện thi THPT QG', bio: 'Kinh nghiệm 5 năm luyện thi Toán THPT Quốc Gia, chuyên hàm số, hình học không gian và xác suất. Phương pháp dạy bám sát đề minh hoạ, có lộ trình riêng cho từng học sinh, cam kết tiến bộ sau 2 tháng. Nhận dạy online qua Google Meet và offline tại Hà Nội khu vực Cầu Giấy.'.padEnd(220, ' Học thử buổi đầu.'), hourlyRateVnd: 200000, modality: 'ONLINE' },
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });
  const profA = (await prisma.tutor_profile.findFirst({ where: { user_id: tutA.id } }))?.id;
  const profB = (await prisma.tutor_profile.findFirst({ where: { user_id: tutB.id } }))?.id;
  if (!profA || !profB) throw new Error('tutor_profile twin chưa tạo được — dừng');

  await compare('/tutors (create lần 2 → reused)', 'POST', {
    path: '/api/tutors',
    body: { headline: 'Gia sư Toán luyện thi THPT QG', bio: 'x'.repeat(200), hourlyRateVnd: 200000, modality: 'ONLINE' },
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });

  await compare('/tutors/:id/subjects (create)', 'POST', {
    pathOld: `/api/tutors/${profA}/subjects`, pathNew: `/api/tutors/${profB}/subjects`,
    body: { subjectSlug: 'math', level: 'HIGH_SCHOOL' },
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });
  await compare('/tutors/:id/subjects (duplicate → 409)', 'POST', {
    pathOld: `/api/tutors/${profA}/subjects`, pathNew: `/api/tutors/${profB}/subjects`,
    body: { subjectSlug: 'math', level: 'HIGH_SCHOOL' },
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });
  const subA = (await prisma.tutor_subject.findFirst({ where: { tutor_id: profA } }))?.id;
  const subB = (await prisma.tutor_subject.findFirst({ where: { tutor_id: profB } }))?.id;

  await compare('/tutors/:id/availability (PUT 7 slot)', 'PUT', {
    pathOld: `/api/tutors/${profA}/availability`, pathNew: `/api/tutors/${profB}/availability`,
    body: { slots: ALL_DAYS },
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });
  await compare('/tutors/:id/availability (slot ngược → 400)', 'PUT', {
    pathOld: `/api/tutors/${profA}/availability`, pathNew: `/api/tutors/${profB}/availability`,
    body: { slots: [...ALL_DAYS, { dayOfWeek: 1, startTime: '10:00', endTime: '08:00' }] },
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });
  // PUT 400 ở trên có thể đã xoá slots tuỳ implement — PUT lại cho chắc.
  for (const [base, prof, u] of [[OLD, profA, tutA], [NEW, profB, tutB]]) {
    await call(base, 'PUT', `/api/tutors/${prof}/availability`, { slots: ALL_DAYS }, u.cookie);
  }

  await compare('/tutors/:id/publish', 'POST', {
    pathOld: `/api/tutors/${profA}/publish`, pathNew: `/api/tutors/${profB}/publish`,
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });
  await compare('/tutors/:id/publish (forbidden — profile người khác)', 'POST', {
    pathOld: `/api/tutors/${profB}/publish`, pathNew: `/api/tutors/${profA}/publish`,
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });

  await compare('/tutors/:id/favorite (toggle on)', 'POST', {
    pathOld: `/api/tutors/${profA}/favorite`, pathNew: `/api/tutors/${profB}/favorite`,
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  await compare('/tutoring/favorites (GET)', 'GET', {
    path: '/api/tutoring/favorites',
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  await compare('/tutors/:id/favorite (404)', 'POST', {
    path: `/api/tutors/00000000-0000-4000-8000-000000000000/favorite`,
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });

  // KYC multipart
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  async function kyc(base, prof, cookie) {
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'cccd.png');
    fd.append('docType', 'CCCD_FRONT');
    const res = await fetch(`${base}/api/tutors/${prof}/kyc`, { method: 'POST', headers: { cookie }, body: fd });
    const body = await res.json().catch(() => null);
    return { status: res.status, body: normalize(body) };
  }
  {
    const a = await kyc(OLD, profA, tutA.cookie);
    const b = await kyc(NEW, profB, tutB.cookie);
    const same = JSON.stringify(a) === JSON.stringify(b);
    check('POST /tutors/:id/kyc (multipart)', same, same ? `status=${a.status}` : `\n  OLD=${JSON.stringify(a)}\n  NEW=${JSON.stringify(b)}`);
  }

  // verify-quiz: LLM Groq → status-only
  await compare('/tutors/:id/subjects/:sid/verify-quiz (LLM)', 'POST', {
    pathOld: `/api/tutors/${profA}/subjects/${subA}/verify-quiz`,
    pathNew: `/api/tutors/${profB}/subjects/${subB}/verify-quiz`,
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
    statusOnly: true,
  });

  // ════ WALLET ═══════════════════════════════════════════════════════════════
  await compare('/wallet (GET fresh)', 'GET', {
    path: '/api/wallet',
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
    cacheKeys: [ck.wallet(stuA.id), ck.wallet(stuB.id)],
  });
  await compare('/wallet/topup (2M → cashback 5%)', 'POST', {
    path: '/api/wallet/topup',
    body: { amountVnd: 2_000_000 },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  {
    // TOPUP + CASHBACK insert cùng tx → created_at bằng nhau, tie-order desc
    // không xác định ở CẢ 2 backend — sort phụ theo type trước khi so.
    await cacheDelete(ck.wallet(stuA.id), ck.wallet(stuB.id));
    const a = await call(OLD, 'GET', '/api/wallet', undefined, stuA.cookie);
    await cacheDelete(ck.wallet(stuA.id), ck.wallet(stuB.id));
    const b = await call(NEW, 'GET', '/api/wallet', undefined, stuB.cookie);
    const sortTxn = (r) => ({ status: r.status, body: { ...r.body, recentTxn: [...(r.body?.recentTxn ?? [])].sort((x, y) => String(x.type).localeCompare(String(y.type))) } });
    const same = JSON.stringify(sortTxn(a)) === JSON.stringify(sortTxn(b));
    check('GET /wallet (GET sau topup, tie-sorted)', same, same ? `status=${a.status}` : `\n  OLD=${JSON.stringify(sortTxn(a)).slice(0, 600)}\n  NEW=${JSON.stringify(sortTxn(b)).slice(0, 600)}`);
  }
  await compare('/wallet/topup (VNPAY chưa wire → 501)', 'POST', {
    path: '/api/wallet/topup',
    body: { amountVnd: 100000, provider: 'VNPAY' },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });

  // ════ BOOKINGS (cross-write twin + same-resource read) ═════════════════════
  const bk = await compare('/tutoring/bookings (create)', 'POST', {
    path: '/api/tutoring/bookings',
    bodyOld: { tutorId: profA, subjectSlug: 'math', level: 'HIGH_SCHOOL', startAt: startAt.toISOString(), endAt: endAt.toISOString(), studentMessage: 'Em muốn ôn hàm số' },
    bodyNew: { tutorId: profB, subjectSlug: 'math', level: 'HIGH_SCHOOL', startAt: startAt.toISOString(), endAt: endAt.toISOString(), studentMessage: 'Em muốn ôn hàm số' },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  const bkA = (await prisma.tutoring_booking.findFirst({ where: { student_id: stuA.id }, orderBy: { created_at: 'desc' } }))?.id;
  const bkB = (await prisma.tutoring_booking.findFirst({ where: { student_id: stuB.id }, orderBy: { created_at: 'desc' } }))?.id;
  if (!bkA || !bkB) throw new Error('booking twin fail');

  await compare('/tutoring/bookings (GET list student)', 'GET', {
    path: '/api/tutoring/bookings?role=student',
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  // same-resource: đọc booking A từ CẢ 2 backend bằng cùng cookie
  await compare('/tutoring/bookings/:id (same-resource)', 'GET', {
    path: `/api/tutoring/bookings/${bkA}`,
    cookie: stuA.cookie,
  });

  await compare('/tutoring/bookings/:id/confirm (tutor)', 'POST', {
    pathOld: `/api/tutoring/bookings/${bkA}/confirm`, pathNew: `/api/tutoring/bookings/${bkB}/confirm`,
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });

  // complete: cần end_at quá khứ — lùi giờ booking qua Prisma trên CẢ 2 row
  const past = new Date(stamp - 3 * 3600e3);
  const pastEnd = new Date(stamp - 2 * 3600e3);
  await prisma.tutoring_booking.updateMany({ where: { id: { in: [bkA, bkB] } }, data: { start_at: past, end_at: pastEnd } });
  await compare('/tutoring/bookings/:id/complete', 'POST', {
    pathOld: `/api/tutoring/bookings/${bkA}/complete`, pathNew: `/api/tutoring/bookings/${bkB}/complete`,
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });
  await compare('/tutoring/bookings/:id/review (201)', 'POST', {
    pathOld: `/api/tutoring/bookings/${bkA}/review`, pathNew: `/api/tutoring/bookings/${bkB}/review`,
    body: { rating: 5, comment: 'Dạy dễ hiểu, đúng trọng tâm' },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  await compare('/tutoring/bookings/:id/review (lần 2 → 409)', 'POST', {
    pathOld: `/api/tutoring/bookings/${bkA}/review`, pathNew: `/api/tutoring/bookings/${bkB}/review`,
    body: { rating: 4 },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });

  // booking 2: confirm rồi cancel (>24h → free, refund STUB)
  const start2 = new Date(startAt.getTime() + 24 * 3600e3);
  const end2 = new Date(start2.getTime() + 60 * 60e3);
  for (const [base, prof, st] of [[OLD, profA, stuA], [NEW, profB, stuB]]) {
    const r = await call(base, 'POST', '/api/tutoring/bookings', { tutorId: prof, subjectSlug: 'math', level: 'HIGH_SCHOOL', startAt: start2.toISOString(), endAt: end2.toISOString() }, st.cookie);
    if (r.status !== 201 && r.status !== 200) throw new Error(`booking2 ${base} fail ${r.status}: ${r.raw?.slice(0, 200)}`);
  }
  const bk2A = (await prisma.tutoring_booking.findFirst({ where: { student_id: stuA.id, start_at: start2 } }))?.id;
  const bk2B = (await prisma.tutoring_booking.findFirst({ where: { student_id: stuB.id, start_at: start2 } }))?.id;
  for (const [base, id, tu] of [[OLD, bk2A, tutA], [NEW, bk2B, tutB]]) {
    await call(base, 'POST', `/api/tutoring/bookings/${id}/confirm`, undefined, tu.cookie);
  }
  await compare('/tutoring/bookings/:id/cancel (>24h, refund STUB)', 'POST', {
    pathOld: `/api/tutoring/bookings/${bk2A}/cancel`, pathNew: `/api/tutoring/bookings/${bk2B}/cancel`,
    body: { reason: 'Bận việc gia đình' },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });

  // payments intent + capture: booking 3 (PENDING — intent không cần confirm)
  for (const [base, prof, st] of [[OLD, profA, stuA], [NEW, profB, stuB]]) {
    const s3 = new Date(start2.getTime() + 24 * 3600e3);
    await call(base, 'POST', '/api/tutoring/bookings', { tutorId: prof, subjectSlug: 'math', level: 'HIGH_SCHOOL', startAt: s3.toISOString(), endAt: new Date(s3.getTime() + 3600e3).toISOString() }, st.cookie);
  }
  const bk3A = (await prisma.tutoring_booking.findFirst({ where: { student_id: stuA.id }, orderBy: { created_at: 'desc' } }))?.id;
  const bk3B = (await prisma.tutoring_booking.findFirst({ where: { student_id: stuB.id }, orderBy: { created_at: 'desc' } }))?.id;
  await compare('/tutoring/payments/intent', 'POST', {
    path: '/api/tutoring/payments/intent',
    bodyOld: { bookingId: bk3A }, bodyNew: { bookingId: bk3B },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  const payA = (await prisma.tutoring_payment.findFirst({ where: { booking_id: bk3A } }))?.id;
  const payB = (await prisma.tutoring_payment.findFirst({ where: { booking_id: bk3B } }))?.id;
  await compare('/tutoring/payments/:id/capture', 'POST', {
    pathOld: `/api/tutoring/payments/${payA}/capture`, pathNew: `/api/tutoring/payments/${payB}/capture`,
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  await compare('/tutoring/payments/:id/capture (idempotent)', 'POST', {
    pathOld: `/api/tutoring/payments/${payA}/capture`, pathNew: `/api/tutoring/payments/${payB}/capture`,
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });

  // payouts: cần KYC_VERIFIED + escrow released
  await prisma.tutor_profile.updateMany({ where: { id: { in: [profA, profB] } }, data: { verification_status: 'KYC_VERIFIED' } });
  await prisma.tutoring_payment.updateMany({
    where: { tutoring_booking: { tutor_id: { in: [profA, profB] } }, status: 'CAPTURED' },
    data: { escrow_release_at: new Date(stamp - 24 * 3600e3) },
  });
  await compare('/tutoring/payouts (GET earnings)', 'GET', {
    path: '/api/tutoring/payouts',
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });
  await compare('/tutoring/payouts (POST request)', 'POST', {
    path: '/api/tutoring/payouts',
    body: { amountVnd: 50000, method: 'BANK_TRANSFER' },
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });

  // calendar/me + ical
  const from = new Date(stamp - 7 * 86400e3).toISOString();
  const to = new Date(stamp + 14 * 86400e3).toISOString();
  await compare('/tutoring/calendar/me', 'GET', {
    path: `/api/tutoring/calendar/me?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });

  const tokA = `w6tokena${stamp}`;
  await prisma.user.update({ where: { id: stuA.id }, data: { booking_ical_token: tokA } });
  {
    const a = await call(OLD, 'GET', `/api/tutoring/ical/${tokA}`);
    const b = await call(NEW, 'GET', `/api/tutoring/ical/${tokA}`);
    const strip = (s) => String(s).replace(/DTSTAMP:[0-9TZ]+/g, 'DTSTAMP:<ts>').replace(UUID_IN_STR, '<rid>').replace(CUIDISH, '<rid>');
    const same = a.status === b.status && strip(a.raw) === strip(b.raw)
      && a.ct.split(';')[0] === b.ct.split(';')[0];
    if (!same) {
      const A = strip(a.raw).split('\n');
      const B = strip(b.raw).split('\n');
      const diffs = A.map((l, i) => (l !== B[i] ? `  L${i}: OLD=${l} | NEW=${B[i]}` : null)).filter(Boolean);
      check('GET /tutoring/ical/:token (same-resource .ics)', false, `\n${diffs.slice(0, 8).join('\n')}\n  lenOLD=${A.length} lenNEW=${B.length} ctOLD=${a.ct} ctNEW=${b.ct}`);
    } else {
      check('GET /tutoring/ical/:token (same-resource .ics)', true, `status=${a.status}`);
    }
  }
  {
    const a = await call(OLD, 'GET', `/api/tutoring/ical/khong-ton-tai-${stamp}`);
    const b = await call(NEW, 'GET', `/api/tutoring/ical/khong-ton-tai-${stamp}`);
    const same = a.status === b.status && a.raw === b.raw;
    check('GET /tutoring/ical/:token (sai token → 404 text)', same, `status=${a.status}`);
  }

  // ════ MARKET ════════════════════════════════════════════════════════════════
  const reqBody = {
    title: 'Cần gia sư Toán lớp 12 ôn thi',
    description: 'Em cần gia sư Toán lớp 12 ôn thi THPT Quốc Gia, tập trung hàm số và hình không gian, học 2 buổi mỗi tuần vào buổi tối.',
    subjectSlug: 'math', level: 'HIGH_SCHOOL', budgetVnd: 250000, modality: 'ONLINE', urgency: 'THIS_WEEK',
  };
  await compare('/tutoring/requests (create)', 'POST', {
    path: '/api/tutoring/requests', body: reqBody,
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  const reqA = (await prisma.tutor_request.findFirst({ where: { student_id: stuA.id } }))?.id;
  const reqB = (await prisma.tutor_request.findFirst({ where: { student_id: stuB.id } }))?.id;

  await compare('/tutoring/requests/:id (same-resource owner)', 'GET', {
    path: `/api/tutoring/requests/${reqA}`, cookie: stuA.cookie,
  });

  await compare('/tutoring/requests/:id/apply', 'POST', {
    pathOld: `/api/tutoring/requests/${reqA}/apply`, pathNew: `/api/tutoring/requests/${reqB}/apply`,
    body: { message: 'Mình có 5 năm kinh nghiệm luyện thi Toán 12, nhận kèm 1-1.', proposedRateVnd: 220000 },
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });
  await compare('/tutoring/requests/:id/apply (lần 2 → 409)', 'POST', {
    pathOld: `/api/tutoring/requests/${reqA}/apply`, pathNew: `/api/tutoring/requests/${reqB}/apply`,
    body: { message: 'Mình có 5 năm kinh nghiệm luyện thi Toán 12, nhận kèm 1-1.', proposedRateVnd: 220000 },
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });
  const appA = (await prisma.tutor_application.findFirst({ where: { request_id: reqA } }))?.id;
  const appB = (await prisma.tutor_application.findFirst({ where: { request_id: reqB } }))?.id;
  await compare('/tutoring/applications/:id (ACCEPTED)', 'PATCH', {
    pathOld: `/api/tutoring/applications/${appA}`, pathNew: `/api/tutoring/applications/${appB}`,
    body: { status: 'ACCEPTED' },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  await compare('/tutoring/requests/:id (PATCH close)', 'PATCH', {
    pathOld: `/api/tutoring/requests/${reqA}`, pathNew: `/api/tutoring/requests/${reqB}`,
    body: { status: 'CLOSED' },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });

  await compare('/tutoring/classes (GET)', 'GET', {
    path: '/api/tutoring/classes', cookie: stuA.cookie,
  });

  // packs purchase: seed pack twin qua Prisma
  async function seedPack(prof) {
    const id = crypto.randomUUID();
    await prisma.tutoring_pack.create({
      data: {
        id, tutor_id: prof, subject_slug: 'math', level: 'HIGH_SCHOOL',
        session_count: 4, rate_per_session_vnd: 150000, total_vnd: 600000,
        status: 'ACTIVE', description: 'Gói 4 buổi proof W6',
      },
    });
    return id;
  }
  const packA = await seedPack(profA);
  const packB = await seedPack(profB);
  await compare('/tutoring/packs/:id/purchase', 'POST', {
    pathOld: `/api/tutoring/packs/${packA}/purchase`, pathNew: `/api/tutoring/packs/${packB}/purchase`,
    body: {},
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  // ví không đủ → 402 (ví đã tiêu — topup ban đầu 2M+100k cashback, đã mua 600k → mua thêm 3 gói nữa sẽ thiếu? dùng user tươi không ví)
  await compare('/tutoring/packs/:id/purchase (ví rỗng → 402)', 'POST', {
    pathOld: `/api/tutoring/packs/${packA}/purchase`, pathNew: `/api/tutoring/packs/${packB}/purchase`,
    body: {},
    cookieOld: tutA.cookie, cookieNew: tutB.cookie,
  });

  // promo redeem: seed twin code
  async function seedPromo(code) {
    await prisma.promo_code.create({
      data: { code, type: 'WALLET_CREDIT', value: 50000, max_uses: 10, per_user_limit: 1, valid_from: new Date(stamp - 86400e3), valid_until: new Date(stamp + 30 * 86400e3) },
    });
  }
  const codeA = `W6PROOFA${stamp % 100000}`;
  const codeB = `W6PROOFB${stamp % 100000}`;
  await seedPromo(codeA); await seedPromo(codeB);
  await compare('/tutoring/promo/redeem', 'POST', {
    path: '/api/tutoring/promo/redeem',
    bodyOld: { code: codeA }, bodyNew: { code: codeB },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  await compare('/tutoring/promo/redeem (code sai → 404)', 'POST', {
    path: '/api/tutoring/promo/redeem',
    body: { code: `KHONGCO${stamp % 1000}` },
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });

  // matches: OLD chạy trước (write-on-read embedding), NEW đọc lại — cùng request row
  {
    const reqM = reqA; // request đã CLOSED vẫn match được? nếu cần OPEN: dùng request mới
    await prisma.tutor_request.update({ where: { id: reqM }, data: { status: 'OPEN' } });
    const a = await call(OLD, 'GET', `/api/tutoring/matches?requestId=${reqM}`, undefined, stuA.cookie);
    const b = await call(NEW, 'GET', `/api/tutoring/matches?requestId=${reqM}`, undefined, stuA.cookie);
    const stripRaw = ({ raw, ct, ...rest }) => rest;
    const same = JSON.stringify(stripRaw(a)) === JSON.stringify(stripRaw(b));
    check('GET /tutoring/matches (same-resource, embedding write-on-read)', same,
      same ? `status=${a.status}` : `\n  OLD=${JSON.stringify(stripRaw(a)).slice(0, 500)}\n  NEW=${JSON.stringify(stripRaw(b)).slice(0, 500)}`);
  }

  await compare('/tutoring/compare (POST)', 'POST', {
    path: '/api/tutoring/compare',
    body: { tutorIds: [profA, profB] },
    cookie: stuA.cookie,
  });

  // ════ CONCIERGE ═════════════════════════════════════════════════════════════
  await compare('/tutoring/concierge/threads (create)', 'POST', {
    path: '/api/tutoring/concierge/threads',
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  await compare('/tutoring/concierge/threads (GET list)', 'GET', {
    path: '/api/tutoring/concierge/threads',
    cookieOld: stuA.cookie, cookieNew: stuB.cookie,
  });
  const thrA = (await prisma.tutoring_concierge_thread.findFirst({ where: { user_id: stuA.id } }))?.id;
  // seed 1 assistant message có metadata để test hydrate same-resource
  await prisma.tutoring_concierge_message.create({
    data: {
      id: crypto.randomUUID(), thread_id: thrA, role: 'assistant',
      content: 'Đây là 2 gia sư phù hợp nhất với yêu cầu của bạn.',
      metadata: { tutorIds: [profA, profB], action: 'search', total: 2, faqId: 'trial-session' },
    },
  });
  await compare('/tutoring/concierge/threads/:id/messages (GET hydrate)', 'GET', {
    path: `/api/tutoring/concierge/threads/${thrA}/messages`,
    cookie: stuA.cookie,
  });
  await compare('/tutoring/concierge/threads/:id/messages (thread người khác → 404)', 'GET', {
    path: `/api/tutoring/concierge/threads/${thrA}/messages`,
    cookie: stuB.cookie,
  });
  // POST messages = SSE + LLM → assert shape từng bên, không byte-compare
  for (const [tag, base, cookie, thr] of [['OLD', OLD, stuA.cookie, thrA]]) {
    void tag; void base; void cookie; void thr;
  }
  {
    const thrB = (await prisma.tutoring_concierge_thread.findFirst({ where: { user_id: stuB.id } }))?.id;
    for (const [tag, base, cookie, thr] of [['OLD', OLD, stuA.cookie, thrA], ['NEW', NEW, stuB.cookie, thrB]]) {
      const res = await fetch(`${base}/api/tutoring/concierge/threads/${thr}/messages`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'buổi học thử có miễn phí không?' }),
      });
      const text = await res.text();
      const ok = res.status === 200
        && (res.headers.get('content-type') ?? '').includes('text/event-stream')
        && text.includes('event: action')
        && (text.includes('event: done') || text.includes('event: error'));
      check(`POST concierge messages SSE (${tag})`, ok, `status=${res.status} bytes=${text.length}`);
    }
  }
  await compare('/concierge messages (schema sai → 400)', 'POST', {
    path: `/api/tutoring/concierge/threads/${thrA}/messages`,
    body: { message: '' },
    cookie: stuA.cookie,
  });

  // ════ WEBHOOKS — replay signed fixtures ═════════════════════════════════════
  // VNPay: twin payment row, GET (query) cho OLD-row qua cả 2 backend? Không —
  // webhook là cross-write: row V1 bắn vào OLD, row V2 bắn vào NEW, so response.
  const bkV1 = bk2A; const bkV2 = bk2B; // booking đã cancel — payment row mới riêng
  // tạo booking mới cho payment webhook (1 booking chỉ có 1 payment - unique)
  async function seedBookingFor(studentId, profId) {
    const id = crypto.randomUUID();
    await prisma.tutoring_booking.create({
      data: {
        id, student_id: studentId, tutor_id: profId, subject_slug: 'math', level: 'HIGH_SCHOOL',
        start_at: new Date(stamp + 5 * 86400e3), end_at: new Date(stamp + 5 * 86400e3 + 3600e3),
        rate_vnd: 200000, status: 'PENDING_TUTOR',
      },
    });
    return id;
  }
  void bkV1; void bkV2;
  const wbkA = await seedBookingFor(stuA.id, profA);
  const wbkB = await seedBookingFor(stuB.id, profB);
  const ocA = `W6VNP-A-${stamp}`;
  const ocB = `W6VNP-B-${stamp}`;
  await seedPayment(ocA, wbkA);
  await seedPayment(ocB, wbkB);

  function vnpParams(orderCode) {
    const p = {
      vnp_TmnCode: 'W6TEST', vnp_Amount: '20000000', vnp_TxnRef: orderCode,
      vnp_ResponseCode: '00', vnp_TransactionNo: '14492012', vnp_BankCode: 'NCB',
      vnp_PayDate: '20260611100000', vnp_OrderInfo: 'Thanh toan booking',
    };
    return { ...p, vnp_SecureHash: signVnpay(p) };
  }
  {
    const qA = new URLSearchParams(vnpParams(ocA)).toString();
    const qB = new URLSearchParams(vnpParams(ocB)).toString();
    const a = await call(OLD, 'GET', `/api/webhooks/vnpay?${qA}`);
    const b = await call(NEW, 'GET', `/api/webhooks/vnpay?${qB}`);
    const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body);
    check('GET /webhooks/vnpay (signed → CAPTURED)', same, same ? `status=${a.status} body=${JSON.stringify(a.body)}` : `\n  OLD=${JSON.stringify(a.body)}\n  NEW=${JSON.stringify(b.body)}`);
  }
  {
    // double-delivery → already CAPTURED, captured_at KHÔNG đổi
    const beforeA = (await prisma.tutoring_payment.findFirst({ where: { order_code: ocA } })).captured_at;
    const beforeB = (await prisma.tutoring_payment.findFirst({ where: { order_code: ocB } })).captured_at;
    const a = await call(OLD, 'POST', '/api/webhooks/vnpay', vnpParams(ocA));
    const b = await call(NEW, 'POST', '/api/webhooks/vnpay', vnpParams(ocB));
    const afterA = (await prisma.tutoring_payment.findFirst({ where: { order_code: ocA } })).captured_at;
    const afterB = (await prisma.tutoring_payment.findFirst({ where: { order_code: ocB } })).captured_at;
    const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body)
      && a.body.already === 'CAPTURED'
      && +beforeA === +afterA && +beforeB === +afterB;
    check('POST /webhooks/vnpay (double-delivery idempotent)', same, `body=${JSON.stringify(a.body)}`);
  }
  {
    // form-urlencoded + chữ ký SAI → 400
    const bad = { ...vnpParams(ocA), vnp_SecureHash: 'deadbeef'.repeat(16) };
    const a = await call(OLD, 'POST', '/api/webhooks/vnpay', bad, undefined, { form: true });
    const b = await call(NEW, 'POST', '/api/webhooks/vnpay', bad, undefined, { form: true });
    const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body) && a.status === 400;
    check('POST /webhooks/vnpay (form-urlencoded, sig sai → 400)', same, `status=${a.status}`);
  }
  {
    // ký đúng nhưng thiếu vnp_TxnRef → 400 Missing
    const p = { vnp_ResponseCode: '00', vnp_TmnCode: 'W6TEST' };
    const signed = { ...p, vnp_SecureHash: signVnpay(p) };
    const a = await call(OLD, 'POST', '/api/webhooks/vnpay', signed);
    const b = await call(NEW, 'POST', '/api/webhooks/vnpay', signed);
    const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body);
    check('POST /webhooks/vnpay (thiếu TxnRef → 400)', same, `status=${a.status} ${JSON.stringify(a.body)}`);
  }
  {
    const p = vnpParams(`KHONG-TON-TAI-${stamp}`);
    const a = await call(OLD, 'POST', '/api/webhooks/vnpay', p);
    const b = await call(NEW, 'POST', '/api/webhooks/vnpay', p);
    const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body) && a.status === 404;
    check('POST /webhooks/vnpay (orderCode lạ → 404)', same, `status=${a.status}`);
  }

  // MoMo
  const mbkA = await seedBookingFor(stuA.id, profA);
  const mbkB = await seedBookingFor(stuB.id, profB);
  const mocA = `W6MOMO-A-${stamp}`;
  const mocB = `W6MOMO-B-${stamp}`;
  await seedPayment(mocA, mbkA);
  await seedPayment(mocB, mbkB);
  function momoBody(orderId, resultCode = 0) {
    const body = {
      partnerCode: 'W6TEST', orderId, requestId: `${orderId}-rq`, amount: 200000,
      orderInfo: 'Thanh toan booking', orderType: 'momo_wallet', transId: 99887766,
      resultCode, message: 'Successful.', payType: 'qr', responseTime: 1760000000000, extraData: '',
    };
    return { ...body, signature: signMomo(body) };
  }
  {
    const a = await call(OLD, 'POST', '/api/webhooks/momo', momoBody(mocA));
    const b = await call(NEW, 'POST', '/api/webhooks/momo', momoBody(mocB));
    const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body);
    check('POST /webhooks/momo (signed → CAPTURED)', same, same ? `body=${JSON.stringify(a.body)}` : `\n  OLD=${JSON.stringify(a.body)}\n  NEW=${JSON.stringify(b.body)}`);
  }
  {
    const a = await call(OLD, 'POST', '/api/webhooks/momo', momoBody(mocA));
    const b = await call(NEW, 'POST', '/api/webhooks/momo', momoBody(mocB));
    const same = a.status === b.status && a.body.already === 'CAPTURED' && JSON.stringify(a.body) === JSON.stringify(b.body);
    check('POST /webhooks/momo (double-delivery idempotent)', same, `body=${JSON.stringify(a.body)}`);
  }
  {
    const bad = { ...momoBody(mocA), signature: 'f'.repeat(64) };
    const a = await call(OLD, 'POST', '/api/webhooks/momo', bad);
    const b = await call(NEW, 'POST', '/api/webhooks/momo', bad);
    const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body) && a.status === 400;
    check('POST /webhooks/momo (sig sai → 400)', same, `status=${a.status}`);
  }
  {
    // resultCode != 0 → FAILED (payment row mới)
    const fbkA = await seedBookingFor(stuA.id, profA);
    const fbkB = await seedBookingFor(stuB.id, profB);
    const focA = `W6MOMOF-A-${stamp}`;
    const focB = `W6MOMOF-B-${stamp}`;
    await seedPayment(focA, fbkA);
    await seedPayment(focB, fbkB);
    const a = await call(OLD, 'POST', '/api/webhooks/momo', momoBody(focA, 1006));
    const b = await call(NEW, 'POST', '/api/webhooks/momo', momoBody(focB, 1006));
    const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body) && a.body?.status === 'FAILED';
    check('POST /webhooks/momo (resultCode 1006 → FAILED)', same, `body=${JSON.stringify(a.body)}`);
  }

  // LiveKit: signed JWT, event không room name → skipped; thiếu auth → 401
  {
    const body = JSON.stringify({ event: 'room_started', id: `evt-${stamp}` });
    const auth = await livekitAuth(body);
    const mk = async (base) => {
      const res = await fetch(`${base}/api/webhooks/livekit`, {
        method: 'POST',
        headers: { 'content-type': 'application/webhook+json', authorization: auth },
        body,
      });
      return { status: res.status, body: normalize(await res.json().catch(() => null)) };
    };
    const a = await mk(OLD);
    const b = await mk(NEW);
    const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body);
    check('POST /webhooks/livekit (signed, no room → skipped)', same, same ? `body=${JSON.stringify(a.body)}` : `\n  OLD=${JSON.stringify(a)}\n  NEW=${JSON.stringify(b)}`);
  }
  {
    const body = JSON.stringify({ event: 'room_started' });
    const mk = async (base) => {
      const res = await fetch(`${base}/api/webhooks/livekit`, {
        method: 'POST', headers: { 'content-type': 'application/webhook+json' }, body,
      });
      return { status: res.status, body: normalize(await res.json().catch(() => null)) };
    };
    const a = await mk(OLD);
    const b = await mk(NEW);
    const same = a.status === b.status && JSON.stringify(a.body) === JSON.stringify(b.body) && a.status === 401;
    check('POST /webhooks/livekit (thiếu auth → 401)', same, `status=${a.status} ${JSON.stringify(a.body)}`);
  }

  // DB-state assert: webhook CAPTURED ghi đúng provider_ref + raw_response.ipn
  {
    const pA = await prisma.tutoring_payment.findFirst({ where: { order_code: ocA } });
    const pB = await prisma.tutoring_payment.findFirst({ where: { order_code: ocB } });
    const ok = pA.status === 'CAPTURED' && pB.status === 'CAPTURED'
      && pA.provider_ref === '14492012' && pB.provider_ref === '14492012'
      && pA.raw_response?.ipn?.vnp_TxnRef === ocA && pB.raw_response?.ipn?.vnp_TxnRef === ocB
      && pA.captured_at && pB.captured_at;
    check('DB: vnpay CAPTURED ghi provider_ref + raw_response.ipn cả 2 bên', ok);
  }
} catch (err) {
  check(`PROOF CRASH: ${err.message}`, false, err.stack?.split('\n').slice(1, 3).join(' '));
} finally {
  const pass = results.filter(Boolean).length;
  console.log(`\n══ KẾT QUẢ: ${pass}/${results.length} PASS ══`);
  await prisma.$disconnect();
  process.exit(pass === results.length ? 0 : 1);
}

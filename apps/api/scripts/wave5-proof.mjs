/**
 * Proof Wave 5 — golden diff Library (search/discovery · content/money ·
 * annotations/saved-searches): OLD Next :3100 vs NEW Nest :4000.
 *
 * E2E thật: upload-init (presigned R2) → PUT PDF lên R2 → finalize (ingest)
 * trên CẢ 2 backend (mỗi bên 1 doc mirror). LLM routes so status-only.
 * PRO gate 402 test bằng cách flip doc B2 thành premium qua Prisma.
 */
import { createHash } from 'node:crypto';
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
// aiSummary/costUsd/modelUsed: LLM sinh mỗi bên 1 kiểu — mask khi cross-compare
// 2 doc khác nhau (so same-resource thì vẫn khớp vì cùng giá trị mask).
const VOLATILE_KEY = /^(ipAddress|timeSpentSeconds|lastMessageAt|affected|lastSeenAt|expiresAt|aiSummary|costUsd|modelUsed|estimatedDurationSec|fileHash|hash|pageCount|fileSizeBytes|sizeBytes)$/;
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

async function call(base, method, path, body, cookie) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
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
  const email = `wave5-${tag}-${stamp}@test.cogniva.local`;
  const r = await fetch(`${NEW}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wave5-proof-12', name: 'W5 Proof' }),
  });
  if (r.status >= 300) throw new Error(`sign-up ${tag} fail ${r.status}`);
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token=')).split(';')[0];
  const { user } = await r.json();
  return { email, cookie, id: user.id };
}

function buildPdf(seed) {
  const text = `Cogniva wave5 proof ${seed}. Tai lieu kiem thu thu vien, noi dung du dai de ingest parse chunk embed. `.repeat(6);
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>';
  const stream = `BT /F1 10 Tf 36 750 Td (${text}) Tj ET`;
  objects[4] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** upload-init → PUT R2 → finalize trên 1 backend; trả docId. */
async function uploadDoc(base, cookie, seed, title) {
  const pdf = buildPdf(seed);
  const hash = createHash('sha256').update(pdf).digest('hex');
  const init = await fetch(`${base}/api/library/docs/upload-init`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ filename: `proof-${seed}.pdf`, contentType: 'application/pdf', sizeBytes: pdf.length, hash, format: 'pdf' }),
  });
  const initBody = await init.json();
  if (init.status !== 200) throw new Error(`upload-init ${base} ${init.status}: ${JSON.stringify(initBody).slice(0, 200)}`);
  const put = await fetch(initBody.presignedUrl, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: pdf });
  if (!put.ok) throw new Error(`R2 PUT fail ${put.status}`);
  const fin = await fetch(`${base}/api/library/docs/finalize`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      docId: initBody.docId, storageKey: initBody.storageKey, title,
      subjectSlug: 'toan', level: 'HIGH_SCHOOL', grade: 12, docType: 'summary',
      licenseConfirmed: true,
    }),
  });
  const finBody = await fin.json().catch(() => null);
  return { status: fin.status, docId: initBody.docId, body: finBody };
}

const U = await signUp('uploader');
const V = await signUp('viewer');
console.log(`• U=${U.id} V=${V.id}\n`);

try {
  // ════ UPLOAD E2E (presigned + ingest cả 2 bên) ═══════════════════════════
  // Seed KHÁC nhau mỗi bên — dedup hash 409 nếu trùng nội dung file.
  console.log('  … upload+finalize OLD (ingest, chờ ~10-60s)');
  const dA = await uploadDoc(OLD, U.cookie, `alpha-${stamp}`, 'Tài liệu proof Alpha HK1');
  console.log('  … upload+finalize NEW');
  const dB = await uploadDoc(NEW, U.cookie, `beta-${stamp}`, 'Tài liệu proof Alpha HK1');
  check('upload-init→PUT→finalize (cross)', dA.status === dB.status, `status OLD=${dA.status} NEW=${dB.status}`);
  const [docA, docB] = [dA.docId, dB.docId];

  // Đảm bảo PUBLISHED deterministically cho các check sau (ingest async/đã xong đều OK).
  await prisma.$executeRaw`UPDATE library_doc SET status = 'PUBLISHED' WHERE id IN (${docA}, ${docB})`;

  // ════ DISCOVERY (same-resource đọc cả 2 bên) ═════════════════════════════
  await compare('/library/docs/:id (anonymous)', 'GET', { path: `/api/library/docs/${docA}` });
  await compare('/library/docs/:id (login V)', 'GET', { path: `/api/library/docs/${docA}`, cookie: V.cookie });
  await compare('/library/docs/:id (404)', 'GET', { path: '/api/library/docs/khong-ton-tai' });
  await compare('/library/docs/:id/related', 'GET', { path: `/api/library/docs/${docA}/related` });
  await compare('/library/docs/:id/duplicates', 'GET', { path: `/api/library/docs/${docA}/duplicates` });
  await compare('/library/docs/:id/prereq-check (anon)', 'GET', { path: `/api/library/docs/${docA}/prereq-check` });
  await compare('/library/docs/:id/prereq-check (V)', 'GET', { path: `/api/library/docs/${docA}/prereq-check`, cookie: V.cookie });

  // ════ REVIEWS ════════════════════════════════════════════════════════════
  await compare('/library/docs/:id/reviews (GET rỗng)', 'GET', { path: `/api/library/docs/${docA}/reviews` });
  await compare('/library/docs/:id/reviews (POST cross V)', 'POST', {
    path: '', pathOld: `/api/library/docs/${docA}/reviews`, pathNew: `/api/library/docs/${docB}/reviews`,
    cookie: V.cookie, body: { rating: 5, comment: 'Tài liệu tốt — proof' },
  });
  await compare('/library/docs/:id/reviews (GET có review)', 'GET', { path: `/api/library/docs/${docA}/reviews` });

  // ════ SEARCH (reverse/goal/voice — LLM/400) ══════════════════════════════
  await compare('/library/search/reverse (400)', 'POST', { path: '/api/library/search/reverse', cookie: V.cookie, body: {} });
  await compare('/library/goal (400)', 'POST', { path: '/api/library/goal', cookie: V.cookie, body: {} });
  await compare('/library/goal (LLM)', 'POST', { path: '/api/library/goal', cookie: V.cookie, body: { userMessage: 'Ôn thi toán 12 học kỳ 1 trong 2 tuần' }, statusOnly: true });
  {
    const [ra, rb] = await Promise.all([
      fetch(`${OLD}/api/library/voice-search`, { method: 'POST', headers: { cookie: V.cookie, 'content-type': 'application/json' }, body: '{}' }),
      fetch(`${NEW}/api/library/voice-search`, { method: 'POST', headers: { cookie: V.cookie, 'content-type': 'application/json' }, body: '{}' }),
    ]);
    check('POST /library/voice-search (non-multipart 400)', ra.status === rb.status, `OLD=${ra.status} NEW=${rb.status}`);
  }

  // ════ UNIVERSITIES + COURSES ═════════════════════════════════════════════
  await compare('/library/universities (GET)', 'GET', { path: '/api/library/universities?q=proof' });
  // Tên KHÁC nhau mỗi bên (cùng tên → bên sau dedupe created:false) → statusOnly,
  // shape đã được GET ?q= phía dưới so byte.
  await compare('/library/universities (POST cross)', 'POST', {
    path: '/api/library/universities', cookie: U.cookie,
    bodyOld: { name: `ĐH Proof Alpha ${stamp}` }, bodyNew: { name: `ĐH Proof Beta ${stamp}` },
    statusOnly: true,
  });
  await compare('/library/universities (GET sau tạo)', 'GET', { path: `/api/library/universities?q=Proof Alpha ${stamp}` });
  await compare('/library/courses (GET)', 'GET', { path: '/api/library/courses?q=proof' });

  // ════ ANNOTATIONS ════════════════════════════════════════════════════════
  await compare('/library/docs/:id/annotations (POST cross V)', 'POST', {
    path: '', pathOld: `/api/library/docs/${docA}/annotations`, pathNew: `/api/library/docs/${docB}/annotations`,
    cookie: V.cookie, body: { pageNum: 1, note: 'Ghi chú proof công khai', visibility: 'public' },
  });
  await compare('/library/docs/:id/annotations (GET anon)', 'GET', { path: `/api/library/docs/${docA}/annotations` });
  await compare('/library/docs/:id/annotations (GET V)', 'GET', { path: `/api/library/docs/${docA}/annotations`, cookie: V.cookie });
  const annRows = await prisma.$queryRaw`SELECT id, doc_id FROM library_doc_annotation WHERE author_id = ${V.id}`;
  const annA = annRows.find((a) => a.doc_id === docA)?.id;
  const annB = annRows.find((a) => a.doc_id === docB)?.id;
  if (annA && annB) {
    await compare('/library/annotations/:id/vote (POST cross U)', 'POST', {
      path: '', pathOld: `/api/library/annotations/${annA}/vote`, pathNew: `/api/library/annotations/${annB}/vote`,
      cookie: U.cookie, body: {},
    });
    await compare('/library/annotations/:id (DELETE cross V)', 'DELETE', {
      path: '', pathOld: `/api/library/annotations/${annA}`, pathNew: `/api/library/annotations/${annB}`,
      cookie: V.cookie,
    });
  } else { check('seed annotations', false, 'không thấy 2 annotation'); }

  // ════ SAVED SEARCHES ═════════════════════════════════════════════════════
  await compare('/library/saved-searches (POST cross V)', 'POST', {
    path: '/api/library/saved-searches', cookie: V.cookie,
    body: { name: 'Toán 12 proof', queryParams: { subject: 'toan', grade: ['12'] }, notifyOnNew: true },
  });
  await compare('/library/saved-searches (GET)', 'GET', { path: '/api/library/saved-searches', cookie: V.cookie });
  const ssRows = await prisma.$queryRaw`SELECT id, user_id FROM library_saved_search WHERE user_id = ${V.id} ORDER BY created_at`;
  if (ssRows.length >= 2) {
    await compare('/library/saved-searches/:id (DELETE cross)', 'DELETE', {
      path: '', pathOld: `/api/library/saved-searches/${ssRows[0].id}`, pathNew: `/api/library/saved-searches/${ssRows[1].id}`,
      cookie: V.cookie,
    });
  } else { check('seed saved-searches', false, `chỉ thấy ${ssRows.length}`); }

  // ════ FILE / DOWNLOAD + PRO GATE 402 ═════════════════════════════════════
  for (const [label, path] of [['file', `/api/library/docs/${docA}/file`], ['download', `/api/library/docs/${docA}/download`]]) {
    const [fa, fb] = await Promise.all([
      fetch(`${OLD}${path}`, { headers: { cookie: V.cookie }, redirect: 'manual' }),
      fetch(`${NEW}${path}`, { headers: { cookie: V.cookie }, redirect: 'manual' }),
    ]);
    // Media type so KHÔNG kèm params: Express thêm '; charset=utf-8' cho JSON —
    // cosmetic, mọi route JSON các wave đều vậy (client parse y nhau).
    const mt = (r) => (r.headers.get('content-type') ?? '').split(';')[0];
    const same = fa.status === fb.status && mt(fa) === mt(fb);
    check(`GET /library/docs/:id/${label} (free)`, same, same ? `status=${fa.status}` : `OLD=${fa.status}:${fa.headers.get('content-type')} NEW=${fb.status}:${fb.headers.get('content-type')}`);
  }

  // ════ IMPORT (trước khi flip premium — cần workspace) ════════════════════
  for (const base of [NEW]) {
    await fetch(`${base}/api/workspaces`, { method: 'POST', headers: { cookie: V.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'WS Import A' }) });
    await fetch(`${base}/api/workspaces`, { method: 'POST', headers: { cookie: V.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'WS Import B' }) });
  }
  const wsRows = await prisma.$queryRaw`SELECT id FROM workspace WHERE user_id = ${V.id} ORDER BY created_at`;
  // BUG-FIX có chủ đích (như lastMessageAt W3): route CŨ 500 vĩnh viễn khi doc
  // có chunks — PG 42P18 'could not determine data type of parameter' vì
  // jsonb_build_object('sourceDocId', $2) thiếu ::text (postgres.js không suy
  // kiểu). Bản Nest cast đúng → import CHẠY ĐƯỢC. Assert: OLD=500 & NEW=200.
  {
    const a = await call(OLD, 'POST', `/api/library/docs/${docA}/import`, { workspaceId: wsRows[0].id }, V.cookie);
    const b = await call(NEW, 'POST', `/api/library/docs/${docB}/import`, { workspaceId: wsRows[1].id }, V.cookie);
    const ok = a.status === 500 && b.status === 200 && b.body?.ok === true;
    check('POST /library/docs/:id/import (OLD bug 500 → NEW fix 200)', ok,
      ok ? 'bug-fix xác nhận' : `OLD=${a.status} NEW=${b.status} ${JSON.stringify(b.body).slice(0, 200)}`);
  }
  await compare('/library/import-batch (400)', 'POST', { path: '/api/library/import-batch', cookie: V.cookie, body: {} });

  // Flip docB premium → V (chưa mua, không PRO) phải bị chặn 402 y nhau 2 bên.
  await prisma.$executeRaw`UPDATE library_doc SET is_premium = true, price_vnd = 50000 WHERE id = ${docB}`;
  await compare('/library/docs/:id/download (premium 402)', 'GET', { path: `/api/library/docs/${docB}/download`, cookie: V.cookie });
  await compare('/library/docs/:id/purchase (số dư 0)', 'POST', { path: `/api/library/docs/${docB}/purchase`, cookie: V.cookie, body: {} });

  // ════ ENRICH: endorse / atoms / translate / podcast ══════════════════════
  await compare('/library/docs/:id/endorse (GET anon)', 'GET', { path: `/api/library/docs/${docA}/endorse` });
  await compare('/library/docs/:id/endorse (POST không phải tutor)', 'POST', { path: `/api/library/docs/${docA}/endorse`, cookie: V.cookie, body: {} });
  await compare('/library/docs/:id/atoms (GET anon)', 'GET', { path: `/api/library/docs/${docA}/atoms` });
  await compare('/library/docs/:id/atoms (POST không phải owner)', 'POST', { path: `/api/library/docs/${docA}/atoms`, cookie: V.cookie, body: {} });
  await compare('/library/docs/:id/translate (400)', 'POST', { path: `/api/library/docs/${docA}/translate`, cookie: V.cookie, body: {} });
  await compare('/library/docs/:id/translate (LLM)', 'POST', {
    path: '', pathOld: `/api/library/docs/${docA}/translate`, pathNew: `/api/library/docs/${docB}/translate`,
    cookie: V.cookie, body: { target: 'en', text: 'Đạo hàm của hàm số là gì?' }, statusOnly: true,
  });
  await compare('/library/docs/:id/podcast (LLM)', 'POST', {
    path: '', pathOld: `/api/library/docs/${docA}/podcast`, pathNew: `/api/library/docs/${docB}/podcast`,
    cookie: U.cookie, body: {}, statusOnly: true,
  });

  // ════ PRO subscribe/cancel ═══════════════════════════════════════════════
  await compare('/library/subscribe-pro (số dư 0)', 'POST', { path: '/api/library/subscribe-pro', cookie: V.cookie, body: {} });
  await compare('/library/cancel-pro (chưa PRO)', 'POST', { path: '/api/library/cancel-pro', cookie: V.cookie, body: {} });
} finally {
  // Thứ tự FK: bảng con không-cascade (import, report do auto-flag duplicate)
  // → docs → university → users.
  await prisma.$executeRaw`DELETE FROM library_doc_import WHERE doc_id IN (SELECT id FROM library_doc WHERE uploader_id IN (SELECT id FROM "user" WHERE email IN (${U.email}, ${V.email})))`;
  await prisma.$executeRaw`DELETE FROM library_doc_report WHERE doc_id IN (SELECT id FROM library_doc WHERE uploader_id IN (SELECT id FROM "user" WHERE email IN (${U.email}, ${V.email})))`;
  await prisma.$executeRaw`DELETE FROM library_doc WHERE uploader_id IN (SELECT id FROM "user" WHERE email IN (${U.email}, ${V.email}))`;
  await prisma.$executeRaw`DELETE FROM library_university WHERE name LIKE ${'ĐH Proof % ' + stamp}`;
  await prisma.$executeRaw`DELETE FROM "user" WHERE email IN (${U.email}, ${V.email})`;
  await prisma.$disconnect();
}

const pass = results.every(Boolean);
const failed = results.filter((r) => !r).length;
console.log(pass ? `\n✅ WAVE 5 GOLDEN DIFF PASS (${results.length} checks)` : `\n❌ FAIL ${failed}/${results.length}`);
process.exit(pass ? 0 : 1);

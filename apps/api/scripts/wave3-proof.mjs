/**
 * Proof Wave 3 — golden diff core học tập (workspaces/documents/flashcards/
 * quiz/exams/attempts/conversations): cùng request bắn route CŨ (Next :3100)
 * và MỚI (Nest :4000), normalize rồi so byte.
 *
 * Kỹ thuật so:
 *  - Đọc shared-resource (chunks/file/messages/attempt): CÙNG resource, gọi cả
 *    2 backend → so trực tiếp.
 *  - Write KHÔNG có XP trong response (workspace/exam CRUD): 1 user tạo 2
 *    resource giống hệt, OLD ghi resource A / NEW ghi resource B → so normalize.
 *  - Write CÓ XP/achievements trong response (flashcard review, quiz attempt):
 *    TWIN USERS — userA chỉ đi OLD, userB chỉ đi NEW, fixture mirror → state
 *    gamification 2 bên đối xứng từng bước.
 *  - Route LLM thật (briefing/atom-guide): chỉ so status.
 *  - Upload: PDF thật tự sinh (có text để unpdf parse được) — ingest chạy
 *    end-to-end cả 2 bên (Voyage embed + R2/local storage).
 * Cần cả 2 server chạy + Redis + Neon. Tự dọn user test (cascade).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

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

// ── Normalize: timestamp + id + mã ngẫu nhiên → token ổn định ──────────────
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
// liveCode/code: mã join random per-exam. ipAddress: x-forwarded-for chỉ có khi
// đi qua proxy (proof gọi Nest trực tiếp). timeSpentSeconds: elapsed thời gian
// thực. lastMessageAt: route CŨ bug luôn trả null (Drizzle subquery) — bản Nest
// trả đúng, chấp nhận bug-fix.
const IDISH_KEY = /(^id$|Id$|^key$|^url$|^email$|Code$|^code$|^storageKey$)/;
// Volatile: mask MỌI kiểu giá trị (null/number/string) — proof gọi Nest trực
// tiếp nên thiếu XFF, elapsed-time phi tất định, lastMessageAt là bug-fix.
const VOLATILE_KEY = /^(ipAddress|timeSpentSeconds|lastMessageAt)$/;
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
    return v.replace(UUID_IN_STR, '<uuid>').replace(CUIDISH, '<cuid>');
  }
  // float4 (Real): postgres.js parse text 9 digit còn Prisma decode binary f32
  // → lệch tail (0.095162585 vs 0.09516259). Round 6 chữ số cho cả 2 bên.
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

/**
 * So OLD vs NEW. opts cho phép path/body/cookie KHÁC nhau mỗi bên (cross-write
 * + twin users); mặc định dùng chung. cacheKeys bust TRƯỚC MỖI lần gọi để cả
 * 2 bên đều đi DB thật (không ăn cache lẫn nhau).
 */
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
  const email = `wave3-${tag}-${stamp}@test.cogniva.local`;
  const r = await fetch(`${NEW}/api/auth/sign-up`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'wave3-proof-12', name: 'Wave3 Proof' }),
  });
  if (r.status >= 300) throw new Error(`sign-up ${tag} fail ${r.status}`);
  const cookie = r.headers.getSetCookie().find((c) => c.startsWith('better-auth.session_token=')).split(';')[0];
  const { user } = await r.json();
  return { email, cookie, id: user.id };
}

/** PDF 1 trang tối giản nhưng hợp lệ (xref đúng offset) — unpdf parse được text. */
function buildPdf() {
  const text = 'Cogniva wave3 proof. Noi dung kiem thu ingest pipeline, du dai de chunker tao ra chunk dau tien. '.repeat(5);
  const objects = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>';
  const stream = `BT /F1 11 Tf 40 750 Td (${text}) Tj ET`;
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

async function upload(base, cookie, wsId, pdf) {
  const fd = new FormData();
  fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'proof.pdf');
  fd.append('workspaceId', wsId);
  const res = await fetch(`${base}/api/documents/upload`, { method: 'POST', headers: { cookie }, body: fd });
  return { status: res.status, body: normalize(await res.json().catch(() => null)) };
}

const U = await signUp('main');
const A = await signUp('twin-a');
const B = await signUp('twin-b');
console.log(`• main=${U.id} twinA=${A.id} twinB=${B.id}\n`);

try {
  // ════ WORKSPACES ═══════════════════════════════════════════════════════
  const wsKeys = () => [ck.workspaces(U.id)];
  await compare('/workspaces (rỗng)', 'GET', { path: '/api/workspaces', cookie: U.cookie, cacheKeys: wsKeys() });
  const w = await compare('/workspaces (tạo)', 'POST', {
    path: '/api/workspaces', cookie: U.cookie,
    bodyOld: { name: 'WS Alpha' }, bodyNew: { name: 'WS Alpha' },
  });
  const wsRow = await prisma.$queryRaw`SELECT id FROM workspace WHERE user_id = ${U.id} ORDER BY created_at`;
  const [wsA, wsB] = [wsRow[0]?.id, wsRow[1]?.id];
  if (!wsA || !wsB) throw new Error('không tạo được 2 workspace');
  await compare('/workspaces (2 ws)', 'GET', { path: '/api/workspaces', cookie: U.cookie, cacheKeys: wsKeys() });
  await compare('/workspaces/:id', 'GET', { path: `/api/workspaces/${wsA}`, cookie: U.cookie });
  await compare('/workspaces/:id (404)', 'GET', { path: '/api/workspaces/khong-ton-tai', cookie: U.cookie });
  await compare('/workspaces/:id (PATCH cross)', 'PATCH', {
    path: '', pathOld: `/api/workspaces/${wsA}`, pathNew: `/api/workspaces/${wsB}`,
    cookie: U.cookie, body: { name: 'WS Beta' }, cacheKeys: wsKeys(),
  });
  // 'today' + exams 'duplicate' KHÔNG còn trong proof: route cũ 0 caller → bỏ
  // không port (xem caller-analysis Wave 3).
  for (const sub of ['stats', 'atoms', 'manage', 'conversations', 'quick-quiz']) {
    await compare(`/workspaces/:id/${sub}`, 'GET', {
      path: `/api/workspaces/${wsA}/${sub}`, cookie: U.cookie,
      cacheKeys: [ck.workspaceStats(U.id, wsA), ck.workspaceAtoms(U.id, wsA)],
    });
  }
  await compare('/workspaces/:id/briefing', 'GET', { path: `/api/workspaces/${wsA}/briefing`, cookie: U.cookie, statusOnly: true });
  await compare('/workspaces/:id/atom-guide', 'GET', { path: `/api/workspaces/${wsA}/atom-guide`, cookie: U.cookie, statusOnly: true });

  // ════ DOCUMENTS ════════════════════════════════════════════════════════
  const docKeys = () => [ck.documents(U.id)];
  await compare('/documents (rỗng)', 'GET', { path: '/api/documents', cookie: U.cookie, cacheKeys: docKeys() });
  const pdf = buildPdf();
  console.log('  … upload OLD (ingest đồng bộ, chờ ~5-30s)');
  const upOld = await upload(OLD, U.cookie, wsA, pdf);
  console.log('  … upload NEW');
  const upNew = await upload(NEW, U.cookie, wsA, pdf);
  const upSame = JSON.stringify(upOld) === JSON.stringify(upNew);
  check('POST /documents/upload (PDF thật, cross)', upSame,
    upSame ? `status=${upOld.status}` : `\n  OLD=${JSON.stringify(upOld)}\n  NEW=${JSON.stringify(upNew)}`);
  const docRows = await prisma.$queryRaw`SELECT id FROM document WHERE user_id = ${U.id} ORDER BY created_at`;
  const [docA, docB] = [docRows[0]?.id, docRows[1]?.id];
  if (docA && docB) {
    await compare('/documents (2 docs)', 'GET', { path: '/api/documents', cookie: U.cookie, cacheKeys: docKeys() });
    await compare('/documents/:id/chunks (docA — Next ghi)', 'GET', { path: `/api/documents/${docA}/chunks`, cookie: U.cookie });
    await compare('/documents/:id/chunks (docB — Nest ghi)', 'GET', { path: `/api/documents/${docB}/chunks`, cookie: U.cookie });
    // File proxy: so status + headers + size (body binary). docB do Nest ghi → Next đọc (cross-storage 2 chiều).
    for (const [label, id] of [['docA', docA], ['docB', docB]]) {
      const [fa, fb] = await Promise.all([
        fetch(`${OLD}/api/documents/${id}/file`, { headers: { cookie: U.cookie } }),
        fetch(`${NEW}/api/documents/${id}/file`, { headers: { cookie: U.cookie } }),
      ]);
      const [ba, bb] = [await fa.arrayBuffer(), await fb.arrayBuffer()];
      const same =
        fa.status === fb.status &&
        fa.headers.get('content-type') === fb.headers.get('content-type') &&
        fa.headers.get('cache-control') === fb.headers.get('cache-control') &&
        fa.headers.get('content-disposition') === fb.headers.get('content-disposition') &&
        ba.byteLength === bb.byteLength;
      check(`GET /documents/:id/file (${label})`, same,
        same ? `status=${fa.status} bytes=${ba.byteLength}` :
        `OLD ct=${fa.headers.get('content-type')} cc=${fa.headers.get('cache-control')} cd=${fa.headers.get('content-disposition')} n=${ba.byteLength} | NEW ct=${fb.headers.get('content-type')} cc=${fb.headers.get('cache-control')} cd=${fb.headers.get('content-disposition')} n=${bb.byteLength}`);
    }
    // Move cross: docA (OLD) + docB (NEW) cùng chuyển sang wsB.
    await compare('/documents/:id/move (cross)', 'POST', {
      path: '', pathOld: `/api/documents/${docA}/move`, pathNew: `/api/documents/${docB}/move`,
      cookie: U.cookie, body: { workspaceId: wsB }, cacheKeys: docKeys(),
    });
    await compare('/documents/:id (DELETE cross)', 'DELETE', {
      path: '', pathOld: `/api/documents/${docA}`, pathNew: `/api/documents/${docB}`,
      cookie: U.cookie, cacheKeys: docKeys(),
    });
  }
  await compare('/documents/:id/chunks (404)', 'GET', { path: '/api/documents/khong-ton-tai/chunks', cookie: U.cookie });

  // ════ FLASHCARDS ═══════════════════════════════════════════════════════
  await compare('/flashcards (rỗng)', 'GET', { path: '/api/flashcards', cookie: U.cookie });
  await compare('/flashcards (tạo cross)', 'POST', {
    path: '/api/flashcards', cookie: U.cookie,
    body: { cardType: 'BASIC', front: 'Mặt trước proof', back: 'Mặt sau proof', workspaceId: null },
  });
  await compare('/flashcards/queue', 'GET', { path: '/api/flashcards/queue', cookie: U.cookie });
  await compare('/flashcards/stats', 'GET', { path: '/api/flashcards/stats', cookie: U.cookie, cacheKeys: [ck.flashcardStats(U.id)] });
  // Review — twin users (response chứa xp/newAchievements).
  const mkCard = (uid, suffix) => prisma.flashcard.create({
    data: { id: `w3proof-card-${suffix}-${stamp}`, user_id: uid, front: 'Twin front', back: 'Twin back' },
  });
  const cardA = await mkCard(A.id, 'a');
  const cardB = await mkCard(B.id, 'b');
  await compare('/flashcards/:id/review (twin)', 'POST', {
    path: '', pathOld: `/api/flashcards/${cardA.id}/review`, pathNew: `/api/flashcards/${cardB.id}/review`,
    cookieOld: A.cookie, cookieNew: B.cookie, body: { rating: 3, duration: 1200 },
  });
  const cardRows = await prisma.$queryRaw`SELECT id FROM flashcard WHERE user_id = ${U.id} ORDER BY due`;
  if (cardRows.length >= 2) {
    await compare('/flashcards/:id', 'GET', { path: `/api/flashcards/${cardRows[0].id}`, cookie: U.cookie });
    await compare('/flashcards/:id (DELETE cross)', 'DELETE', {
      path: '', pathOld: `/api/flashcards/${cardRows[0].id}`, pathNew: `/api/flashcards/${cardRows[1].id}`,
      cookie: U.cookie,
    });
  }
  // Image proxy 404 + generate 400 (zod flatten) — deterministic, so full body.
  {
    const [ia, ib] = await Promise.all([
      fetch(`${OLD}/api/flashcards/image/khong-ton-tai.png`, { headers: { cookie: U.cookie } }),
      fetch(`${NEW}/api/flashcards/image/khong-ton-tai.png`, { headers: { cookie: U.cookie } }),
    ]);
    const [ta, tb] = [await ia.text(), await ib.text()];
    const same = ia.status === ib.status && ta === tb;
    check('GET /flashcards/image/* (404)', same, same ? `status=${ia.status}` : `OLD=${ia.status}:${ta} NEW=${ib.status}:${tb}`);
  }
  await compare('/flashcards/generate (400 zod)', 'POST', { path: '/api/flashcards/generate', cookie: U.cookie, body: {} });

  // ════ QUIZ ═════════════════════════════════════════════════════════════
  await compare('/quiz (rỗng)', 'GET', { path: '/api/quiz', cookie: U.cookie });
  // Twin quiz + attempt (response chứa newAchievements).
  const mkQuiz = async (uid, suffix) => {
    const qid = `w3proof-quiz-${suffix}-${stamp}`;
    await prisma.quiz.create({ data: { id: qid, user_id: uid, title: 'Twin Quiz' } });
    await prisma.question.createMany({
      data: [
        { id: `${qid}-q1`, quiz_id: qid, type: 'MCQ', prompt: '1+1=?', options: ['1', '2', '3'], correct_answer: 1, explanation: 'Vì 1+1=2', difficulty: 0.3 },
        { id: `${qid}-q2`, quiz_id: qid, type: 'TRUE_FALSE', prompt: 'Trái đất quay quanh mặt trời?', correct_answer: true, explanation: 'Đúng vậy', difficulty: 0.2 },
      ],
    });
    return qid;
  };
  const quizA = await mkQuiz(A.id, 'a');
  const quizB = await mkQuiz(B.id, 'b');
  await compare('/quiz (twin list)', 'GET', { path: '/api/quiz', cookieOld: A.cookie, cookieNew: B.cookie });
  await compare('/quiz/:id (twin)', 'GET', { path: '', pathOld: `/api/quiz/${quizA}`, pathNew: `/api/quiz/${quizB}`, cookieOld: A.cookie, cookieNew: B.cookie });
  await compare('/quiz/:id/attempt (twin)', 'POST', {
    path: '', pathOld: `/api/quiz/${quizA}/attempt`, pathNew: `/api/quiz/${quizB}/attempt`,
    cookieOld: A.cookie, cookieNew: B.cookie,
    bodyOld: { answers: [{ questionId: `${quizA}-q1`, userAnswer: 1 }, { questionId: `${quizA}-q2`, userAnswer: false }] },
    bodyNew: { answers: [{ questionId: `${quizB}-q1`, userAnswer: 1 }, { questionId: `${quizB}-q2`, userAnswer: false }] },
  });
  await compare('/quiz/:id (DELETE twin)', 'DELETE', { path: '', pathOld: `/api/quiz/${quizA}`, pathNew: `/api/quiz/${quizB}`, cookieOld: A.cookie, cookieNew: B.cookie });
  await compare('/quiz/:id (404)', 'GET', { path: '/api/quiz/khong-ton-tai', cookie: U.cookie });
  await compare('/quiz/generate (400 zod)', 'POST', { path: '/api/quiz/generate', cookie: U.cookie, body: {} });

  // ════ EXAMS + ATTEMPTS ═════════════════════════════════════════════════
  const examKeys = () => [ck.exams(U.id, 'all')];
  await compare('/exams (rỗng)', 'GET', { path: '/api/exams', cookie: U.cookie, cacheKeys: examKeys() });
  await compare('/exams (tạo cross)', 'POST', {
    path: '/api/exams', cookie: U.cookie, body: { title: 'Exam Proof', mode: 'PRACTICE' }, cacheKeys: examKeys(),
  });
  const exRows = await prisma.$queryRaw`SELECT id FROM exam WHERE owner_id = ${U.id} ORDER BY created_at`;
  const [exA, exB] = [exRows[0]?.id, exRows[1]?.id];
  if (!exA || !exB) throw new Error('không tạo được 2 exam');
  await compare('/exams/:id', 'GET', { path: `/api/exams/${exA}`, cookie: U.cookie });
  const mcq = { type: 'MCQ_SINGLE', prompt: '2+2=?', options: ['3', '4', '5'], correctAnswer: 1, points: 1 };
  await compare('/exams/:id/questions (cross)', 'POST', {
    path: '', pathOld: `/api/exams/${exA}/questions`, pathNew: `/api/exams/${exB}/questions`,
    cookie: U.cookie, body: mcq,
  });
  await compare('/exams/:id (PUT cross)', 'PUT', {
    path: '', pathOld: `/api/exams/${exA}`, pathNew: `/api/exams/${exB}`,
    cookie: U.cookie, body: { title: 'Exam Proof v2' }, cacheKeys: examKeys(),
  });
  await compare('/exams/:id/publish (cross)', 'POST', {
    path: '', pathOld: `/api/exams/${exA}/publish`, pathNew: `/api/exams/${exB}/publish`,
    cookie: U.cookie, cacheKeys: examKeys(),
  });
  await compare('/exams/:id/proctor', 'GET', { path: `/api/exams/${exA}/proctor`, cookie: U.cookie });
  await compare('/exams/join (404 code)', 'POST', { path: '/api/exams/join', cookie: U.cookie, body: { code: 'ZZZZZZ' } });
  // Attempt flow đối xứng: exA đi OLD, exB đi NEW.
  await compare('/exams/:id/attempts (start cross)', 'POST', {
    path: '', pathOld: `/api/exams/${exA}/attempts`, pathNew: `/api/exams/${exB}/attempts`, cookie: U.cookie,
  });
  const atRows = await prisma.$queryRaw`SELECT id, exam_id FROM exam_attempt WHERE user_id = ${U.id}`;
  const atA = atRows.find((r) => r.exam_id === exA)?.id;
  const atB = atRows.find((r) => r.exam_id === exB)?.id;
  if (!atA || !atB) throw new Error('không start được 2 attempt');
  const qRows = await prisma.$queryRaw`SELECT id, exam_id FROM exam_question WHERE exam_id IN (${exA}, ${exB})`;
  const qA = qRows.find((r) => r.exam_id === exA)?.id;
  const qB = qRows.find((r) => r.exam_id === exB)?.id;
  await compare('/attempts/:id/responses (cross)', 'POST', {
    path: '', pathOld: `/api/attempts/${atA}/responses`, pathNew: `/api/attempts/${atB}/responses`,
    cookie: U.cookie,
    bodyOld: { questionId: qA, answer: 1, responseTimeMs: 900 },
    bodyNew: { questionId: qB, answer: 1, responseTimeMs: 900 },
  });
  await compare('/attempts/:id/violations (POST cross)', 'POST', {
    path: '', pathOld: `/api/attempts/${atA}/violations`, pathNew: `/api/attempts/${atB}/violations`,
    cookie: U.cookie,
    body: { events: [{ type: 'TAB_SWITCH', severity: 'medium', timestamp: stamp }] },
  });
  await compare('/attempts/:id/violations (GET)', 'GET', { path: `/api/attempts/${atA}/violations`, cookie: U.cookie });
  await compare('/attempts/:id/submit (cross)', 'POST', {
    path: '', pathOld: `/api/attempts/${atA}/submit`, pathNew: `/api/attempts/${atB}/submit`, cookie: U.cookie,
  });
  await compare('/attempts/:id (đọc chung attemptA)', 'GET', { path: `/api/attempts/${atA}`, cookie: U.cookie });
  await compare('/attempts/:id/disqualify (cross)', 'POST', {
    path: '', pathOld: `/api/attempts/${atA}/disqualify`, pathNew: `/api/attempts/${atB}/disqualify`, cookie: U.cookie,
  });
  await compare('/exams/:id/attempts (GET)', 'GET', { path: `/api/exams/${exA}/attempts`, cookie: U.cookie });
  await compare('/exams/:id/generate-questions (400/409)', 'POST', {
    path: '', pathOld: `/api/exams/${exA}/generate-questions`, pathNew: `/api/exams/${exB}/generate-questions`,
    cookie: U.cookie, body: {}, statusOnly: true,
  });
  await compare('/exams/:id (DELETE cross)', 'DELETE', {
    path: '', pathOld: `/api/exams/${exA}`, pathNew: `/api/exams/${exB}`, cookie: U.cookie, cacheKeys: examKeys(),
  });

  // ════ CONVERSATIONS ════════════════════════════════════════════════════
  await compare('/conversations (rỗng)', 'GET', { path: '/api/conversations', cookie: U.cookie, cacheKeys: [ck.conversationsList(U.id)] });
  const mkConv = async (suffix) => {
    const cid = `w3proof-conv-${suffix}-${stamp}`;
    await prisma.conversation.create({ data: { id: cid, user_id: U.id, title: `Conv ${suffix}` } });
    await prisma.message.createMany({
      data: [
        { id: `${cid}-m1`, conversation_id: cid, role: 'USER', content: 'Câu hỏi proof' },
        { id: `${cid}-m2`, conversation_id: cid, role: 'ASSISTANT', content: 'Trả lời proof' },
      ],
    });
    return cid;
  };
  const convA = await mkConv('a');
  const convB = await mkConv('b');
  await compare('/conversations (2 conv)', 'GET', { path: '/api/conversations', cookie: U.cookie, cacheKeys: [ck.conversationsList(U.id)] });
  await compare('/conversations/:id/messages', 'GET', { path: `/api/conversations/${convA}/messages`, cookie: U.cookie });
  await compare('/conversations/:id/messages (404)', 'GET', { path: '/api/conversations/khong-ton-tai/messages', cookie: U.cookie });
  await compare('/conversations/:id (DELETE cross)', 'DELETE', {
    path: '', pathOld: `/api/conversations/${convA}`, pathNew: `/api/conversations/${convB}`,
    cookie: U.cookie, cacheKeys: [ck.conversationsList(U.id)],
  });
} finally {
  await prisma.$executeRaw`DELETE FROM "user" WHERE email IN (${U.email}, ${A.email}, ${B.email})`;
  await prisma.$disconnect();
}

const pass = results.every(Boolean);
const failed = results.filter((r) => !r).length;
console.log(pass ? `\n✅ WAVE 3 GOLDEN DIFF PASS (${results.length} checks)` : `\n❌ FAIL ${failed}/${results.length}`);
process.exit(pass ? 0 : 1);

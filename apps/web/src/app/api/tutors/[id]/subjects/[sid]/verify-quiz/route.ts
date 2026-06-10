/**
 * /api/tutors/[id]/subjects/[sid]/verify-quiz — verify môn dạy của tutor.
 *
 * POST: generate quiz 10 câu MCQ về subject để tutor làm.
 *   - Tutor (owner) gọi → AI gen quiz dựa trên subject name + level
 *   - Insert quiz + 10 question vào quiz/question table (reuse Phase 6)
 *   - Insert tutor_subject_verify_quiz row link quiz tới subject
 *   - Return quiz id để FE redirect /quiz/[id] làm bài
 *
 * GET: trả về verify_quiz hiện tại (nếu có) + status + score.
 *
 * PATCH body { score }: caller (FE sau khi submit quiz) gửi điểm về
 *   - Update verify_quiz.status = PASSED|FAILED
 *   - Nếu PASSED → update tutor_subject.verifiedAt + verifyScore
 */
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  question,
  quiz,
  SUBJECT_BY_SLUG,
  tutorProfile,
  tutorSubject,
  tutorSubjectVerifyQuiz,
  LEVEL_NAMES,
} from '@cogniva/db';

import { auth } from '@/lib/auth';
import {
  generateQuestions,
  type GeneratedQuestion,
} from '@/lib/quiz/generate';
import type { Plan } from '@/lib/observability/cost-guardrail';
import { checkLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 180;

type Params = { params: Promise<{ id: string; sid: string }> };

async function ensureOwner(
  tutorId: string,
  userId: string,
): Promise<{ ok: boolean; tutor?: { id: string; userId: string } }> {
  const [row] = await db
    .select({ id: tutorProfile.id, userId: tutorProfile.userId })
    .from(tutorProfile)
    .where(eq(tutorProfile.id, tutorId))
    .limit(1);
  if (!row) return { ok: false };
  if (row.userId !== userId) return { ok: false };
  return { ok: true, tutor: row };
}

export async function GET(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id, sid } = await params;

  const owner = await ensureOwner(id, session.user.id);
  if (!owner.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const [vq] = await db
    .select()
    .from(tutorSubjectVerifyQuiz)
    .where(eq(tutorSubjectVerifyQuiz.tutorSubjectId, sid))
    .orderBy(desc(tutorSubjectVerifyQuiz.createdAt))
    .limit(1);

  return NextResponse.json({ verifyQuiz: vq ?? null });
}

export async function POST(_request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const { id, sid } = await params;

  const rl = await checkLimit(`verify-quiz:${userId}`, 'aiGenerate');
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'AI generation rate limit' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter ?? 60) } },
    );
  }

  const owner = await ensureOwner(id, userId);
  if (!owner.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Lấy subject info
  const [subject] = await db
    .select()
    .from(tutorSubject)
    .where(eq(tutorSubject.id, sid))
    .limit(1);
  if (!subject || subject.tutorId !== id) {
    return NextResponse.json({ error: 'Subject không thuộc tutor' }, { status: 404 });
  }

  const subjectDef = SUBJECT_BY_SLUG[subject.subjectSlug];
  const subjectName = subjectDef?.name ?? subject.subjectSlug;
  const levelName = LEVEL_NAMES[subject.level as keyof typeof LEVEL_NAMES] ?? subject.level;

  // Tạo prompt context để generateQuestions tạo MCQ về kiến thức môn này.
  // generateQuestions tự build prompt từ context text. Truyền 1 đoạn syllabus
  // ngắn để AI có grounding.
  const ctxText = `Môn học: ${subjectName} (${subjectDef?.nameEn ?? subjectName})\n`
    + `Cấp học: ${levelName}\n`
    + `Yêu cầu: Sinh 10 câu hỏi trắc nghiệm (MCQ) bao quát kiến thức cơ bản đến nâng cao của môn ${subjectName} ở cấp ${levelName}. `
    + `Mỗi câu có 4 đáp án, chỉ 1 đáp án đúng. Distractor (đáp án sai) phải plausible — gây nhầm với đáp án đúng để test thật sự năng lực gia sư. `
    + `Nội dung tập trung vào: định nghĩa, công thức, ứng dụng, lập luận đặc trưng của môn. `
    + `Trả về tiếng Việt rõ ràng, không lan man.`;

  const plan = ((session.user as { plan?: string }).plan ?? 'FREE') as Plan;
  let generated: GeneratedQuestion[];
  try {
    generated = await generateQuestions(ctxText, ['MCQ'], 10, {
      userId,
      plan,
    });
  } catch (err) {
    return NextResponse.json(
      { error: `AI gen lỗi: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  if (generated.length < 5) {
    return NextResponse.json(
      { error: `AI chỉ gen được ${generated.length} câu, cần ≥ 5` },
      { status: 502 },
    );
  }

  // Insert quiz + questions reuse Phase 6 schema (workspaceId = null vì
  // không gắn workspace).
  const result = await db.transaction(async (tx) => {
    const [qz] = await tx
      .insert(quiz)
      .values({
        userId,
        workspaceId: null,
        title: `Verify ${subjectName} · ${levelName}`,
        config: { types: ['MCQ'], questionCount: generated.length },
      })
      .returning();
    if (!qz) throw new Error('insert quiz failed');

    await tx.insert(question).values(
      generated.map((q) => ({
        quizId: qz.id,
        type: q.type,
        prompt: q.prompt,
        options: q.type === 'MCQ' ? q.options : null,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        difficulty: q.difficulty,
      })),
    );

    const [vq] = await tx
      .insert(tutorSubjectVerifyQuiz)
      .values({
        tutorSubjectId: sid,
        quizId: qz.id,
        status: 'PENDING',
      })
      .returning();

    return { quizId: qz.id, verifyQuiz: vq };
  });

  return NextResponse.json(result, { status: 201 });
}

const PATCH_SCHEMA = z.object({
  score: z.number().int().min(0).max(100),
});

export async function PATCH(request: Request, { params }: Params) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;
  const { id, sid } = await params;

  const owner = await ensureOwner(id, userId);
  if (!owner.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await request.json().catch(() => null);
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Lấy verify_quiz mới nhất cho subject này
  const [vq] = await db
    .select()
    .from(tutorSubjectVerifyQuiz)
    .where(eq(tutorSubjectVerifyQuiz.tutorSubjectId, sid))
    .orderBy(desc(tutorSubjectVerifyQuiz.createdAt))
    .limit(1);
  if (!vq) {
    return NextResponse.json({ error: 'Chưa generate quiz' }, { status: 404 });
  }
  if (vq.status !== 'PENDING') {
    return NextResponse.json(
      { error: `Đã ${vq.status}, không update lại được` },
      { status: 400 },
    );
  }

  const passed = parsed.data.score >= vq.passThreshold;
  await db.transaction(async (tx) => {
    await tx
      .update(tutorSubjectVerifyQuiz)
      .set({
        status: passed ? 'PASSED' : 'FAILED',
        score: parsed.data.score,
        completedAt: new Date(),
      })
      .where(eq(tutorSubjectVerifyQuiz.id, vq.id));

    if (passed) {
      await tx
        .update(tutorSubject)
        .set({
          verifiedAt: new Date(),
          verifyScore: parsed.data.score,
        })
        .where(eq(tutorSubject.id, sid));
    }
  });

  return NextResponse.json({ ok: true, passed, score: parsed.data.score });
}

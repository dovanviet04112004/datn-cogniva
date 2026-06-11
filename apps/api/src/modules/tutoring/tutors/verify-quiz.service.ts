import { randomUUID } from 'node:crypto';

import { ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { Plan } from '../../../infra/ai/cost-guardrail.service';
import { PrismaService } from '../../../infra/database/prisma.service';
import { LEVEL_NAMES, SUBJECT_BY_SLUG } from '../../../common/subject-taxonomy';
import { QuizGenerateService, type GeneratedQuestion } from '../../quiz/quiz-generate.service';

@Injectable()
export class TutorVerifyQuizService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quizGenerate: QuizGenerateService,
  ) {}

  async createVerifyQuiz(user: { id: string; plan?: string | null }, tutorId: string, sid: string) {
    const profile = await this.prisma.tutor_profile.findUnique({
      where: { id: tutorId },
      select: { user_id: true },
    });
    if (!profile || profile.user_id !== user.id) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    const subject = await this.prisma.tutor_subject.findUnique({ where: { id: sid } });
    if (!subject || subject.tutor_id !== tutorId) {
      throw new NotFoundException({ error: 'Subject không thuộc tutor' });
    }

    const subjectDef = SUBJECT_BY_SLUG[subject.subject_slug];
    const subjectName = subjectDef?.name ?? subject.subject_slug;
    const levelName = LEVEL_NAMES[subject.level as keyof typeof LEVEL_NAMES] ?? subject.level;

    const ctxText =
      `Môn học: ${subjectName} (${subjectDef?.nameEn ?? subjectName})\n` +
      `Cấp học: ${levelName}\n` +
      `Yêu cầu: Sinh 10 câu hỏi trắc nghiệm (MCQ) bao quát kiến thức cơ bản đến nâng cao của môn ${subjectName} ở cấp ${levelName}. ` +
      `Mỗi câu có 4 đáp án, chỉ 1 đáp án đúng. Distractor (đáp án sai) phải plausible — gây nhầm với đáp án đúng để test thật sự năng lực gia sư. ` +
      `Nội dung tập trung vào: định nghĩa, công thức, ứng dụng, lập luận đặc trưng của môn. ` +
      `Trả về tiếng Việt rõ ràng, không lan man.`;

    const plan = (user.plan ?? 'FREE') as Plan;
    let generated: GeneratedQuestion[];
    try {
      generated = await this.quizGenerate.generateQuestions(ctxText, ['MCQ'], 10, {
        userId: user.id,
        plan,
      });
    } catch (err) {
      throw new HttpException({ error: `AI gen lỗi: ${(err as Error).message}` }, 502);
    }

    if (generated.length < 5) {
      throw new HttpException({ error: `AI chỉ gen được ${generated.length} câu, cần ≥ 5` }, 502);
    }

    return this.prisma.$transaction(async (tx) => {
      const qz = await tx.quiz.create({
        data: {
          id: randomUUID(),
          user_id: user.id,
          workspace_id: null,
          title: `Verify ${subjectName} · ${levelName}`,
          config: { types: ['MCQ'], questionCount: generated.length },
        },
      });

      await tx.question.createMany({
        data: generated.map((q) => ({
          id: randomUUID(),
          quiz_id: qz.id,
          type: q.type,
          prompt: q.prompt,
          options: q.type === 'MCQ' ? (q.options as Prisma.InputJsonValue) : Prisma.DbNull,
          correct_answer: q.correctAnswer,
          explanation: q.explanation,
          difficulty: q.difficulty,
        })),
      });

      const vq = await tx.tutor_subject_verify_quiz.create({
        data: {
          id: randomUUID(),
          tutor_subject_id: sid,
          quiz_id: qz.id,
          status: 'PENDING',
        },
      });

      return {
        quizId: qz.id,
        verifyQuiz: {
          id: vq.id,
          tutorSubjectId: vq.tutor_subject_id,
          quizId: vq.quiz_id,
          status: vq.status,
          score: vq.score,
          passThreshold: vq.pass_threshold,
          createdAt: vq.created_at,
          completedAt: vq.completed_at,
        },
      };
    });
  }
}

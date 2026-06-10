/**
 * AttemptsService — vòng đời attempt: start/resume (POST /exams/:id/attempts),
 * load (GET /attempts/:id), auto-save response, submit + grade, violations
 * anti-cheat, disqualify. Port từ apps/web/src/app/api/exams/[id]/attempts +
 * /api/attempts/[id]/** — GIỮ NGUYÊN wire shape, status code, message lỗi.
 *
 * Submit: route cũ ghi responses (Promise.all) rồi finalize attempt rời rạc —
 * api gom cả 2 vào 1 prisma.$transaction (atomic hơn, wire không đổi); mastery
 * propagation (best-effort, try/catch từng concept) chạy sau transaction.
 */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { exam_attempt as ExamAttemptRow, exam_question as ExamQuestionRow } from '@prisma/client';
import { logger } from '@cogniva/server-core';
import { onExamChanged } from '@cogniva/server-core/cache/invalidate';

import { PrismaService } from '../../infra/database/prisma.service';
import type { Plan } from '../../infra/ai/cost-guardrail.service';
import type { AuthUser } from '../../common/auth/session.types';
import { MasteryUpdateService } from '../learning/mastery-update.service';
import { OutcomeTrackerService } from '../library/outcome-tracker.service';
import { ExamAiService } from './exam-ai.service';
import { ExamGradeService } from './exam-grade.service';
import {
  jsonOrDbNull,
  toAttemptDto,
  toQuestionDto,
  toResponseDto,
  toStrippedQuestionDto,
  toViolationDto,
} from './exam.mappers';
import { saveResponseSchema, violationsBodySchema } from './dto/exams.dto';

/** Trọng số severity + ngưỡng auto-flag — copy từ route violations cũ. */
const SEVERITY_WEIGHT = { low: 1, medium: 3, high: 10 } as const;
const FLAG_THRESHOLD = 0.7;

type ViolationRecord = { type: string; timestamp: string; severity: string; metadata?: unknown };

@Injectable()
export class AttemptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly grade: ExamGradeService,
    private readonly ai: ExamAiService,
    private readonly masteryUpdate: MasteryUpdateService,
    private readonly outcome: OutcomeTrackerService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // GET /exams/:id/attempts — history attempts của CHÍNH user
  // ──────────────────────────────────────────────────────────

  async listForExam(userId: string, examId: string) {
    const [parent, attemptRows] = await Promise.all([
      this.prisma.exam.findUnique({
        where: { id: examId },
        select: { owner_id: true, status: true },
      }),
      this.prisma.exam_attempt.findMany({
        where: { exam_id: examId, user_id: userId },
        orderBy: { started_at: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          score: true,
          max_score: true,
          percentage: true,
          started_at: true,
          submitted_at: true,
        },
      }),
    ]);

    if (!parent) throw new NotFoundException({ error: 'Not found' });

    // Student không list được attempts của exam DRAFT (tự nhiên = 0)
    if (parent.status === 'DRAFT' && parent.owner_id !== userId) {
      return { attempts: [] };
    }

    return {
      attempts: attemptRows.map((r) => ({
        id: r.id,
        status: r.status,
        score: r.score,
        maxScore: r.max_score,
        percentage: r.percentage,
        startedAt: r.started_at,
        submittedAt: r.submitted_at,
      })),
    };
  }

  // ──────────────────────────────────────────────────────────
  // POST /exams/:id/attempts — start mới hoặc resume IN_PROGRESS
  // ──────────────────────────────────────────────────────────

  async startAttempt(
    userId: string,
    examId: string,
    headers: { cfIp?: string; forwardedFor?: string; userAgent?: string },
  ) {
    const parent = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!parent) throw new NotFoundException({ error: 'Not found' });

    if (parent.status === 'DRAFT' || parent.status === 'ENDED') {
      throw new ForbiddenException({
        error: `Exam status không cho phép start: ${parent.status}`,
      });
    }

    if (parent.mode === 'ASYNC') {
      const now = new Date();
      if (parent.starts_at && now < parent.starts_at) {
        throw new ForbiddenException({
          error: 'Exam chưa mở. Bắt đầu lúc ' + parent.starts_at.toISOString(),
        });
      }
      if (parent.ends_at && now > parent.ends_at) {
        throw new ForbiddenException({
          error: 'Exam đã đóng. Kết thúc lúc ' + parent.ends_at.toISOString(),
        });
      }
    }

    // Check attempt count — PRACTICE bypass (luyện tập = unlimited); owner bypass
    // hoàn toàn (preview "Làm thử"); student TIMED enforce maxAttempts.
    const isOwner = parent.owner_id === userId;
    if (parent.mode !== 'PRACTICE' && !isOwner) {
      const n = await this.prisma.exam_attempt.count({
        where: { exam_id: examId, user_id: userId },
      });
      if (n >= parent.max_attempts) {
        throw new ConflictException({
          error: `Đã đạt giới hạn ${parent.max_attempts} lần làm bài`,
        });
      }
    }

    // Tránh tạo attempt mới khi đang có 1 attempt IN_PROGRESS — return cái cũ
    const inProgress = await this.prisma.exam_attempt.findFirst({
      where: { exam_id: examId, user_id: userId, status: 'IN_PROGRESS' },
    });
    if (inProgress) {
      return { attempt: toAttemptDto(inProgress), resumed: true };
    }

    const ipAddress =
      headers.cfIp ?? headers.forwardedFor?.split(',')[0]?.trim() ?? null;

    const attempt = await this.prisma.exam_attempt.create({
      data: {
        id: randomUUID(),
        exam_id: examId,
        user_id: userId,
        status: 'IN_PROGRESS',
        max_score: parent.max_score,
        ip_address: ipAddress,
        user_agent: headers.userAgent ?? null,
      },
    });

    return { attempt: toAttemptDto(attempt), resumed: false };
  }

  // ──────────────────────────────────────────────────────────
  // GET /attempts/:id — attempt + responses + questions (strip khi chưa reveal)
  // ──────────────────────────────────────────────────────────

  async getAttempt(userId: string, id: string) {
    const attempt = await this.prisma.exam_attempt.findUnique({ where: { id } });
    if (!attempt) throw new NotFoundException({ error: 'Not found' });

    const parent = await this.prisma.exam.findUnique({ where: { id: attempt.exam_id } });
    if (!parent) throw new NotFoundException({ error: 'Exam not found' });

    const isOwner = parent.owner_id === userId;
    const isStudent = attempt.user_id === userId;
    if (!isOwner && !isStudent) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    // Shuffle KHÔNG ở backend mà ở UI (seed = attemptId) — trả thứ tự gốc.
    const questions = await this.prisma.exam_question.findMany({
      where: { exam_id: attempt.exam_id },
      orderBy: { order_index: 'asc' },
    });

    const responses = await this.prisma.exam_response.findMany({
      where: { attempt_id: id },
    });

    // Reveal correctAnswer/explanation khi: attempt đã submit + showResults
    // cho phép, HOẶC isOwner (luôn thấy).
    const submitted = attempt.status !== 'IN_PROGRESS';
    const reveal = isOwner || (submitted && parent.show_results !== 'AFTER_ALL_DONE');

    const strippedQuestions = reveal
      ? questions.map(toQuestionDto)
      : questions.map(toStrippedQuestionDto);

    return {
      attempt: toAttemptDto(attempt),
      exam: {
        id: parent.id,
        title: parent.title,
        description: parent.description,
        mode: parent.mode,
        status: parent.status,
        durationSeconds: parent.duration_seconds,
        startsAt: parent.starts_at,
        endsAt: parent.ends_at,
        maxScore: parent.max_score,
        passingScore: parent.passing_score,
        shuffleQuestions: parent.shuffle_questions,
        shuffleOptions: parent.shuffle_options,
        allowReview: parent.allow_review,
        showResults: parent.show_results,
        antiCheat: parent.anti_cheat,
      },
      questions: strippedQuestions,
      responses: responses.map(toResponseDto),
      reveal,
      isOwner,
    };
  }

  // ──────────────────────────────────────────────────────────
  // POST /attempts/:id/disqualify — owner reject attempt (không reversible)
  // ──────────────────────────────────────────────────────────

  async disqualify(userId: string, id: string) {
    const attempt = await this.prisma.exam_attempt.findUnique({ where: { id } });
    if (!attempt) throw new NotFoundException({ error: 'Not found' });

    // Verify owner
    const parent = await this.prisma.exam.findUnique({
      where: { id: attempt.exam_id },
      select: { owner_id: true },
    });
    if (!parent || parent.owner_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    await this.prisma.exam_attempt.update({
      where: { id },
      data: {
        status: 'DISQUALIFIED',
        flagged: true,
        flag_reason: attempt.flag_reason ?? 'Disqualified by owner',
        score: 0,
        percentage: 0,
        passed: false,
      },
    });

    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────
  // POST /attempts/:id/responses — auto-save (upsert) 1 response
  // ──────────────────────────────────────────────────────────

  async saveResponse(user: AuthUser, id: string, raw: unknown, wantGrade: boolean) {
    const attempt = await this.prisma.exam_attempt.findUnique({ where: { id } });
    if (!attempt) throw new NotFoundException({ error: 'Not found' });
    if (attempt.user_id !== user.id) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }
    if (attempt.status !== 'IN_PROGRESS') {
      throw new ConflictException({
        error: `Attempt đã ${attempt.status}, không lưu thêm response`,
      });
    }

    const parsed = saveResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }
    const { questionId, answer, responseTimeMs } = parsed.data;

    // Check questionId thuộc exam của attempt này (anti-forgery)
    const q = await this.prisma.exam_question.findFirst({
      where: { id: questionId, exam_id: attempt.exam_id },
    });
    if (!q) {
      throw new BadRequestException({ error: 'Question không thuộc exam này' });
    }

    const parent = await this.prisma.exam.findUnique({
      where: { id: attempt.exam_id },
      select: { mode: true },
    });

    let isCorrect: boolean | null = null;
    let pointsEarned = 0;
    let aiGrading: unknown = null;
    let needsReview = false;

    // PRACTICE với ?grade=1 → grade ngay để hiện feedback. TIMED defer grade
    // cho /submit cuối (tránh AI token spam khi student edit answer nhiều lần).
    const shouldGrade = wantGrade && parent?.mode === 'PRACTICE';
    if (shouldGrade) {
      const result = this.grade.gradeResponse(q, answer);
      isCorrect = result.isCorrect;
      pointsEarned = result.pointsEarned;

      // AI fallback cho SHORT khi exact match fail
      if (result.needsAiGrading && q.type === 'SHORT' && typeof answer === 'string') {
        const ai = await this.ai.aiGradeShortAnswer(q, answer, {
          userId: user.id,
          plan: (user.plan ?? 'FREE') as Plan,
        });
        pointsEarned = ai.score;
        isCorrect = ai.isCorrect;
        aiGrading = ai;
        needsReview = ai.flaggedForReview ?? false;
      } else if (result.needsAiGrading) {
        needsReview = true;
      }
    }

    // Upsert response (1 row/question/attempt — UNIQUE attempt_id+question_id)
    const now = new Date();
    const answerJson =
      answer === undefined ? undefined : answer === null ? Prisma.DbNull : (answer as Prisma.InputJsonValue);
    await this.prisma.exam_response.upsert({
      where: { attempt_id_question_id: { attempt_id: id, question_id: questionId } },
      create: {
        id: randomUUID(),
        attempt_id: id,
        question_id: questionId,
        answer: answerJson,
        is_correct: isCorrect,
        points_earned: pointsEarned,
        started_at: now,
        submitted_at: now,
        response_time_ms: responseTimeMs ?? null,
        ai_grading: jsonOrDbNull(aiGrading),
        needs_review: needsReview,
      },
      update: {
        answer: answerJson,
        is_correct: isCorrect,
        points_earned: pointsEarned,
        submitted_at: now,
        response_time_ms: responseTimeMs ?? null,
        ai_grading: jsonOrDbNull(aiGrading),
        needs_review: needsReview,
      },
    });

    return {
      ok: true,
      graded: shouldGrade,
      isCorrect,
      pointsEarned,
    };
  }

  // ──────────────────────────────────────────────────────────
  // POST /attempts/:id/submit — finalize + grade tất cả responses
  // ──────────────────────────────────────────────────────────

  async submit(user: AuthUser, id: string) {
    const attempt = await this.prisma.exam_attempt.findUnique({ where: { id } });
    if (!attempt) throw new NotFoundException({ error: 'Not found' });
    if (attempt.user_id !== user.id) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    // Idempotent — đã submit thì return current state
    if (attempt.status !== 'IN_PROGRESS') {
      return { attempt: toAttemptDto(attempt), alreadySubmitted: true };
    }

    const parent = await this.prisma.exam.findUnique({ where: { id: attempt.exam_id } });
    if (!parent) throw new NotFoundException({ error: 'Exam not found' });

    const questions = await this.prisma.exam_question.findMany({
      where: { exam_id: attempt.exam_id },
    });
    const questionMap = new Map(questions.map((q) => [q.id, q]));

    const responses = await this.prisma.exam_response.findMany({
      where: { attempt_id: id },
    });

    // Grade từng response. Auto-grade trước (sync, fast); AI-grade song song.
    const plan = (user.plan ?? 'FREE') as Plan;
    let totalScore = 0;
    let questionsAnswered = 0;
    const updates: Array<{
      id: string;
      isCorrect: boolean;
      pointsEarned: number;
      aiGrading: unknown;
      needsReview: boolean;
    }> = [];
    const aiQueue: Array<{
      responseId: string;
      type: 'short' | 'essay';
      question: ExamQuestionRow;
      answer: string;
    }> = [];

    for (const r of responses) {
      const q = questionMap.get(r.question_id);
      if (!q) continue;
      questionsAnswered++;

      const result = this.grade.gradeResponse(q, r.answer);

      if (result.needsAiGrading && typeof r.answer === 'string' && r.answer.trim()) {
        // Defer AI grade — tạm 0 điểm, override sau khi AI xong
        const kind = q.type === 'ESSAY' ? 'essay' : 'short';
        aiQueue.push({ responseId: r.id, type: kind, question: q, answer: r.answer });
        updates.push({
          id: r.id,
          isCorrect: false,
          pointsEarned: 0,
          aiGrading: null,
          needsReview: true,
        });
      } else {
        totalScore += result.pointsEarned;
        updates.push({
          id: r.id,
          isCorrect: result.isCorrect,
          pointsEarned: result.pointsEarned,
          aiGrading: null,
          needsReview: !!result.needsAiGrading,
        });
      }
    }

    // Run AI grading parallel (capacity ~ 5 concurrent). Sai 1 không kill cả batch.
    if (aiQueue.length > 0) {
      logger.info('exam.submit.ai-grade-start', {
        attempt_id: id,
        count: aiQueue.length,
      });
      const concurrency = 5;
      for (let i = 0; i < aiQueue.length; i += concurrency) {
        const batch = aiQueue.slice(i, i + concurrency);
        const results = await Promise.all(
          batch.map(async (item) => {
            try {
              const ctx2 = { userId: user.id, plan };
              const ai =
                item.type === 'essay'
                  ? await this.ai.aiGradeEssay(item.question, item.answer, ctx2)
                  : await this.ai.aiGradeShortAnswer(item.question, item.answer, ctx2);
              return { ...item, ai };
            } catch (err) {
              logger.error('exam.submit.ai-grade-fail', {
                response_id: item.responseId,
                error: err instanceof Error ? err.message : String(err),
              });
              return { ...item, ai: null };
            }
          }),
        );
        for (const r of results) {
          const u = updates.find((x) => x.id === r.responseId);
          if (!u) continue;
          if (r.ai) {
            u.isCorrect = r.ai.isCorrect;
            u.pointsEarned = r.ai.score;
            u.aiGrading = r.ai;
            u.needsReview = r.ai.flaggedForReview ?? false;
            totalScore += r.ai.score;
          } else {
            u.needsReview = true; // flag để teacher manual grade
          }
        }
      }
    }

    // Finalize: responses + attempt trong 1 transaction (atomic).
    const maxScore = parent.max_score || questions.reduce((s, q) => s + q.points, 0);
    const percentage = maxScore > 0 ? totalScore / maxScore : 0;
    const passed = parent.passing_score != null ? percentage >= parent.passing_score : null;
    const now = new Date();
    const timeSpentSec = Math.round((now.getTime() - attempt.started_at.getTime()) / 1000);

    const tx: Prisma.PrismaPromise<unknown>[] = updates.map((u) =>
      this.prisma.exam_response.update({
        where: { id: u.id },
        data: {
          is_correct: u.isCorrect,
          points_earned: u.pointsEarned,
          ai_grading: jsonOrDbNull(u.aiGrading),
          needs_review: u.needsReview,
        },
      }),
    );
    tx.push(
      this.prisma.exam_attempt.update({
        where: { id },
        data: {
          status: 'SUBMITTED',
          submitted_at: now,
          score: totalScore,
          max_score: maxScore,
          percentage,
          passed,
          time_spent_seconds: timeSpentSec,
          questions_answered: questionsAnswered,
        },
      }),
    );
    const txResults = await this.prisma.$transaction(tx);
    const updatedAttempt = txResults[txResults.length - 1] as ExamAttemptRow;

    // Phase A6 (atom-centric): propagate exam responses lên mastery cho atom.
    // Best-effort: 1 fail không kill submit. Sequential tránh lock conflict
    // trên cùng row mastery khi nhiều câu cùng concept.
    for (const u of updates) {
      const resp = responses.find((r) => r.id === u.id);
      if (!resp) continue;
      const q = questionMap.get(resp.question_id);
      if (!q?.concept_id) continue;
      const maxPts = q.points || 1;
      const obsScore = Math.max(0, Math.min(1, u.pointsEarned / maxPts));
      try {
        await this.masteryUpdate.applyAttempt(user.id, q.concept_id, obsScore, 'exam');
      } catch (err) {
        logger.warn('exam.submit.mastery-update-fail', {
          response_id: u.id,
          concept_id: q.concept_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Attempt vừa submit → summary "joined" trong list exams của student đổi.
    await onExamChanged(attempt.user_id, parent.workspace_id);

    // Phase 2 Pillar #5: ghi outcome cho library docs user đã import vào
    // workspace của exam. Best-effort — fail không kill response.
    if (parent.workspace_id && percentage >= 0 && percentage <= 1) {
      void this.outcome
        .recordExamOutcome({
          userId: user.id,
          workspaceId: parent.workspace_id,
          percentage,
          context: {
            examId: parent.id,
            attemptId: id,
            score: totalScore,
            maxScore,
          },
        })
        .catch((err) => {
          logger.warn('exam.submit.outcome-track-fail', {
            attempt_id: id,
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }

    return {
      attempt: toAttemptDto(updatedAttempt),
      totalResponses: responses.length,
      aiGraded: aiQueue.length,
    };
  }

  // ──────────────────────────────────────────────────────────
  // POST /attempts/:id/violations — batch log + recompute cheatRiskScore
  // ──────────────────────────────────────────────────────────

  async logViolations(userId: string, id: string, raw: unknown) {
    const attempt = await this.prisma.exam_attempt.findUnique({ where: { id } });
    if (!attempt) throw new NotFoundException({ error: 'Not found' });
    if (attempt.user_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    const parsed = violationsBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: parsed.error.flatten() });
    }
    if (parsed.data.events.length === 0) {
      return { ok: true, inserted: 0 };
    }

    // 1. Insert each event vào examViolation
    await this.prisma.exam_violation.createMany({
      data: parsed.data.events.map((e) => ({
        id: randomUUID(),
        attempt_id: id,
        type: e.type,
        severity: e.severity,
        metadata: { ...e.metadata, clientTimestamp: e.timestamp } as Prisma.InputJsonValue,
        timestamp: new Date(e.timestamp),
      })),
    });

    // 2. Append vào jsonb array — legacy record thiếu severity coerce 'low'.
    const existingViolations: ViolationRecord[] = Array.isArray(attempt.violations)
      ? (attempt.violations as Array<{ type: string; timestamp: string; metadata?: unknown }>).map(
          (v) => ({ ...v, severity: (v as ViolationRecord).severity ?? 'low' }),
        )
      : [];
    const merged: ViolationRecord[] = [
      ...existingViolations,
      ...parsed.data.events.map((e) => ({
        type: e.type,
        timestamp: new Date(e.timestamp).toISOString(),
        severity: e.severity,
        metadata: e.metadata,
      })),
    ];

    // 3. Recompute cheatRiskScore từ TOÀN BỘ violations (low/medium/high weights)
    let totalWeight = 0;
    for (const v of merged) {
      const w = SEVERITY_WEIGHT[v.severity as keyof typeof SEVERITY_WEIGHT] ?? 0;
      totalWeight += w;
    }
    // Sigmoid map [0, ∞) → [0, 1). 30 points = 0.5, 60 points ≈ 0.8.
    const cheatRiskScore = 1 - Math.exp(-totalWeight / 30);

    const flagged = cheatRiskScore > FLAG_THRESHOLD;
    const flagReason = flagged
      ? `Auto-flag: cheatRiskScore=${cheatRiskScore.toFixed(2)} > ${FLAG_THRESHOLD} (${merged.length} violations)`
      : null;

    await this.prisma.exam_attempt.update({
      where: { id },
      data: {
        violations: merged as unknown as Prisma.InputJsonValue,
        cheat_risk_score: cheatRiskScore,
        flagged,
        flag_reason: flagged ? flagReason : attempt.flag_reason,
      },
    });

    return {
      ok: true,
      inserted: parsed.data.events.length,
      totalViolations: merged.length,
      cheatRiskScore,
      flagged,
    };
  }

  // ──────────────────────────────────────────────────────────
  // GET /attempts/:id/violations — owner (hoặc chính student) xem timeline
  // ──────────────────────────────────────────────────────────

  async listViolations(userId: string, id: string) {
    const attempt = await this.prisma.exam_attempt.findUnique({ where: { id } });
    if (!attempt) throw new NotFoundException({ error: 'Not found' });

    const parent = await this.prisma.exam.findUnique({
      where: { id: attempt.exam_id },
      select: { owner_id: true },
    });
    if (parent?.owner_id !== userId && attempt.user_id !== userId) {
      throw new ForbiddenException({ error: 'Forbidden' });
    }

    const violations = await this.prisma.exam_violation.findMany({
      where: { attempt_id: id },
      orderBy: { timestamp: 'asc' },
    });

    return {
      attempt: {
        id: attempt.id,
        userId: attempt.user_id,
        cheatRiskScore: attempt.cheat_risk_score,
        flagged: attempt.flagged,
        flagReason: attempt.flag_reason,
      },
      violations: violations.map(toViolationDto),
    };
  }
}

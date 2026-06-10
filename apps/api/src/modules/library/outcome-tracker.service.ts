/**
 * OutcomeTrackerService — Pillar #5 Outcome record from quiz/exam. Port từ
 * apps/web/src/lib/library/outcome-tracker.ts.
 *
 * Khi user finish 1 quiz/exam, gọi recordExamOutcome()/recordQuizOutcome():
 *   1. Tìm các library docs user đã import vào CHÍNH workspace của exam đó,
 *      filter trong vòng 4 tuần gần đây (signal "doc đã giúp user").
 *   2. INSERT 1 outcome row mỗi doc với metric='exam_score'/'quiz_score'.
 *
 * Idempotent ổn — duplicate outcome rows OK (recompute avg vẫn đúng), nhưng
 * tránh re-fire bằng cách chỉ gọi từ submit endpoint (1 lần / attempt).
 * Best-effort: caller không để fail block submit response.
 *
 * LỆCH vs lib cũ (chủ đích, Wave 5 nối lại): lib cũ sau insert có fire-and-forget
 * recomputeQualityForDoc (bước "Optional" theo spec) — quality-score + karma
 * chưa port sang api; cron recomputeQualityAll phía web worker vẫn chạy nên
 * badge/score vẫn cập nhật, chỉ trễ hơn vài giờ.
 *
 * Spec: docs/plans/library-share.md §Phase 2 / Pillar 5.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';

/** Cửa sổ thời gian doc import → coi như "đã giúp user trong quiz/exam này". */
const ATTRIBUTION_WINDOW_DAYS = 28;

export type ExamOutcomeInput = {
  userId: string;
  /** workspace mà exam thuộc về — null nếu exam global, sẽ skip. */
  workspaceId: string | null | undefined;
  /** Tỷ lệ điểm 0..1. */
  percentage: number;
  /** Optional metadata cho debug + future. */
  context?: {
    examId?: string;
    attemptId?: string;
    score?: number;
    maxScore?: number;
  };
};

@Injectable()
export class OutcomeTrackerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record outcome cho mọi library docs user đã import vào workspace của exam
   * này trong 4 tuần gần. Return số rows đã ghi.
   */
  async recordExamOutcome(input: ExamOutcomeInput): Promise<number> {
    return this.recordOutcome(input, 'exam_score');
  }

  /**
   * Same pattern cho quiz attempts. Phase 2 quiz table có thể chưa link
   * workspace nên giữ riêng — caller truyền workspaceId nếu có.
   */
  async recordQuizOutcome(input: ExamOutcomeInput): Promise<number> {
    return this.recordOutcome(input, 'quiz_score');
  }

  private async recordOutcome(
    input: ExamOutcomeInput,
    metric: 'exam_score' | 'quiz_score',
  ): Promise<number> {
    if (!input.workspaceId) return 0; // global, không gắn workspace
    if (input.percentage < 0 || input.percentage > 1) return 0;

    const cutoff = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 24 * 3600 * 1000);

    // Tìm imports user trong workspace + trong cửa sổ. 1 doc có thể có nhiều
    // import rows (re-import) → dedup bằng docId (distinct như selectDistinct cũ).
    const imports = await this.prisma.library_doc_import.findMany({
      where: {
        importer_id: input.userId,
        workspace_id: input.workspaceId,
        imported_at: { gte: cutoff },
      },
      select: { doc_id: true },
      distinct: ['doc_id'],
    });

    if (imports.length === 0) return 0;

    const rows = imports.map((imp) => ({
      id: randomUUID(),
      doc_id: imp.doc_id,
      user_id: input.userId,
      metric,
      value: String(input.percentage), // numeric → string (như Drizzle cũ)
      context: input.context ?? Prisma.DbNull,
    }));

    await this.prisma.library_doc_outcome.createMany({ data: rows });

    return rows.length;
  }
}

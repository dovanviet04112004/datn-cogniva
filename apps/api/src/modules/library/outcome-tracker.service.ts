import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';

const ATTRIBUTION_WINDOW_DAYS = 28;

export type ExamOutcomeInput = {
  userId: string;
  workspaceId: string | null | undefined;
  percentage: number;
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

  async recordExamOutcome(input: ExamOutcomeInput): Promise<number> {
    return this.recordOutcome(input, 'exam_score');
  }

  async recordQuizOutcome(input: ExamOutcomeInput): Promise<number> {
    return this.recordOutcome(input, 'quiz_score');
  }

  private async recordOutcome(
    input: ExamOutcomeInput,
    metric: 'exam_score' | 'quiz_score',
  ): Promise<number> {
    if (!input.workspaceId) return 0;
    if (input.percentage < 0 || input.percentage > 1) return 0;

    const cutoff = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 24 * 3600 * 1000);

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
      value: String(input.percentage),
      context: input.context ?? Prisma.DbNull,
    }));

    await this.prisma.library_doc_outcome.createMany({ data: rows });

    return rows.length;
  }
}

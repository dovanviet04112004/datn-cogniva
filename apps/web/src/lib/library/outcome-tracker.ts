/**
 * library/outcome-tracker — Pillar #5 Outcome record from quiz/exam (Phase 2, 2026-05-27).
 *
 * Khi user finish 1 quiz/exam, gọi `recordExamOutcome()` (hoặc quiz variant) để:
 *   1. Tìm các library docs user đã import vào CHÍNH workspace của exam đó,
 *      filter trong vòng 4 tuần gần đây (signal "doc đã giúp user").
 *   2. INSERT 1 outcome row mỗi doc với metric='exam_score' value=percentage.
 *   3. Optional: trigger recomputeQualityForDoc async để badge cập nhật ngay.
 *
 * Idempotent ổn — duplicate outcome rows OK (recompute avg vẫn đúng), nhưng
 * tránh re-fire bằng cách chỉ gọi từ submit endpoint (1 lần / attempt).
 *
 * Best-effort: fail không block exam submit response.
 *
 * Spec: docs/plans/library-share.md §Phase 2 / Pillar 5.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, gte } from 'drizzle-orm';

import { db, libraryDocImport, libraryDocOutcome } from '@cogniva/db';

/** Cửa sổ thời gian doc import → coi như "đã giúp user trong quiz/exam này". */
const ATTRIBUTION_WINDOW_DAYS = 28;

type ExamOutcomeInput = {
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

/**
 * Record outcome cho mọi library docs user đã import vào workspace của exam này
 * trong 4 tuần gần. Return số rows đã ghi.
 */
export async function recordExamOutcome(input: ExamOutcomeInput): Promise<number> {
  if (!input.workspaceId) return 0; // exam global, không gắn workspace
  if (input.percentage < 0 || input.percentage > 1) return 0;

  const cutoff = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 24 * 3600 * 1000);

  // Tìm imports user trong workspace + trong cửa sổ. 1 doc có thể có nhiều
  // import rows (re-import) → dedup bằng docId.
  const imports = await db
    .selectDistinct({ docId: libraryDocImport.docId })
    .from(libraryDocImport)
    .where(
      and(
        eq(libraryDocImport.importerId, input.userId),
        eq(libraryDocImport.workspaceId, input.workspaceId),
        gte(libraryDocImport.importedAt, cutoff),
      ),
    );

  if (imports.length === 0) return 0;

  const rows = imports.map((imp) => ({
    id: randomUUID(),
    docId: imp.docId,
    userId: input.userId,
    metric: 'exam_score' as const,
    value: String(input.percentage), // numeric drizzle → string
    context: input.context ?? null,
  }));

  await db.insert(libraryDocOutcome).values(rows);

  // Trigger quality recompute async cho mỗi doc liên quan — không await
  // để không block submit response.
  void (async () => {
    try {
      const { recomputeQualityForDoc } = await import('./quality-score');
      await Promise.all(
        imports.map((imp) =>
          recomputeQualityForDoc(imp.docId).catch((err) => {
            console.error('[outcome.recompute]', imp.docId, err);
          }),
        ),
      );
    } catch (err) {
      console.error('[outcome.recompute.batch]', err);
    }
  })();

  return rows.length;
}

/**
 * Same pattern cho quiz attempts. Phase 2 quiz table có thể chưa link
 * workspace nên giữ riêng — caller truyền workspaceId nếu có.
 */
export async function recordQuizOutcome(input: ExamOutcomeInput): Promise<number> {
  if (!input.workspaceId) return 0;
  if (input.percentage < 0 || input.percentage > 1) return 0;

  const cutoff = new Date(Date.now() - ATTRIBUTION_WINDOW_DAYS * 24 * 3600 * 1000);
  const imports = await db
    .selectDistinct({ docId: libraryDocImport.docId })
    .from(libraryDocImport)
    .where(
      and(
        eq(libraryDocImport.importerId, input.userId),
        eq(libraryDocImport.workspaceId, input.workspaceId),
        gte(libraryDocImport.importedAt, cutoff),
      ),
    );

  if (imports.length === 0) return 0;

  const rows = imports.map((imp) => ({
    id: randomUUID(),
    docId: imp.docId,
    userId: input.userId,
    metric: 'quiz_score' as const,
    value: String(input.percentage),
    context: input.context ?? null,
  }));

  await db.insert(libraryDocOutcome).values(rows);

  void (async () => {
    try {
      const { recomputeQualityForDoc } = await import('./quality-score');
      await Promise.all(
        imports.map((imp) =>
          recomputeQualityForDoc(imp.docId).catch(() => {}),
        ),
      );
    } catch {
      /* silent */
    }
  })();

  return rows.length;
}

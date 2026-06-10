/**
 * Materialize proposal — Phase B (atom-centric).
 *
 * Spec: docs/plans/atom-centric.md §6 Phase B.
 *
 * Khi user mở `/study-plan` lần đầu mỗi ngày, gọi function này để:
 *   1. Check xem hôm nay đã có proposal items chưa (kind != 'manual',
 *      due_date = hôm nay)
 *   2. Nếu chưa → call proposeForToday() rồi INSERT vào studyPlanItem
 *      mỗi atom = 1 row với kind + metadata + conceptId + dueDate
 *   3. Trả về list rows (đã insert hoặc đã có)
 *
 * Idempotent: gọi 2 lần trong cùng ngày → return rows hiện tại, không
 * insert lại.
 *
 * Không xoá items SKIPPED/DONE — giữ làm lịch sử cho user xem "hôm nay đã
 * làm gì".
 */
import { and, eq, gte, lt, ne } from 'drizzle-orm';

import { db, studyPlanItem } from '@cogniva/db';

import { cached } from '@/lib/cache/cache-aside';
import { ck } from '@/lib/cache/keys';

import { proposeForToday, type AtomBrief } from './propose';

/**
 * Khoá ngày (local server) cho cache study-plan — KHỚP `todayRange()` để cache key
 * = đúng "ngày mà materialize coi là hôm nay". Export dùng chung cho các route
 * invalidate (PATCH/DELETE/skip/POST) gọi `onStudyPlanChanged(userId, studyPlanDayKey())`.
 */
export function studyPlanDayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type ProposalItemRow = {
  id: string;
  title: string;
  description: string | null;
  status: 'PENDING' | 'DONE' | 'SKIPPED';
  kind: 'manual' | 'review' | 'new' | 'practice';
  conceptId: string | null;
  metadata: Record<string, unknown>;
  dueDate: Date | null;
  createdAt: Date;
  completedAt: Date | null;
};

/**
 * Tính khoảng [startOfDay, startOfNextDay) cho ngày hiện tại theo timezone
 * server. Production có thể wire timezone từ user.timezone nhưng Phase B
 * MVP dùng server tz (Asia/Bangkok ở Vercel ASIA region, OK cho VN user).
 */
function todayRange(): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/** Build title hiển thị + metadata từ AtomBrief + kind. */
function buildRow(
  atom: AtomBrief,
  kind: 'review' | 'new' | 'practice',
): {
  title: string;
  description: string | null;
  metadata: Record<string, unknown>;
} {
  const titlePrefix =
    kind === 'review' ? 'Ôn ' : kind === 'new' ? 'Học atom mới: ' : 'Quiz: ';
  return {
    title: `${titlePrefix}${atom.name}`,
    description:
      atom.previewAnswer ?? atom.description ?? null,
    metadata: {
      atomDomain: atom.domain,
      atomDifficulty: atom.difficulty,
      masteryScore: atom.masteryScore,
      flashcardCount: atom.flashcardCount,
      questionCount: atom.questionCount,
      previewQuestion: atom.previewQuestion,
      previewAnswer: atom.previewAnswer,
      earliestDue: atom.earliestDue?.toISOString() ?? null,
      // Số phút ước lượng cho UI hiển thị "~5 phút"
      estimatedMinutes:
        kind === 'review' ? 2 : kind === 'new' ? 5 : 3,
    },
  };
}

/**
 * Materialize proposal hôm nay cho 1 user. Idempotent.
 *
 * @param userId
 * @returns rows hôm nay (kind != manual), sort theo (review, new, practice)
 */
export async function materializeProposalForToday(
  userId: string,
): Promise<ProposalItemRow[]> {
  // Cache-aside TTL 60s theo (user, ngày). materialize idempotent → cache MISS
  // re-run chỉ SELECT existing (không insert lại). Date field serialize→string
  // trên cache hit nhưng MỌI consumer đều normalizeItem/JSON trước khi dùng (page,
  // /today route, study-plan-client) nên không vỡ. Invalidate: onStudyPlanChanged
  // tại POST/PATCH/DELETE/skip.
  return cached(ck.studyPlan(userId, studyPlanDayKey()), 60, () => doMaterialize(userId));
}

async function doMaterialize(userId: string): Promise<ProposalItemRow[]> {
  const { start, end } = todayRange();

  // Check existing proposal rows hôm nay
  const existing = await db
    .select()
    .from(studyPlanItem)
    .where(
      and(
        eq(studyPlanItem.userId, userId),
        ne(studyPlanItem.kind, 'manual'),
        gte(studyPlanItem.createdAt, start),
        lt(studyPlanItem.createdAt, end),
      ),
    );

  if (existing.length > 0) {
    return existing as ProposalItemRow[];
  }

  // Chưa có → propose + insert
  const proposal = await proposeForToday(userId);

  const toInsert: Array<typeof studyPlanItem.$inferInsert> = [];
  for (const atom of proposal.review) {
    const { title, description, metadata } = buildRow(atom, 'review');
    toInsert.push({
      userId,
      title,
      description,
      conceptId: atom.id,
      kind: 'review',
      metadata,
      dueDate: start,
    });
  }
  for (const atom of proposal.newAtoms) {
    const { title, description, metadata } = buildRow(atom, 'new');
    toInsert.push({
      userId,
      title,
      description,
      conceptId: atom.id,
      kind: 'new',
      metadata,
      dueDate: start,
    });
  }
  for (const atom of proposal.practice) {
    const { title, description, metadata } = buildRow(atom, 'practice');
    toInsert.push({
      userId,
      title,
      description,
      conceptId: atom.id,
      kind: 'practice',
      metadata,
      dueDate: start,
    });
  }

  if (toInsert.length === 0) return [];

  const inserted = await db
    .insert(studyPlanItem)
    .values(toInsert)
    .returning();

  return inserted as ProposalItemRow[];
}

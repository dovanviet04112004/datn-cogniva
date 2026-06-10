/**
 * request-search — V5 Phase 2 (2026-05-22).
 *
 * Hybrid search tutor_request cho tutor-side concierge: tutor gõ "tôi là gia
 * sư toán cần tìm ứng viên" → match những yêu cầu OPEN của student phù hợp
 * môn / level / budget / modality.
 *
 * Pattern giống hybridSearchTutors: FTS (search_vec) ⊕ Vector (embedding) qua
 * Reciprocal Rank Fusion. Filter cứng: status='OPEN'.
 *
 * Spec: docs/plans/tutoring-v5-concierge-prod.md §Phase 2.
 */
import { and, eq, gte, inArray, or, sql } from 'drizzle-orm';

import { db, tutorRequest, user as userTable } from '@cogniva/db';
import { expandSubjectSlug } from '@cogniva/db/taxonomy';

import { embedQuery } from '@/lib/ingest/embed-query';

const RRF_K = 60;
const CANDIDATE_LIMIT = 50;

export type RequestSearchInput = {
  query?: string;
  filters?: {
    /** Subject slug — có thể là parent (vd 'english') sẽ expand sang children. */
    subjectSlug?: string;
    /** Mảng subject slug đã expand — ưu tiên hơn subjectSlug single. */
    subjectSlugs?: string[];
    level?: string;
    modality?: string;
    /** Tutor mong muốn budget tối thiểu — match request có budget ≥ X. */
    budgetMinVnd?: number;
  };
  limit?: number;
};

export type RequestSearchResult = {
  id: string;
  studentId: string;
  studentName: string | null;
  title: string;
  description: string;
  subjectSlug: string;
  level: string;
  budgetVnd: number | null;
  modality: string;
  urgency: string;
  status: string;
  createdAt: Date;
  score: number;
  ftsRank: number | null;
  vecRank: number | null;
};

/**
 * Hybrid search tutoring requests.
 *
 * Trường hợp:
 *   - query rỗng + có filter → trả request mới nhất / urgency cao nhất
 *   - query có → FTS ⊕ vector RRF, fallback rating-sort khi 0 result
 */
export async function hybridSearchRequests(
  input: RequestSearchInput,
): Promise<RequestSearchResult[]> {
  const limit = input.limit ?? 10;
  const query = input.query?.trim();
  const filters = input.filters ?? {};
  // Subject slug có thể là single (auto-expand) hoặc array (caller pre-expanded).
  const slugList =
    filters.subjectSlugs && filters.subjectSlugs.length > 0
      ? filters.subjectSlugs
      : filters.subjectSlug
        ? expandSubjectSlug(filters.subjectSlug)
        : [];

  // ── Empty query: sort theo urgency + createdAt ───────────────────
  if (!query) {
    return selectBaseFiltered({ ...filters, slugList }, limit);
  }

  // ── Build embedding lazy ─────────────────────────────────────────
  const queryEmbedding = await embedQuery(query);
  const embStr = `[${queryEmbedding.join(',')}]`;
  const tsq = toTsQuery(query);

  // ── Filter SQL fragment dùng chung 2 CTE ─────────────────────────
  // HYBRID modality cũng match (tutor có thể dạy cả 2 hình thức).
  const modalitySql = filters.modality
    ? sql`AND (tr.modality = ${filters.modality} OR tr.modality = 'HYBRID')`
    : sql``;
  // Build text array literal — Drizzle không bind JS array vào ANY() đúng.
  const slugLiteral =
    slugList.length > 0
      ? `{${slugList.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`
      : null;
  const subjectSql = slugLiteral
    ? sql`AND tr.subject_slug = ANY(${slugLiteral}::text[])`
    : sql``;
  const levelSql = filters.level ? sql`AND tr.level = ${filters.level}` : sql``;
  const budgetSql = filters.budgetMinVnd
    ? sql`AND tr.budget_vnd IS NOT NULL AND tr.budget_vnd >= ${filters.budgetMinVnd}`
    : sql``;

  const filterSql = sql`tr.status = 'OPEN'
    ${subjectSql}
    ${levelSql}
    ${modalitySql}
    ${budgetSql}`;

  const rawResults = await db.execute<{
    id: string;
    score: number;
    fts_rank: number | null;
    vec_rank: number | null;
  }>(sql`
    WITH
    fts_ranks AS (
      SELECT
        tr.id,
        ROW_NUMBER() OVER (ORDER BY ts_rank(tr.search_vec, to_tsquery('simple', ${tsq})) DESC) AS rnk
      FROM tutor_request tr
      WHERE ${filterSql}
        AND ${tsq}::text <> ''
        AND tr.search_vec @@ to_tsquery('simple', ${tsq})
      LIMIT ${CANDIDATE_LIMIT}
    ),
    vec_ranks AS (
      SELECT
        tr.id,
        ROW_NUMBER() OVER (ORDER BY tr.embedding <=> ${embStr}::vector) AS rnk
      FROM tutor_request tr
      WHERE ${filterSql}
        AND tr.embedding IS NOT NULL
      LIMIT ${CANDIDATE_LIMIT}
    )
    SELECT
      COALESCE(f.id, v.id) AS id,
      1.0 / (${RRF_K} + COALESCE(f.rnk, 1000)) + 1.0 / (${RRF_K} + COALESCE(v.rnk, 1000)) AS score,
      f.rnk::int AS fts_rank,
      v.rnk::int AS vec_rank
    FROM fts_ranks f
    FULL OUTER JOIN vec_ranks v ON f.id = v.id
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  // ── Fallback rating-sort khi RRF empty ───────────────────────────
  if (rawResults.length === 0) {
    return selectBaseFiltered({ ...filters, slugList }, limit);
  }

  // ── Fetch full request data typed ────────────────────────────────
  const ids = rawResults.map((r) => r.id);
  const requests = await db
    .select({
      id: tutorRequest.id,
      studentId: tutorRequest.studentId,
      studentName: userTable.name,
      title: tutorRequest.title,
      description: tutorRequest.description,
      subjectSlug: tutorRequest.subjectSlug,
      level: tutorRequest.level,
      budgetVnd: tutorRequest.budgetVnd,
      modality: tutorRequest.modality,
      urgency: tutorRequest.urgency,
      status: tutorRequest.status,
      createdAt: tutorRequest.createdAt,
    })
    .from(tutorRequest)
    .leftJoin(userTable, eq(userTable.id, tutorRequest.studentId))
    .where(inArray(tutorRequest.id, ids));

  const reqMap = new Map(requests.map((r) => [r.id, r]));

  return rawResults
    .map((r) => {
      const req = reqMap.get(r.id);
      if (!req) return null;
      return {
        ...req,
        score: Number(r.score),
        ftsRank: r.fts_rank,
        vecRank: r.vec_rank,
      };
    })
    .filter((x): x is RequestSearchResult => !!x);
}

/**
 * Filter-only path — sort urgency DESC + createdAt DESC.
 * Map: ASAP=3, THIS_WEEK=2, THIS_MONTH=1, FLEXIBLE=0.
 */
async function selectBaseFiltered(
  filters: RequestSearchInput['filters'] & { slugList?: string[] } = {},
  limit: number,
): Promise<RequestSearchResult[]> {
  const conds = [eq(tutorRequest.status, 'OPEN')];
  if (filters.slugList && filters.slugList.length > 0) {
    conds.push(inArray(tutorRequest.subjectSlug, filters.slugList));
  }
  if (filters.level) conds.push(eq(tutorRequest.level, filters.level));
  if (filters.modality) {
    const mod = or(
      eq(tutorRequest.modality, filters.modality),
      eq(tutorRequest.modality, 'HYBRID'),
    );
    if (mod) conds.push(mod as ReturnType<typeof eq>);
  }
  if (filters.budgetMinVnd) {
    conds.push(gte(tutorRequest.budgetVnd, filters.budgetMinVnd));
  }

  const rows = await db
    .select({
      id: tutorRequest.id,
      studentId: tutorRequest.studentId,
      studentName: userTable.name,
      title: tutorRequest.title,
      description: tutorRequest.description,
      subjectSlug: tutorRequest.subjectSlug,
      level: tutorRequest.level,
      budgetVnd: tutorRequest.budgetVnd,
      modality: tutorRequest.modality,
      urgency: tutorRequest.urgency,
      status: tutorRequest.status,
      createdAt: tutorRequest.createdAt,
    })
    .from(tutorRequest)
    .leftJoin(userTable, eq(userTable.id, tutorRequest.studentId))
    .where(and(...conds))
    .orderBy(
      sql`CASE ${tutorRequest.urgency}
            WHEN 'ASAP' THEN 3
            WHEN 'THIS_WEEK' THEN 2
            WHEN 'THIS_MONTH' THEN 1
            ELSE 0
          END DESC`,
      sql`${tutorRequest.createdAt} DESC`,
    )
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    score: 0,
    ftsRank: null,
    vecRank: null,
  }));
}

/** Convert text → tsquery với prefix wildcard, strip mọi punctuation. */
function toTsQuery(text: string): string {
  const cleaned = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (cleaned.length === 0) return '';
  return cleaned.map((w) => `${w}:*`).join(' & ');
}

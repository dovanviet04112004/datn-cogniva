/**
 * hybrid-search — V4 T1 (2026-05-22).
 *
 * Search gia sư kết hợp FTS (tsvector) + Vector (pgvector cosine) qua
 * Reciprocal Rank Fusion (RRF):
 *
 *   score = 1/(k + fts_rank) + 1/(k + vec_rank)   với k = 60
 *
 * Lý do RRF:
 *   - Không cần normalize score 2 metric khác nhau
 *   - Robust với outlier rank
 *   - Industry standard (Elastic, Vespa, Pinecone đều dùng)
 *
 * Filter cứng (subject/level/modality/budget) áp dụng TRƯỚC ranking — narrow
 * candidate pool rồi mới RRF top 50 → return top N.
 *
 * Spec: docs/plans/tutoring-v4.md §5.2.
 */
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';

import {
  db,
  tutorProfile,
  tutorSubject,
} from '@cogniva/db';
import { expandSubjectSlug } from '@cogniva/db/taxonomy';

import { embedQuery } from '@/lib/ingest/embed-query';

const RRF_K = 60;
const CANDIDATE_LIMIT = 50;

export type HybridSearchInput = {
  /** Free text query — empty thì chỉ filter, không FTS/vector. */
  query?: string;
  /** Filter cứng. */
  filters?: {
    subjectSlug?: string;
    level?: string;
    modality?: string;
    budgetMaxVnd?: number;
  };
  /** Max return. */
  limit?: number;
};

export type HybridSearchResult = {
  id: string;
  userId: string;
  headline: string;
  bio: string;
  hourlyRateVnd: number;
  modality: string;
  avatarUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  sessionsCompleted: number;
  verificationStatus: string;
  /** RRF fusion score (higher = better). */
  score: number;
  /** Rank trong FTS (NULL nếu không match FTS). */
  ftsRank: number | null;
  /** Rank trong vector (NULL nếu không có embedding hoặc query empty). */
  vecRank: number | null;
};

/**
 * Hybrid search gia sư.
 *
 * Trường hợp:
 *   - query rỗng + có filter → trả theo rating DESC trong filter
 *   - query có + có embedding tutor → FTS ⊕ vector RRF
 *   - query có nhưng tutor chưa embed → chỉ FTS
 */
export async function hybridSearchTutors(
  input: HybridSearchInput,
): Promise<HybridSearchResult[]> {
  const limit = input.limit ?? 10;
  const query = input.query?.trim();
  const filters = input.filters ?? {};

  // ── Empty query: rating sort ─────────────────────────────────────
  if (!query) {
    const rows = await selectBaseFiltered(filters, limit);
    return rows.map((r) => ({
      ...r,
      score: 0,
      ftsRank: null,
      vecRank: null,
    }));
  }

  // ── Compute embedding query lazy ─────────────────────────────────
  const queryEmbedding = await embedQuery(query);
  const embStr = `[${queryEmbedding.join(',')}]`;

  // ── tsquery format (prefix match qua :*) ─────────────────────────
  const tsq = toTsQuery(query);

  // ── Build filter WHERE common ────────────────────────────────────
  const filterConds: ReturnType<typeof eq>[] = [
    eq(tutorProfile.status, 'PUBLISHED'),
  ];
  // Subject hierarchy: "english" → ['english', 'english-ielts', 'english-toeic'].
  const expandedSlugs = filters.subjectSlug
    ? expandSubjectSlug(filters.subjectSlug)
    : null;
  if (expandedSlugs && expandedSlugs.length > 0) {
    filterConds.push(inArray(tutorSubject.subjectSlug, expandedSlugs));
  }
  if (filters.level) {
    filterConds.push(eq(tutorSubject.level, filters.level));
  }
  if (filters.modality) {
    // HYBRID tutor dạy cả online + offline → là superset của mọi modality cứng.
    // User chọn ONLINE vẫn nên thấy tutor HYBRID (họ có thể dạy online).
    const modCond = or(
      eq(tutorProfile.modality, filters.modality),
      eq(tutorProfile.modality, 'HYBRID'),
    );
    if (modCond) filterConds.push(modCond as ReturnType<typeof eq>);
  }
  if (filters.budgetMaxVnd) {
    filterConds.push(lte(tutorProfile.hourlyRateVnd, filters.budgetMaxVnd));
  }
  // Filter join — chỉ có subject join nếu filter subject/level
  const needSubjectJoin = !!(filters.subjectSlug || filters.level);

  // ── RRF query: FULL OUTER JOIN FTS + vector ──────────────────────
  // Drizzle sql template — viết raw SQL để control rank window.
  // HYBRID là superset → modality=ONLINE matches cả ONLINE và HYBRID
  const modalitySql = filters.modality
    ? sql`AND (tp.modality = ${filters.modality} OR tp.modality = 'HYBRID')`
    : sql``;
  // Subject filter dùng expanded slug array (hierarchy aware).
  // LƯU Ý: Drizzle interpolate JS array thành tuple ($1,$2). Phải build
  // Postgres text array literal '{a,b}'::text[] để ANY() nhận array.
  const expandedSlugLiteral = expandedSlugs
    ? `{${expandedSlugs.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`
    : null;
  const subjectSqlInRaw = expandedSlugLiteral
    ? sql`AND ts.subject_slug = ANY(${expandedSlugLiteral}::text[])`
    : sql``;
  const filterSql = needSubjectJoin
    ? sql`tp.status = 'PUBLISHED'
        AND EXISTS (
          SELECT 1 FROM tutor_subject ts
          WHERE ts.tutor_id = tp.id
          ${subjectSqlInRaw}
          ${filters.level ? sql`AND ts.level = ${filters.level}` : sql``}
        )
        ${modalitySql}
        ${filters.budgetMaxVnd ? sql`AND tp.hourly_rate_vnd <= ${filters.budgetMaxVnd}` : sql``}`
    : sql`tp.status = 'PUBLISHED'
        ${modalitySql}
        ${filters.budgetMaxVnd ? sql`AND tp.hourly_rate_vnd <= ${filters.budgetMaxVnd}` : sql``}`;

  const rawResults = await db.execute<{
    id: string;
    score: number;
    fts_rank: number | null;
    vec_rank: number | null;
  }>(sql`
    WITH
    fts_ranks AS (
      SELECT
        tp.id,
        ROW_NUMBER() OVER (ORDER BY ts_rank(tp.search_vec, to_tsquery('simple', ${tsq})) DESC) AS rnk
      FROM tutor_profile tp
      WHERE ${filterSql}
        AND ${tsq}::text <> ''
        AND tp.search_vec @@ to_tsquery('simple', ${tsq})
      LIMIT ${CANDIDATE_LIMIT}
    ),
    vec_ranks AS (
      SELECT
        tp.id,
        ROW_NUMBER() OVER (ORDER BY tp.bio_embedding <=> ${embStr}::vector) AS rnk
      FROM tutor_profile tp
      WHERE ${filterSql}
        AND tp.bio_embedding IS NOT NULL
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

  // ── Fallback filter-only: nếu RRF không match (FTS không bắt từ + tutor
  // chưa có embedding) → vẫn trả tutor khớp filter, sort theo rating. Đây
  // là pattern industry (Preply/Italki): user gõ query lạ vẫn thấy tutor
  // ngành đó, không bao giờ "no result".
  if (rawResults.length === 0) {
    const rows = await selectBaseFiltered(filters, limit);
    return rows.map((r) => ({
      ...r,
      score: 0,
      ftsRank: null,
      vecRank: null,
    }));
  }

  // ── Fetch full tutor data via typed query builder ────────────────
  // Lưu ý: raw `WHERE id = ANY(${ids})` qua db.execute không bind array đúng
  // với Drizzle 0.45 → dùng inArray() typed để an toàn.
  const ids = rawResults.map((r) => r.id);
  const tutors = await db
    .select({
      id: tutorProfile.id,
      userId: tutorProfile.userId,
      headline: tutorProfile.headline,
      bio: tutorProfile.bio,
      hourlyRateVnd: tutorProfile.hourlyRateVnd,
      modality: tutorProfile.modality,
      avatarUrl: tutorProfile.avatarUrl,
      ratingAvg: tutorProfile.ratingAvg,
      ratingCount: tutorProfile.ratingCount,
      sessionsCompleted: tutorProfile.sessionsCompleted,
      verificationStatus: tutorProfile.verificationStatus,
    })
    .from(tutorProfile)
    .where(inArray(tutorProfile.id, ids));

  const tutorMap = new Map(tutors.map((t) => [t.id, t]));

  return rawResults
    .map((r) => {
      const t = tutorMap.get(r.id);
      if (!t) return null;
      return {
        id: t.id,
        userId: t.userId,
        headline: t.headline,
        bio: t.bio,
        hourlyRateVnd: t.hourlyRateVnd,
        modality: t.modality,
        avatarUrl: t.avatarUrl,
        ratingAvg: t.ratingAvg ? Number(t.ratingAvg) : null,
        ratingCount: t.ratingCount,
        sessionsCompleted: t.sessionsCompleted,
        verificationStatus: t.verificationStatus,
        score: Number(r.score),
        ftsRank: r.fts_rank,
        vecRank: r.vec_rank,
      };
    })
    .filter((x): x is HybridSearchResult => !!x);
}

/**
 * Empty query path — pre-filter, sort theo rating + sessions DESC.
 */
async function selectBaseFiltered(
  filters: HybridSearchInput['filters'] = {},
  limit: number,
) {
  const conds: ReturnType<typeof eq>[] = [eq(tutorProfile.status, 'PUBLISHED')];
  if (filters.modality) conds.push(eq(tutorProfile.modality, filters.modality));
  if (filters.budgetMaxVnd)
    conds.push(lte(tutorProfile.hourlyRateVnd, filters.budgetMaxVnd));

  const baseSelect = db
    .select({
      id: tutorProfile.id,
      userId: tutorProfile.userId,
      headline: tutorProfile.headline,
      bio: tutorProfile.bio,
      hourlyRateVnd: tutorProfile.hourlyRateVnd,
      modality: tutorProfile.modality,
      avatarUrl: tutorProfile.avatarUrl,
      ratingAvg: tutorProfile.ratingAvg,
      ratingCount: tutorProfile.ratingCount,
      sessionsCompleted: tutorProfile.sessionsCompleted,
      verificationStatus: tutorProfile.verificationStatus,
    })
    .from(tutorProfile);

  if (filters.subjectSlug || filters.level) {
    if (filters.subjectSlug) {
      const expanded = expandSubjectSlug(filters.subjectSlug);
      conds.push(inArray(tutorSubject.subjectSlug, expanded));
    }
    if (filters.level) conds.push(eq(tutorSubject.level, filters.level));
    const rows = await baseSelect
      .innerJoin(tutorSubject, eq(tutorSubject.tutorId, tutorProfile.id))
      .where(and(...conds))
      .orderBy(
        sql`COALESCE(${tutorProfile.ratingAvg}, 0) DESC`,
        sql`${tutorProfile.sessionsCompleted} DESC`,
      )
      .limit(limit);
    // Dedupe theo tutorId vì subject join có thể duplicate
    const seen = new Set<string>();
    return rows.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).map((r) => ({
      ...r,
      ratingAvg: r.ratingAvg ? Number(r.ratingAvg) : null,
    }));
  }

  const rows = await baseSelect
    .where(and(...conds))
    .orderBy(
      sql`COALESCE(${tutorProfile.ratingAvg}, 0) DESC`,
      sql`${tutorProfile.sessionsCompleted} DESC`,
    )
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    ratingAvg: r.ratingAvg ? Number(r.ratingAvg) : null,
  }));
}

/**
 * Convert text query → Postgres tsquery format với prefix wildcard.
 * "toán lớp 11" → "toán:* & lớp:* & 11:*"
 *
 * Strip mọi punctuation (giữ letters + digits + whitespace + Vietnamese
 * combining marks). Postgres tsquery sẽ throw nếu có ký tự đặc biệt như
 * comma, question mark, parens, dấu nháy.
 */
function toTsQuery(text: string): string {
  // \p{L} = letter (incl. Vietnamese), \p{N} = number, \s = whitespace
  const cleaned = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (cleaned.length === 0) return '';
  return cleaned.map((w) => `${w}:*`).join(' & ');
}

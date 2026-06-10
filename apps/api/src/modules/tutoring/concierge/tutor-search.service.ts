/**
 * TutorSearchService — port từ apps/web/src/lib/tutoring/hybrid-search.ts
 * (hybridSearchTutors) + request-search.ts (hybridSearchRequests), GIỮ NGUYÊN
 * semantics từng nhánh.
 *
 * Cả 2 dùng FTS (tsvector) ⊕ Vector (pgvector cosine) qua Reciprocal Rank
 * Fusion: score = 1/(k + fts_rank) + 1/(k + vec_rank), k = 60. Lý do RRF:
 * không cần normalize score 2 metric khác nhau, robust với outlier rank.
 * Filter cứng áp dụng TRƯỚC ranking; query rỗng / RRF 0 hit → fallback
 * filter-only sort deterministic (không bao giờ "no result" khi có tutor
 * cùng ngành — pattern Preply/Italki).
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { EmbeddingService } from '../../../infra/ai/embedding.service';
import { PrismaService } from '../../../infra/database/prisma.service';
import { expandSubjectSlug } from '../../library/subject-taxonomy';

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

/** Row RRF $queryRaw — score là numeric (Decimal) → caller Number() lại. */
type RrfRow = { id: string; score: unknown; fts_rank: number | null; vec_rank: number | null };

type TutorBaseRow = {
  id: string;
  user_id: string;
  headline: string;
  bio: string;
  hourly_rate_vnd: number;
  modality: string;
  avatar_url: string | null;
  rating_avg: unknown;
  rating_count: number;
  sessions_completed: number;
  verification_status: string;
};

type RequestBaseRow = {
  id: string;
  student_id: string;
  student_name: string | null;
  title: string;
  description: string;
  subject_slug: string;
  level: string;
  budget_vnd: number | null;
  modality: string;
  urgency: string;
  status: string;
  created_at: Date;
};

@Injectable()
export class TutorSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * Hybrid search gia sư.
   *
   * Trường hợp:
   *   - query rỗng + có filter → trả theo rating DESC trong filter
   *   - query có + có embedding tutor → FTS ⊕ vector RRF
   *   - query có nhưng tutor chưa embed → chỉ FTS
   */
  async hybridSearchTutors(input: HybridSearchInput): Promise<HybridSearchResult[]> {
    const limit = input.limit ?? 10;
    const query = input.query?.trim();
    const filters = input.filters ?? {};

    // ── Empty query: rating sort ─────────────────────────────────────
    if (!query) {
      return this.selectTutorsBaseFiltered(filters, limit);
    }

    // ── Compute embedding query lazy ─────────────────────────────────
    const queryEmbedding = await this.embedding.embedQuery(query);
    const embStr = `[${queryEmbedding.join(',')}]`;

    // ── tsquery format (prefix match qua :*) ─────────────────────────
    const tsq = toTsQuery(query);

    // Subject hierarchy: "english" → ['english', 'english-ielts', 'english-toeic'].
    const expandedSlugs = filters.subjectSlug ? expandSubjectSlug(filters.subjectSlug) : null;
    const needSubjectJoin = !!(filters.subjectSlug || filters.level);

    // ── RRF query: FULL OUTER JOIN FTS + vector ──────────────────────
    // HYBRID là superset → modality=ONLINE matches cả ONLINE và HYBRID
    const modalitySql = filters.modality
      ? Prisma.sql`AND (tp.modality = ${filters.modality} OR tp.modality = 'HYBRID')`
      : Prisma.empty;
    // Postgres text array literal '{a,b}'::text[] để ANY() nhận array (như lib cũ).
    const expandedSlugLiteral = expandedSlugs
      ? `{${expandedSlugs.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`
      : null;
    const subjectSqlInRaw = expandedSlugLiteral
      ? Prisma.sql`AND ts.subject_slug = ANY(${expandedSlugLiteral}::text[])`
      : Prisma.empty;
    const filterSql = needSubjectJoin
      ? Prisma.sql`tp.status = 'PUBLISHED'
          AND EXISTS (
            SELECT 1 FROM tutor_subject ts
            WHERE ts.tutor_id = tp.id
            ${subjectSqlInRaw}
            ${filters.level ? Prisma.sql`AND ts.level = ${filters.level}` : Prisma.empty}
          )
          ${modalitySql}
          ${filters.budgetMaxVnd ? Prisma.sql`AND tp.hourly_rate_vnd <= ${filters.budgetMaxVnd}` : Prisma.empty}`
      : Prisma.sql`tp.status = 'PUBLISHED'
          ${modalitySql}
          ${filters.budgetMaxVnd ? Prisma.sql`AND tp.hourly_rate_vnd <= ${filters.budgetMaxVnd}` : Prisma.empty}`;

    const rawResults = await this.prisma.$queryRaw<RrfRow[]>(Prisma.sql`
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
    // chưa có embedding) → vẫn trả tutor khớp filter, sort theo rating.
    if (rawResults.length === 0) {
      return this.selectTutorsBaseFiltered(filters, limit);
    }

    // ── Fetch full tutor data typed ──────────────────────────────────
    const ids = rawResults.map((r) => r.id);
    const tutors = await this.prisma.tutor_profile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        user_id: true,
        headline: true,
        bio: true,
        hourly_rate_vnd: true,
        modality: true,
        avatar_url: true,
        rating_avg: true,
        rating_count: true,
        sessions_completed: true,
        verification_status: true,
      },
    });

    const tutorMap = new Map(tutors.map((t) => [t.id, t]));

    return rawResults
      .map((r) => {
        const t = tutorMap.get(r.id);
        if (!t) return null;
        return {
          id: t.id,
          userId: t.user_id,
          headline: t.headline,
          bio: t.bio,
          hourlyRateVnd: t.hourly_rate_vnd,
          modality: t.modality,
          avatarUrl: t.avatar_url,
          ratingAvg: t.rating_avg ? Number(t.rating_avg) : null,
          ratingCount: t.rating_count,
          sessionsCompleted: t.sessions_completed,
          verificationStatus: t.verification_status,
          score: Number(r.score),
          ftsRank: r.fts_rank,
          vecRank: r.vec_rank,
        };
      })
      .filter((x): x is HybridSearchResult => !!x);
  }

  /**
   * Hybrid search tutoring requests (tutor-side concierge).
   *
   * Trường hợp:
   *   - query rỗng + có filter → trả request mới nhất / urgency cao nhất
   *   - query có → FTS ⊕ vector RRF, fallback sort deterministic khi 0 result
   */
  async hybridSearchRequests(input: RequestSearchInput): Promise<RequestSearchResult[]> {
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
      return this.selectRequestsBaseFiltered({ ...filters, slugList }, limit);
    }

    // ── Build embedding lazy ─────────────────────────────────────────
    const queryEmbedding = await this.embedding.embedQuery(query);
    const embStr = `[${queryEmbedding.join(',')}]`;
    const tsq = toTsQuery(query);

    // ── Filter SQL fragment dùng chung 2 CTE ─────────────────────────
    // HYBRID modality cũng match (tutor có thể dạy cả 2 hình thức).
    const modalitySql = filters.modality
      ? Prisma.sql`AND (tr.modality = ${filters.modality} OR tr.modality = 'HYBRID')`
      : Prisma.empty;
    const slugLiteral =
      slugList.length > 0
        ? `{${slugList.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`
        : null;
    const subjectSql = slugLiteral
      ? Prisma.sql`AND tr.subject_slug = ANY(${slugLiteral}::text[])`
      : Prisma.empty;
    const levelSql = filters.level ? Prisma.sql`AND tr.level = ${filters.level}` : Prisma.empty;
    const budgetSql = filters.budgetMinVnd
      ? Prisma.sql`AND tr.budget_vnd IS NOT NULL AND tr.budget_vnd >= ${filters.budgetMinVnd}`
      : Prisma.empty;

    const filterSql = Prisma.sql`tr.status = 'OPEN'
      ${subjectSql}
      ${levelSql}
      ${modalitySql}
      ${budgetSql}`;

    const rawResults = await this.prisma.$queryRaw<RrfRow[]>(Prisma.sql`
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

    // ── Fallback sort deterministic khi RRF empty ────────────────────
    if (rawResults.length === 0) {
      return this.selectRequestsBaseFiltered({ ...filters, slugList }, limit);
    }

    // ── Fetch full request data typed ────────────────────────────────
    const ids = rawResults.map((r) => r.id);
    const requests = await this.prisma.tutor_request.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        student_id: true,
        title: true,
        description: true,
        subject_slug: true,
        level: true,
        budget_vnd: true,
        modality: true,
        urgency: true,
        status: true,
        created_at: true,
        user: { select: { name: true } },
      },
    });

    const reqMap = new Map(requests.map((r) => [r.id, r]));

    return rawResults
      .map((r) => {
        const req = reqMap.get(r.id);
        if (!req) return null;
        return {
          id: req.id,
          studentId: req.student_id,
          studentName: req.user.name,
          title: req.title,
          description: req.description,
          subjectSlug: req.subject_slug,
          level: req.level,
          budgetVnd: req.budget_vnd,
          modality: req.modality,
          urgency: req.urgency,
          status: req.status,
          createdAt: req.created_at,
          score: Number(r.score),
          ftsRank: r.fts_rank,
          vecRank: r.vec_rank,
        };
      })
      .filter((x): x is RequestSearchResult => !!x);
  }

  /**
   * Empty query path tutors — pre-filter, sort theo rating + sessions DESC.
   * Lib cũ: LIMIT áp lên joined rows TRƯỚC khi dedupe theo tutor id — giữ
   * nguyên (kết quả có thể < limit khi tutor trùng nhiều subject row).
   */
  private async selectTutorsBaseFiltered(
    filters: HybridSearchInput['filters'] = {},
    limit: number,
  ): Promise<HybridSearchResult[]> {
    const conds: Prisma.Sql[] = [Prisma.sql`tp.status = 'PUBLISHED'`];
    // Lib cũ nhánh này KHÔNG nới HYBRID — modality match đúng giá trị.
    if (filters.modality) conds.push(Prisma.sql`tp.modality = ${filters.modality}`);
    if (filters.budgetMaxVnd) {
      conds.push(Prisma.sql`tp.hourly_rate_vnd <= ${filters.budgetMaxVnd}`);
    }

    const selectCols = Prisma.sql`tp.id, tp.user_id, tp.headline, tp.bio,
      tp.hourly_rate_vnd, tp.modality, tp.avatar_url, tp.rating_avg, tp.rating_count,
      tp.sessions_completed, tp.verification_status`;
    const orderBy = Prisma.sql`COALESCE(tp.rating_avg, 0) DESC, tp.sessions_completed DESC`;

    let rows: TutorBaseRow[];
    if (filters.subjectSlug || filters.level) {
      if (filters.subjectSlug) {
        const expanded = expandSubjectSlug(filters.subjectSlug);
        conds.push(Prisma.sql`ts.subject_slug IN (${Prisma.join(expanded)})`);
      }
      if (filters.level) conds.push(Prisma.sql`ts.level = ${filters.level}`);
      const joined = await this.prisma.$queryRaw<TutorBaseRow[]>(Prisma.sql`
        SELECT ${selectCols}
        FROM tutor_profile tp
        INNER JOIN tutor_subject ts ON ts.tutor_id = tp.id
        WHERE ${Prisma.join(conds, ' AND ')}
        ORDER BY ${orderBy}
        LIMIT ${limit}`);
      // Dedupe theo tutorId vì subject join có thể duplicate
      const seen = new Set<string>();
      rows = joined.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
    } else {
      rows = await this.prisma.$queryRaw<TutorBaseRow[]>(Prisma.sql`
        SELECT ${selectCols}
        FROM tutor_profile tp
        WHERE ${Prisma.join(conds, ' AND ')}
        ORDER BY ${orderBy}
        LIMIT ${limit}`);
    }

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      headline: r.headline,
      bio: r.bio,
      hourlyRateVnd: r.hourly_rate_vnd,
      modality: r.modality,
      avatarUrl: r.avatar_url,
      ratingAvg: r.rating_avg ? Number(r.rating_avg) : null,
      ratingCount: r.rating_count,
      sessionsCompleted: r.sessions_completed,
      verificationStatus: r.verification_status,
      score: 0,
      ftsRank: null,
      vecRank: null,
    }));
  }

  /**
   * Filter-only path requests — sort urgency DESC + createdAt DESC.
   * Map: ASAP=3, THIS_WEEK=2, THIS_MONTH=1, FLEXIBLE=0.
   */
  private async selectRequestsBaseFiltered(
    filters: NonNullable<RequestSearchInput['filters']> & { slugList?: string[] },
    limit: number,
  ): Promise<RequestSearchResult[]> {
    const conds: Prisma.Sql[] = [Prisma.sql`tr.status = 'OPEN'`];
    if (filters.slugList && filters.slugList.length > 0) {
      conds.push(Prisma.sql`tr.subject_slug IN (${Prisma.join(filters.slugList)})`);
    }
    if (filters.level) conds.push(Prisma.sql`tr.level = ${filters.level}`);
    if (filters.modality) {
      // Nhánh base này CÓ nới HYBRID (khác nhánh tutors) — y lib cũ.
      conds.push(
        Prisma.sql`(tr.modality = ${filters.modality} OR tr.modality = 'HYBRID')`,
      );
    }
    if (filters.budgetMinVnd) {
      conds.push(Prisma.sql`tr.budget_vnd >= ${filters.budgetMinVnd}`);
    }

    const rows = await this.prisma.$queryRaw<RequestBaseRow[]>(Prisma.sql`
      SELECT tr.id, tr.student_id, u.name AS student_name, tr.title, tr.description,
        tr.subject_slug, tr.level, tr.budget_vnd, tr.modality, tr.urgency, tr.status,
        tr.created_at
      FROM tutor_request tr
      LEFT JOIN "user" u ON u.id = tr.student_id
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY CASE tr.urgency
            WHEN 'ASAP' THEN 3
            WHEN 'THIS_WEEK' THEN 2
            WHEN 'THIS_MONTH' THEN 1
            ELSE 0
          END DESC,
        tr.created_at DESC
      LIMIT ${limit}`);

    return rows.map((r) => ({
      id: r.id,
      studentId: r.student_id,
      studentName: r.student_name,
      title: r.title,
      description: r.description,
      subjectSlug: r.subject_slug,
      level: r.level,
      budgetVnd: r.budget_vnd,
      modality: r.modality,
      urgency: r.urgency,
      status: r.status,
      createdAt: r.created_at,
      score: 0,
      ftsRank: null,
      vecRank: null,
    }));
  }
}

/**
 * Convert text query → Postgres tsquery format với prefix wildcard.
 * "toán lớp 11" → "toán:* & lớp:* & 11:*"
 *
 * Strip mọi punctuation (giữ letters + digits + whitespace) — Postgres
 * tsquery throw nếu có ký tự đặc biệt như comma, question mark, parens.
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

/**
 * HybridSearchService — port từ apps/web/src/lib/library/hybrid-search-doc.ts
 * (GIỮ NGUYÊN semantics, kể cả SQL FTS + relative floor + cách build literal
 * array). Search doc-level:
 *   - query rỗng → filter + sort theo `sort` mode.
 *   - query có → FTS `search_vec` (unaccent) xếp ts_rank DESC + floor 2%.
 * KHÔNG dùng vector embedding ở grid search (probe cũ cho thấy title_embedding
 * vô tín hiệu với tiếng Việt — xem header lib cũ).
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';
import { expandSubjectSlug } from './subject-taxonomy';

const CANDIDATE_LIMIT = 50;

export type LibrarySearchInput = {
  query?: string;
  filters?: {
    subjectSlug?: string;
    level?: string;
    grade?: number[];
    docType?: string[];
    examType?: string;
    schoolYear?: string;
    region?: string;
    language?: string;
    fileFormat?: string[];
    minPages?: number;
    maxPages?: number;
    minRating?: number;
    tags?: string[];
    verifiedUploaderOnly?: boolean;
    difficulty?: Array<'easy' | 'medium' | 'hard'>;
    universityId?: string;
    courseId?: string;
  };
  sort?: 'top' | 'rating' | 'popular' | 'newest';
  limit?: number;
  offset?: number;
  /**
   * Cách ghép token FTS: 'and' (mặc định) precise cho grid search; 'or' recall
   * cao cho query dài nhiều topic (goal planner) — ts_rank vẫn đẩy doc khớp
   * nhiều token lên đầu + floor cắt nhiễu.
   */
  matchMode?: 'and' | 'or';
};

export type LibraryDocResult = {
  id: string;
  uploaderId: string;
  uploaderName: string | null;
  title: string;
  description: string | null;
  subjectSlug: string;
  level: string;
  grade: number | null;
  docType: string;
  examType: string | null;
  schoolYear: string | null;
  language: string;
  tags: string[];
  fileFormat: string;
  pageCount: number | null;
  previewThumbUrl: string | null;
  aiSummary: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  viewCount: number;
  downloadCount: number;
  workspaceImportCount: number;
  qualityScore: number | null;
  badges: string[];
  difficulty: string | null;
  isPremium: boolean;
  priceVnd: number | null;
  courseNameCache: string | null;
  createdAt: Date;
  score: number;
  ftsRank: number | null;
  vecRank: number | null;
};

/** Row $queryRaw snake_case — rating_avg/quality_score là Decimal (numeric). */
type DocRow = {
  id: string;
  uploader_id: string;
  uploader_name: string | null;
  title: string;
  description: string | null;
  subject_slug: string;
  level: string;
  grade: number | null;
  doc_type: string;
  exam_type: string | null;
  school_year: string | null;
  language: string;
  tags: string[] | null;
  file_format: string;
  page_count: number | null;
  preview_thumb_url: string | null;
  ai_summary: string | null;
  rating_avg: unknown;
  rating_count: number;
  view_count: number;
  download_count: number;
  workspace_import_count: number;
  quality_score: unknown;
  badges: string[] | null;
  difficulty: string | null;
  is_premium: boolean | null;
  price_vnd: number | null;
  course_name_cache: string | null;
  created_at: Date;
};

/** SELECT shape — đúng thứ tự buildSelect() của lib cũ (alias tp + join user). */
const SELECT_COLS = Prisma.sql`tp.id, tp.uploader_id, u.name AS uploader_name, tp.title,
  tp.description, tp.subject_slug, tp.level, tp.grade, tp.doc_type, tp.exam_type,
  tp.school_year, tp.language, tp.tags, tp.file_format, tp.page_count,
  tp.preview_thumb_url, tp.ai_summary, tp.rating_avg, tp.rating_count, tp.view_count,
  tp.download_count, tp.workspace_import_count, tp.quality_score, tp.badges,
  tp.difficulty, tp.is_premium, tp.price_vnd, tp.course_name_cache, tp.created_at`;

@Injectable()
export class HybridSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async hybridSearchLibraryDocs(
    input: LibrarySearchInput,
  ): Promise<{ items: LibraryDocResult[]; total: number }> {
    const limit = input.limit ?? 24;
    const offset = input.offset ?? 0;
    const query = input.query?.trim();
    const filters = input.filters ?? {};
    const sort = input.sort ?? 'top';

    // ── Build filter WHERE conditions (thứ tự y lib cũ) ─────────────────
    const conds: Prisma.Sql[] = [Prisma.sql`tp.status = 'PUBLISHED'`];

    // Subject hierarchy expand (vd "english" → ['english', 'english-ielts', ...])
    let expandedSlugs: string[] | null = null;
    if (filters.subjectSlug) {
      expandedSlugs = expandSubjectSlug(filters.subjectSlug);
      if (expandedSlugs.length > 0) {
        conds.push(Prisma.sql`tp.subject_slug IN (${Prisma.join(expandedSlugs)})`);
      }
    }
    if (filters.level) conds.push(Prisma.sql`tp.level = ${filters.level}`);
    if (filters.grade && filters.grade.length > 0) {
      conds.push(Prisma.sql`tp.grade IN (${Prisma.join(filters.grade)})`);
    }
    if (filters.docType && filters.docType.length > 0) {
      conds.push(Prisma.sql`tp.doc_type IN (${Prisma.join(filters.docType)})`);
    }
    if (filters.examType) conds.push(Prisma.sql`tp.exam_type = ${filters.examType}`);
    if (filters.schoolYear) conds.push(Prisma.sql`tp.school_year = ${filters.schoolYear}`);
    if (filters.region) conds.push(Prisma.sql`tp.region = ${filters.region}`);
    if (filters.language) conds.push(Prisma.sql`tp.language = ${filters.language}`);
    if (filters.fileFormat && filters.fileFormat.length > 0) {
      conds.push(Prisma.sql`tp.file_format IN (${Prisma.join(filters.fileFormat)})`);
    }
    if (filters.minPages != null) {
      conds.push(Prisma.sql`tp.page_count >= ${filters.minPages}`);
    }
    if (filters.maxPages != null) {
      conds.push(Prisma.sql`tp.page_count <= ${filters.maxPages}`);
    }
    if (filters.minRating != null) {
      // Lib cũ truyền String(minRating) cho cột numeric → cast tường minh.
      conds.push(Prisma.sql`tp.rating_avg >= ${String(filters.minRating)}::numeric`);
    }
    if (filters.tags && filters.tags.length > 0) {
      // Postgres array overlap operator && — literal escape y lib cũ.
      const tagsLiteral = `{${filters.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`;
      conds.push(Prisma.sql`tp.tags && ${tagsLiteral}::text[]`);
    }
    if (filters.difficulty && filters.difficulty.length > 0) {
      conds.push(Prisma.sql`tp.difficulty IN (${Prisma.join(filters.difficulty)})`);
    }
    if (filters.universityId) {
      conds.push(Prisma.sql`tp.university_id = ${filters.universityId}`);
    }
    if (filters.courseId) {
      conds.push(Prisma.sql`tp.course_id = ${filters.courseId}`);
    }
    const whereSql = Prisma.join(conds, ' AND ');

    // ── No query path: pure filter + sort ──────────────────────────────
    if (!query) {
      const orderBy = buildOrderBy(sort);
      const [rows, totalRows] = await Promise.all([
        this.prisma.$queryRaw<DocRow[]>(Prisma.sql`
          SELECT ${SELECT_COLS}
          FROM library_doc tp
          LEFT JOIN "user" u ON u.id = tp.uploader_id
          WHERE ${whereSql}
          ORDER BY ${orderBy}
          LIMIT ${limit} OFFSET ${offset}`),
        this.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
          SELECT count(*)::int AS n FROM library_doc tp WHERE ${whereSql}`),
      ]);
      return { items: rows.map(rowToResult), total: totalRows[0]?.n ?? 0 };
    }

    // ── Query path: FTS xếp theo ts_rank (SQL copy NGUYÊN lib cũ) ───────
    const tsq = toTsQuery(query, input.matchMode === 'or' ? '|' : '&');
    if (!tsq) return { items: [], total: 0 };

    const subjectArr = expandedSlugs
      ? `{${expandedSlugs.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`
      : null;
    const subjectSqlF = subjectArr
      ? Prisma.sql`AND tp.subject_slug = ANY(${subjectArr}::text[])`
      : Prisma.empty;
    const levelSqlF = filters.level ? Prisma.sql`AND tp.level = ${filters.level}` : Prisma.empty;
    const langSqlF = filters.language
      ? Prisma.sql`AND tp.language = ${filters.language}`
      : Prisma.empty;
    const gradeArr =
      filters.grade && filters.grade.length > 0 ? `{${filters.grade.join(',')}}` : null;
    const gradeSqlF = gradeArr ? Prisma.sql`AND tp.grade = ANY(${gradeArr}::int[])` : Prisma.empty;
    const typeArr =
      filters.docType && filters.docType.length > 0
        ? `{${filters.docType.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`
        : null;
    const typeSqlF = typeArr ? Prisma.sql`AND tp.doc_type = ANY(${typeArr}::text[])` : Prisma.empty;
    const universitySqlF = filters.universityId
      ? Prisma.sql`AND tp.university_id = ${filters.universityId}`
      : Prisma.empty;
    const courseSqlF = filters.courseId
      ? Prisma.sql`AND tp.course_id = ${filters.courseId}`
      : Prisma.empty;

    // LƯU Ý: phải có khoảng trắng (newline) giữa các mảnh — nối dính sẽ tạo
    // "tp.level = $3AND ..." → Postgres "trailing junk after parameter".
    const filterSql = Prisma.sql`tp.status = 'PUBLISHED'
      ${subjectSqlF}
      ${levelSqlF}
      ${gradeSqlF}
      ${typeSqlF}
      ${langSqlF}
      ${universitySqlF}
      ${courseSqlF}`;

    // Rank theo ts_rank DESC; relative floor (2% rank cao nhất) cắt đuôi nhiễu.
    const ranked = await this.prisma.$queryRaw<Array<{ id: string; rank: number }>>(Prisma.sql`
      WITH q AS (SELECT to_tsquery('simple', immutable_unaccent(${tsq})) AS tsq),
      scored AS (
        SELECT tp.id, ts_rank(tp.search_vec, q.tsq) AS rank
        FROM library_doc tp, q
        WHERE ${filterSql} AND tp.search_vec @@ q.tsq
      )
      SELECT id, rank FROM scored
      WHERE rank >= COALESCE((SELECT max(rank) FROM scored), 0) * 0.02
      ORDER BY rank DESC
      LIMIT ${CANDIDATE_LIMIT}
    `);

    if (ranked.length === 0) return { items: [], total: 0 };

    const total = ranked.length;
    const pageIds = ranked.slice(offset, offset + limit).map((r) => r.id);
    if (pageIds.length === 0) return { items: [], total };

    const fullRows = await this.prisma.$queryRaw<DocRow[]>(Prisma.sql`
      SELECT ${SELECT_COLS}
      FROM library_doc tp
      LEFT JOIN "user" u ON u.id = tp.uploader_id
      WHERE tp.id IN (${Prisma.join(pageIds)})`);

    const rowMap = new Map(fullRows.map((r) => [r.id, r]));
    const rankMap = new Map(ranked.map((r) => [r.id, Number(r.rank)]));

    const items = pageIds
      .map((id) => {
        const row = rowMap.get(id);
        if (!row) return null;
        const result = rowToResult(row);
        result.score = rankMap.get(id) ?? 0;
        return result;
      })
      .filter((x): x is LibraryDocResult => !!x);

    return { items, total };
  }
}

function rowToResult(r: DocRow): LibraryDocResult {
  return {
    id: r.id,
    uploaderId: r.uploader_id,
    uploaderName: r.uploader_name,
    title: r.title,
    description: r.description,
    subjectSlug: r.subject_slug,
    level: r.level,
    grade: r.grade,
    docType: r.doc_type,
    examType: r.exam_type,
    schoolYear: r.school_year,
    language: r.language,
    tags: r.tags ?? [],
    fileFormat: r.file_format,
    pageCount: r.page_count,
    previewThumbUrl: r.preview_thumb_url,
    aiSummary: r.ai_summary,
    ratingAvg: r.rating_avg ? Number(r.rating_avg) : null,
    ratingCount: r.rating_count,
    viewCount: r.view_count,
    downloadCount: r.download_count,
    workspaceImportCount: r.workspace_import_count,
    qualityScore: r.quality_score ? Number(r.quality_score) : null,
    badges: r.badges ?? [],
    difficulty: r.difficulty ?? null,
    isPremium: r.is_premium ?? false,
    priceVnd: r.price_vnd ?? null,
    courseNameCache: r.course_name_cache ?? null,
    createdAt: r.created_at,
    score: 0,
    ftsRank: null,
    vecRank: null,
  };
}

// ─── Sort modes (expression copy nguyên Drizzle cũ) ──────────────────
function buildOrderBy(sort: 'top' | 'rating' | 'popular' | 'newest'): Prisma.Sql {
  switch (sort) {
    case 'rating':
      return Prisma.sql`COALESCE(tp.rating_avg, 0) DESC, tp.rating_count DESC`;
    case 'popular':
      return Prisma.sql`tp.workspace_import_count * 3 + tp.download_count DESC, tp.created_at DESC`;
    case 'newest':
      return Prisma.sql`tp.created_at DESC`;
    case 'top':
    default:
      // Weighted: quality + rating + import + recency boost
      return Prisma.sql`COALESCE(tp.quality_score, 0) * 100
        + COALESCE(tp.rating_avg, 0) * 10
        + LEAST(tp.workspace_import_count, 100)
        + LEAST(tp.download_count / 10, 50) DESC`;
  }
}

// ─── tsquery helper (strip Unicode punctuation) ──────────────────────
function toTsQuery(text: string, op: '&' | '|' = '&'): string {
  const cleaned = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (cleaned.length === 0) return '';
  return cleaned.map((w) => `${w}:*`).join(` ${op} `);
}

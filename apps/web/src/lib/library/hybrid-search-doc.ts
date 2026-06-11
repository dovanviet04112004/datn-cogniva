import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';

import { db, libraryDoc, user as userTable } from '@cogniva/db';
import { expandSubjectSlug } from '@cogniva/db/taxonomy';

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

export async function hybridSearchLibraryDocs(
  input: LibrarySearchInput,
): Promise<{ items: LibraryDocResult[]; total: number }> {
  const limit = input.limit ?? 24;
  const offset = input.offset ?? 0;
  const query = input.query?.trim();
  const filters = input.filters ?? {};
  const sort = input.sort ?? 'top';

  const conds = [eq(libraryDoc.status, 'PUBLISHED')];

  let expandedSlugs: string[] | null = null;
  if (filters.subjectSlug) {
    expandedSlugs = expandSubjectSlug(filters.subjectSlug);
    if (expandedSlugs.length > 0) {
      conds.push(inArray(libraryDoc.subjectSlug, expandedSlugs));
    }
  }
  if (filters.level) conds.push(eq(libraryDoc.level, filters.level));
  if (filters.grade && filters.grade.length > 0) {
    conds.push(inArray(libraryDoc.grade, filters.grade));
  }
  if (filters.docType && filters.docType.length > 0) {
    conds.push(inArray(libraryDoc.docType, filters.docType));
  }
  if (filters.examType) conds.push(eq(libraryDoc.examType, filters.examType));
  if (filters.schoolYear) conds.push(eq(libraryDoc.schoolYear, filters.schoolYear));
  if (filters.region) conds.push(eq(libraryDoc.region, filters.region));
  if (filters.language) conds.push(eq(libraryDoc.language, filters.language));
  if (filters.fileFormat && filters.fileFormat.length > 0) {
    conds.push(inArray(libraryDoc.fileFormat, filters.fileFormat));
  }
  if (filters.minPages != null) {
    conds.push(gte(libraryDoc.pageCount, filters.minPages));
  }
  if (filters.maxPages != null) {
    conds.push(lte(libraryDoc.pageCount, filters.maxPages));
  }
  if (filters.minRating != null) {
    conds.push(gte(libraryDoc.ratingAvg, String(filters.minRating)));
  }
  if (filters.tags && filters.tags.length > 0) {
    conds.push(
      sql`${libraryDoc.tags} && ${`{${filters.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`}::text[]`,
    );
  }
  if (filters.difficulty && filters.difficulty.length > 0) {
    conds.push(inArray(libraryDoc.difficulty, filters.difficulty));
  }
  if (filters.universityId) {
    conds.push(eq(libraryDoc.universityId, filters.universityId));
  }
  if (filters.courseId) {
    conds.push(eq(libraryDoc.courseId, filters.courseId));
  }

  if (!query) {
    const orderBy = buildOrderBy(sort);
    const [rows, total] = await Promise.all([
      db
        .select(buildSelect())
        .from(libraryDoc)
        .leftJoin(userTable, eq(userTable.id, libraryDoc.uploaderId))
        .where(and(...conds))
        .orderBy(...orderBy)
        .limit(limit)
        .offset(offset),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(libraryDoc)
        .where(and(...conds))
        .then((r) => r[0]?.n ?? 0),
    ]);
    return { items: rows.map(rowToResult), total };
  }

  const tsq = toTsQuery(query, input.matchMode === 'or' ? '|' : '&');
  if (!tsq) return { items: [], total: 0 };

  const subjectArr = expandedSlugs
    ? `{${expandedSlugs.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`
    : null;
  const subjectSqlF = subjectArr ? sql`AND tp.subject_slug = ANY(${subjectArr}::text[])` : sql``;
  const levelSqlF = filters.level ? sql`AND tp.level = ${filters.level}` : sql``;
  const langSqlF = filters.language ? sql`AND tp.language = ${filters.language}` : sql``;
  const gradeArr =
    filters.grade && filters.grade.length > 0 ? `{${filters.grade.join(',')}}` : null;
  const gradeSqlF = gradeArr ? sql`AND tp.grade = ANY(${gradeArr}::int[])` : sql``;
  const typeArr =
    filters.docType && filters.docType.length > 0
      ? `{${filters.docType.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',')}}`
      : null;
  const typeSqlF = typeArr ? sql`AND tp.doc_type = ANY(${typeArr}::text[])` : sql``;
  const universitySqlF = filters.universityId
    ? sql`AND tp.university_id = ${filters.universityId}`
    : sql``;
  const courseSqlF = filters.courseId ? sql`AND tp.course_id = ${filters.courseId}` : sql``;

  const filterSql = sql`tp.status = 'PUBLISHED'
    ${subjectSqlF}
    ${levelSqlF}
    ${gradeSqlF}
    ${typeSqlF}
    ${langSqlF}
    ${universitySqlF}
    ${courseSqlF}`;

  const ranked = await db.execute<{ id: string; rank: number }>(sql`
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
  const fullRows = await db
    .select(buildSelect())
    .from(libraryDoc)
    .leftJoin(userTable, eq(userTable.id, libraryDoc.uploaderId))
    .where(inArray(libraryDoc.id, pageIds));

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

function buildSelect() {
  return {
    id: libraryDoc.id,
    uploaderId: libraryDoc.uploaderId,
    uploaderName: userTable.name,
    title: libraryDoc.title,
    description: libraryDoc.description,
    subjectSlug: libraryDoc.subjectSlug,
    level: libraryDoc.level,
    grade: libraryDoc.grade,
    docType: libraryDoc.docType,
    examType: libraryDoc.examType,
    schoolYear: libraryDoc.schoolYear,
    language: libraryDoc.language,
    tags: libraryDoc.tags,
    fileFormat: libraryDoc.fileFormat,
    pageCount: libraryDoc.pageCount,
    previewThumbUrl: libraryDoc.previewThumbUrl,
    aiSummary: libraryDoc.aiSummary,
    ratingAvg: libraryDoc.ratingAvg,
    ratingCount: libraryDoc.ratingCount,
    viewCount: libraryDoc.viewCount,
    downloadCount: libraryDoc.downloadCount,
    workspaceImportCount: libraryDoc.workspaceImportCount,
    qualityScore: libraryDoc.qualityScore,
    badges: libraryDoc.badges,
    difficulty: libraryDoc.difficulty,
    isPremium: libraryDoc.isPremium,
    priceVnd: libraryDoc.priceVnd,
    courseNameCache: libraryDoc.courseNameCache,
    createdAt: libraryDoc.createdAt,
  };
}

type SelectRow =
  Awaited<ReturnType<typeof buildSelect>> extends infer T
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any
    : never;

function rowToResult(r: SelectRow): LibraryDocResult {
  return {
    id: r.id,
    uploaderId: r.uploaderId,
    uploaderName: r.uploaderName,
    title: r.title,
    description: r.description,
    subjectSlug: r.subjectSlug,
    level: r.level,
    grade: r.grade,
    docType: r.docType,
    examType: r.examType,
    schoolYear: r.schoolYear,
    language: r.language,
    tags: r.tags ?? [],
    fileFormat: r.fileFormat,
    pageCount: r.pageCount,
    previewThumbUrl: r.previewThumbUrl,
    aiSummary: r.aiSummary,
    ratingAvg: r.ratingAvg ? Number(r.ratingAvg) : null,
    ratingCount: r.ratingCount,
    viewCount: r.viewCount,
    downloadCount: r.downloadCount,
    workspaceImportCount: r.workspaceImportCount,
    qualityScore: r.qualityScore ? Number(r.qualityScore) : null,
    badges: r.badges ?? [],
    difficulty: r.difficulty ?? null,
    isPremium: r.isPremium ?? false,
    priceVnd: r.priceVnd ?? null,
    courseNameCache: r.courseNameCache ?? null,
    createdAt: r.createdAt,
    score: 0,
    ftsRank: null,
    vecRank: null,
  };
}

function buildOrderBy(sort: 'top' | 'rating' | 'popular' | 'newest') {
  switch (sort) {
    case 'rating':
      return [desc(sql`COALESCE(${libraryDoc.ratingAvg}, 0)`), desc(libraryDoc.ratingCount)];
    case 'popular':
      return [
        desc(sql`${libraryDoc.workspaceImportCount} * 3 + ${libraryDoc.downloadCount}`),
        desc(libraryDoc.createdAt),
      ];
    case 'newest':
      return [desc(libraryDoc.createdAt)];
    case 'top':
    default:
      return [
        desc(
          sql`COALESCE(${libraryDoc.qualityScore}, 0) * 100
            + COALESCE(${libraryDoc.ratingAvg}, 0) * 10
            + LEAST(${libraryDoc.workspaceImportCount}, 100)
            + LEAST(${libraryDoc.downloadCount} / 10, 50)`,
        ),
      ];
  }
}

function toTsQuery(text: string, op: '&' | '|' = '&'): string {
  const cleaned = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (cleaned.length === 0) return '';
  return cleaned.map((w) => `${w}:*`).join(` ${op} `);
}

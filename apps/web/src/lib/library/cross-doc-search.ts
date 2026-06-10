/**
 * cross-doc-search — V1 Pillar #2 (2026-05-22).
 *
 * Search SEMANTIC across mọi chunk của mọi doc trong library.
 * User gõ "định lý Vi-et" → trả về chunks (doc + page + đoạn highlight)
 * thay vì doc title-only.
 *
 * Khác hybridSearchLibraryDocs: granularity = chunk (page-level paragraph),
 * không phải doc. Hiển thị deep-link tới trang chứa đoạn.
 *
 * Spec: docs/plans/library-share.md §Cross-Doc Semantic Search.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  db,
  libraryDoc,
  libraryDocChunk,
  user as userTable,
} from '@cogniva/db';
import { expandSubjectSlug } from '@cogniva/db/taxonomy';

import { embedQuery } from '@/lib/ingest/embed-query';

const RRF_K = 60;
const CANDIDATE_LIMIT = 30;

export type CrossDocSearchInput = {
  query: string;
  filters?: {
    subjectSlug?: string;
    level?: string;
    grade?: number[];
    docType?: string[];
    language?: string;
  };
  limit?: number;
};

export type CrossDocChunkHit = {
  chunkId: string;
  docId: string;
  docTitle: string;
  docSubject: string;
  docLevel: string;
  uploaderName: string | null;
  pageNum: number;
  content: string;
  /** Excerpt highlighted với <mark> wrap quanh query terms — UI render direct. */
  excerptHtml: string;
  score: number;
  ftsRank: number | null;
  vecRank: number | null;
};

/**
 * Search chunks across all docs với hybrid RRF.
 *
 * @returns Top N chunk hits + doc metadata để render card linking thẳng tới trang
 */
export async function crossDocSearch(
  input: CrossDocSearchInput,
): Promise<CrossDocChunkHit[]> {
  const limit = input.limit ?? 20;
  const query = input.query.trim();
  const filters = input.filters ?? {};

  if (!query) return [];

  const queryEmbedding = await embedQuery(query);
  const embStr = `[${queryEmbedding.join(',')}]`;
  const tsq = toTsQuery(query);

  // Filter doc-level (chunk-level filter would explode SQL — apply on parent doc)
  const expandedSlugs = filters.subjectSlug
    ? expandSubjectSlug(filters.subjectSlug)
    : null;
  const subjectArr = expandedSlugs
    ? `{${expandedSlugs.map((s) => `"${s}"`).join(',')}}`
    : null;
  const subjectSqlF = subjectArr
    ? sql`AND tp.subject_slug = ANY(${subjectArr}::text[])`
    : sql``;
  const levelSqlF = filters.level
    ? sql`AND tp.level = ${filters.level}`
    : sql``;
  const langSqlF = filters.language
    ? sql`AND tp.language = ${filters.language}`
    : sql``;
  const gradeArr =
    filters.grade && filters.grade.length > 0
      ? `{${filters.grade.join(',')}}`
      : null;
  const gradeSqlF = gradeArr
    ? sql`AND tp.grade = ANY(${gradeArr}::int[])`
    : sql``;

  const docFilterSql = sql`tp.status = 'PUBLISHED'
    ${subjectSqlF}
    ${levelSqlF}
    ${gradeSqlF}
    ${langSqlF}`;

  // Hybrid: FTS chunk + Vector chunk → RRF
  const rawResults = await db.execute<{
    chunk_id: string;
    score: number;
    fts_rank: number | null;
    vec_rank: number | null;
  }>(sql`
    WITH
    fts_ranks AS (
      SELECT c.id AS chunk_id,
             ROW_NUMBER() OVER (
               ORDER BY ts_rank(c.search_vec, to_tsquery('simple', ${tsq})) DESC
             ) AS rnk
      FROM library_doc_chunk c
      JOIN library_doc tp ON tp.id = c.doc_id
      WHERE ${docFilterSql}
        AND ${tsq}::text <> ''
        AND c.search_vec @@ to_tsquery('simple', ${tsq})
      LIMIT ${CANDIDATE_LIMIT}
    ),
    vec_ranks AS (
      SELECT c.id AS chunk_id,
             ROW_NUMBER() OVER (
               ORDER BY c.content_vec <=> ${embStr}::vector
             ) AS rnk
      FROM library_doc_chunk c
      JOIN library_doc tp ON tp.id = c.doc_id
      WHERE ${docFilterSql}
        AND c.content_vec IS NOT NULL
      LIMIT ${CANDIDATE_LIMIT}
    )
    SELECT
      COALESCE(f.chunk_id, v.chunk_id) AS chunk_id,
      1.0 / (${RRF_K} + COALESCE(f.rnk, 1000))
        + 1.0 / (${RRF_K} + COALESCE(v.rnk, 1000)) AS score,
      f.rnk::int AS fts_rank,
      v.rnk::int AS vec_rank
    FROM fts_ranks f
    FULL OUTER JOIN vec_ranks v ON f.chunk_id = v.chunk_id
    ORDER BY score DESC
    LIMIT ${limit}
  `);

  if (rawResults.length === 0) return [];

  // Fetch chunk + doc data
  const chunkIds = rawResults.map((r) => r.chunk_id);
  const rows = await db
    .select({
      chunkId: libraryDocChunk.id,
      docId: libraryDocChunk.docId,
      pageNum: libraryDocChunk.pageNum,
      content: libraryDocChunk.content,
      docTitle: libraryDoc.title,
      docSubject: libraryDoc.subjectSlug,
      docLevel: libraryDoc.level,
      uploaderName: userTable.name,
    })
    .from(libraryDocChunk)
    .innerJoin(libraryDoc, eq(libraryDoc.id, libraryDocChunk.docId))
    .leftJoin(userTable, eq(userTable.id, libraryDoc.uploaderId))
    .where(inArray(libraryDocChunk.id, chunkIds));

  const rowMap = new Map(rows.map((r) => [r.chunkId, r]));
  const scoreMap = new Map(rawResults.map((r) => [r.chunk_id, r]));

  return chunkIds
    .map((id) => {
      const row = rowMap.get(id);
      const raw = scoreMap.get(id);
      if (!row || !raw) return null;
      return {
        chunkId: row.chunkId,
        docId: row.docId,
        docTitle: row.docTitle,
        docSubject: row.docSubject,
        docLevel: row.docLevel,
        uploaderName: row.uploaderName,
        pageNum: row.pageNum,
        content: row.content,
        excerptHtml: highlightExcerpt(row.content, query),
        score: Number(raw.score),
        ftsRank: raw.fts_rank,
        vecRank: raw.vec_rank,
      };
    })
    .filter((x): x is CrossDocChunkHit => !!x);
}

/**
 * Highlight query terms trong content excerpt với <mark>.
 * Trả về HTML safe (escape rồi mới wrap mark) — UI render với
 * `dangerouslySetInnerHTML` được vì server-controlled output.
 */
function highlightExcerpt(content: string, query: string): string {
  const terms = query
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  // Escape HTML special chars first
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Wrap each term with <mark> (case-insensitive)
  let result = escaped;
  for (const term of terms) {
    const escTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(${escTerm})`, 'gi'), '<mark>$1</mark>');
  }

  // Trim to ~300 chars around first mark, if content longer
  const firstMark = result.indexOf('<mark>');
  if (result.length > 300 && firstMark > 100) {
    const start = Math.max(0, firstMark - 80);
    const end = Math.min(result.length, firstMark + 220);
    result = (start > 0 ? '…' : '') + result.slice(start, end) + (end < result.length ? '…' : '');
  } else if (result.length > 300) {
    result = result.slice(0, 300) + '…';
  }
  return result;
}

function toTsQuery(text: string): string {
  const cleaned = text
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (cleaned.length === 0) return '';
  return cleaned.map((w) => `${w}:*`).join(' & ');
}

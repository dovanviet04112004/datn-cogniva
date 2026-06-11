import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { EmbeddingService } from '../../../infra/ai/embedding.service';
import { PrismaService } from '../../../infra/database/prisma.service';
import { expandSubjectSlug } from '../../../common/subject-taxonomy';

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
  excerptHtml: string;
  score: number;
  ftsRank: number | null;
  vecRank: number | null;
};

@Injectable()
export class CrossDocSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async crossDocSearch(input: CrossDocSearchInput): Promise<CrossDocChunkHit[]> {
    const limit = input.limit ?? 20;
    const query = input.query.trim();
    const filters = input.filters ?? {};

    if (!query) return [];

    const queryEmbedding = await this.embedding.embedQuery(query);
    const embStr = `[${queryEmbedding.join(',')}]`;
    const tsq = toTsQuery(query);

    const expandedSlugs = filters.subjectSlug ? expandSubjectSlug(filters.subjectSlug) : null;
    const subjectArr = expandedSlugs ? `{${expandedSlugs.map((s) => `"${s}"`).join(',')}}` : null;
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

    const docFilterSql = Prisma.sql`tp.status = 'PUBLISHED'
      ${subjectSqlF}
      ${levelSqlF}
      ${gradeSqlF}
      ${langSqlF}`;

    const rawResults = await this.prisma.$queryRaw<
      Array<{ chunk_id: string; score: unknown; fts_rank: number | null; vec_rank: number | null }>
    >(Prisma.sql`
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

    const chunkIds = rawResults.map((r) => r.chunk_id);
    const rows = await this.prisma.library_doc_chunk.findMany({
      where: { id: { in: chunkIds } },
      select: {
        id: true,
        doc_id: true,
        page_num: true,
        content: true,
        library_doc: {
          select: {
            title: true,
            subject_slug: true,
            level: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    const rowMap = new Map(rows.map((r) => [r.id, r]));
    const scoreMap = new Map(rawResults.map((r) => [r.chunk_id, r]));

    return chunkIds
      .map((id) => {
        const row = rowMap.get(id);
        const raw = scoreMap.get(id);
        if (!row || !raw) return null;
        return {
          chunkId: row.id,
          docId: row.doc_id,
          docTitle: row.library_doc.title,
          docSubject: row.library_doc.subject_slug,
          docLevel: row.library_doc.level,
          uploaderName: row.library_doc.user.name,
          pageNum: row.page_num,
          content: row.content,
          excerptHtml: highlightExcerpt(row.content, query),
          score: Number(raw.score),
          ftsRank: raw.fts_rank,
          vecRank: raw.vec_rank,
        };
      })
      .filter((x): x is CrossDocChunkHit => !!x);
  }
}

function highlightExcerpt(content: string, query: string): string {
  const terms = query
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let result = escaped;
  for (const term of terms) {
    const escTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(${escTerm})`, 'gi'), '<mark>$1</mark>');
  }

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

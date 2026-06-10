/**
 * SearchService — global text search + chunk preview. Port từ
 * apps/web/src/app/api/{search,chunks/[id]} — GIỮ NGUYÊN wire shape.
 *
 * Search dùng $queryRaw ILIKE %q% (copy nguyên semantics Drizzle cũ, kể cả
 * wildcard `%`/`_` trong q) thay vì Prisma `contains` (Prisma escape ký tự
 * đặc biệt → kết quả có thể lệch). Route cũ đọc qua dbReplica; API hiện chỉ
 * có 1 PrismaClient (primary) — chấp nhận trong giai đoạn strangler-fig.
 */
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infra/database/prisma.service';

/**
 * Contract SearchResult — NGUỒN CHUẨN ở packages/shared/src/types (client
 * dùng). Copy tay ở đây vì shared là ESM-source, api (CJS node16) import sẽ
 * kéo cả source TS của shared vào program → vỡ build. Đổi contract thì sửa
 * CẢ HAI chỗ.
 */
export type SearchResult = {
  type: 'document' | 'concept' | 'flashcard' | 'quiz' | 'note';
  id: string;
  label: string;
  sublabel?: string;
  href: string;
};

/** Row trả về từ các query ILIKE (alias label/sublabel đặt ngay trong SQL). */
type IlikeRow = { id: string; label: string; sublabel?: string };

/** Row prev/next chunk — chunk_index đã cast ::int trong SQL. */
type NeighborRow = { id: string; chunk_index: number; metadata: unknown };

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /search — 5 query ILIKE song song scope theo user.
   * q rỗng → [] (route cũ short-circuit trước khi chạm DB).
   */
  async globalSearch(userId: string, q: string, limit: number): Promise<SearchResult[]> {
    if (!q) return [];
    const pattern = `%${q}%`;

    const [docs, concepts, cards, quizzes, notes] = await Promise.all([
      this.prisma.$queryRaw<IlikeRow[]>(Prisma.sql`
        SELECT id, filename AS label
        FROM document
        WHERE user_id = ${userId} AND filename ILIKE ${pattern}
        LIMIT ${limit}`),

      // Concept không có user_id trực tiếp → scope qua chunk_concept → chunk → document.
      this.prisma.$queryRaw<IlikeRow[]>(Prisma.sql`
        SELECT DISTINCT c.id, c.name AS label, c.domain AS sublabel
        FROM concept c
        INNER JOIN chunk_concept cc ON cc.concept_id = c.id
        INNER JOIN chunk ch ON ch.id = cc.chunk_id
        INNER JOIN document d ON d.id = ch.document_id
        WHERE d.user_id = ${userId} AND c.name ILIKE ${pattern}
        LIMIT ${limit}`),

      this.prisma.$queryRaw<IlikeRow[]>(Prisma.sql`
        SELECT id, front AS label, card_type::text AS sublabel
        FROM flashcard
        WHERE user_id = ${userId} AND (front ILIKE ${pattern} OR back ILIKE ${pattern})
        LIMIT ${limit}`),

      this.prisma.$queryRaw<IlikeRow[]>(Prisma.sql`
        SELECT id, title AS label
        FROM quiz
        WHERE user_id = ${userId} AND title ILIKE ${pattern}
        LIMIT ${limit}`),

      this.prisma.$queryRaw<IlikeRow[]>(Prisma.sql`
        SELECT id, title AS label
        FROM note
        WHERE user_id = ${userId} AND title ILIKE ${pattern}
        LIMIT ${limit}`),
    ]);

    return [
      ...docs.map((d) => ({
        type: 'document' as const,
        id: d.id,
        label: d.label,
        href: `/documents`,
      })),
      ...concepts.map((c) => ({
        type: 'concept' as const,
        id: c.id,
        label: c.label,
        sublabel: c.sublabel,
        href: `/graph#${c.id}`,
      })),
      ...cards.map((f) => ({
        type: 'flashcard' as const,
        id: f.id,
        label: f.label,
        sublabel: f.sublabel,
        href: `/flashcards`,
      })),
      ...quizzes.map((q2) => ({
        type: 'quiz' as const,
        id: q2.id,
        label: q2.label,
        href: `/quiz/${q2.id}/attempt`,
      })),
      ...notes.map((n) => ({
        type: 'note' as const,
        id: n.id,
        label: n.label || 'Untitled',
        href: `/notes/${n.id}`,
      })),
    ];
  }

  /**
   * GET /chunks/:id — full chunk content + document meta + prev/next cùng
   * document (theo metadata->>'chunkIndex'). Scope owner qua document.user_id.
   */
  async getChunk(userId: string, id: string) {
    const row = await this.prisma.chunk.findUnique({
      where: { id },
      select: {
        id: true,
        content: true,
        metadata: true,
        document: {
          select: {
            id: true,
            filename: true,
            workspace_id: true,
            user_id: true,
            workspace: { select: { name: true } },
          },
        },
      },
    });

    if (!row) throw new NotFoundException({ error: 'Not found' });
    if (row.document.user_id !== userId) throw new ForbiddenException({ error: 'Forbidden' });

    // chunkIndex + page nằm trong metadata jsonb (không có cột riêng).
    const meta = (row.metadata ?? {}) as { chunkIndex?: number; page?: number };
    const chunkIndex = typeof meta.chunkIndex === 'number' ? meta.chunkIndex : null;
    const page = typeof meta.page === 'number' ? meta.page : null;

    let prev: { id: string; chunkIndex: number; page: number | null } | null = null;
    let next: { id: string; chunkIndex: number; page: number | null } | null = null;
    if (chunkIndex !== null) {
      // Copy nguyên expression Drizzle cũ: (metadata->>'chunkIndex')::int —
      // chunk thiếu chunkIndex tự rớt khỏi so sánh (NULL) y như cũ.
      const [prevRows, nextRows] = await Promise.all([
        this.prisma.$queryRaw<NeighborRow[]>(Prisma.sql`
          SELECT id, (metadata->>'chunkIndex')::int AS chunk_index, metadata
          FROM chunk
          WHERE document_id = ${row.document.id}
            AND (metadata->>'chunkIndex')::int < ${chunkIndex}
          ORDER BY (metadata->>'chunkIndex')::int DESC
          LIMIT 1`),
        this.prisma.$queryRaw<NeighborRow[]>(Prisma.sql`
          SELECT id, (metadata->>'chunkIndex')::int AS chunk_index, metadata
          FROM chunk
          WHERE document_id = ${row.document.id}
            AND (metadata->>'chunkIndex')::int > ${chunkIndex}
          ORDER BY (metadata->>'chunkIndex')::int ASC
          LIMIT 1`),
      ]);
      prev = this.toNeighbor(prevRows[0]);
      next = this.toNeighbor(nextRows[0]);
    }

    return {
      chunk: { id: row.id, content: row.content, chunkIndex, page },
      document: {
        id: row.document.id,
        filename: row.document.filename,
        workspaceId: row.document.workspace_id,
        workspaceName: row.document.workspace.name,
      },
      prev,
      next,
    };
  }

  private toNeighbor(r?: NeighborRow): { id: string; chunkIndex: number; page: number | null } | null {
    if (!r) return null;
    const m = (r.metadata ?? {}) as { page?: number };
    return { id: r.id, chunkIndex: r.chunk_index, page: typeof m.page === 'number' ? m.page : null };
  }
}

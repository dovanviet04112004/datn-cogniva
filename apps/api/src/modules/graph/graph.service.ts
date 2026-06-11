import { randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cached } from '@cogniva/server-core/cache/cache-aside';
import { ck } from '@cogniva/server-core/cache/keys';
import { onGraphChanged } from '@cogniva/server-core/cache/invalidate';

import { LlmService } from '../../infra/ai/llm.service';
import { PrismaService } from '../../infra/database/prisma.service';

export type GraphNode = {
  id: string;
  type: 'concept';
  data: {
    name: string;
    description: string | null;
    domain: string;
    mastery?: number;
  };
  position: { x: number; y: number };
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  data: { strength: number; relationType: string };
};

export type GraphPayload = { nodes: GraphNode[]; edges: GraphEdge[] };

type ConceptRow = { id: string; name: string; description: string | null; domain: string };

type MinedEdge = { from: string; to: string; strength: number };

const PREREQ_INSTRUCTION = `Bạn là chuyên gia thiết kế đường học. Cho danh sách KHÁI NIỆM dưới đây (cùng domain), liệt kê CÀNG NHIỀU cặp prerequisite/dependency CÀNG TỐT để dựng đồ thị kiến thức.

Cặp (from, to) nghĩa: "muốn hiểu \`to\` thì cần biết \`from\` trước", hoặc "to xây dựng dựa trên from".

QUY TẮC:
- Bao gồm cả prerequisite trực tiếp (Lamport's clock → Vector clocks) lẫn nền tảng cơ bản (happens-before → Lamport's clock).
- Khi 2 khái niệm là biến thể/cải tiến của nhau, vẫn list edge từ "khái niệm cơ bản" → "khái niệm mở rộng".
- Mỗi cặp dùng id từ danh sách (KHÔNG dùng tên).
- Bỏ qua cặp ngược (B prereq A khi A đã prereq B).
- Strength ∈ [0,1]: 1.0 = bắt buộc tuyệt đối, 0.7 = mạnh, 0.5 = nên biết, 0.3 = giúp hiểu sâu hơn.
- Nếu hoàn toàn không có cặp → trả mảng RỖNG; nhưng ưu tiên TÌM RA edges.

ĐỊNH DẠNG OUTPUT — JSON THUẦN:
{"edges": [{"from": "<id>", "to": "<id>", "strength": 0.8}]}

DANH SÁCH KHÁI NIỆM (id | name | description):
{{LIST}}`;

const MAX_GROUP_SIZE = 10;

function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in LLM output');
  return JSON.parse(match[0]);
}

@Injectable()
export class GraphService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async getGraphForUser(userId: string, workspaceId?: string | null): Promise<GraphPayload> {
    return cached(ck.graph(userId, workspaceId ?? 'all'), 3600, () =>
      this.fetchGraph(userId, workspaceId ?? null),
    );
  }

  private async fetchGraph(userId: string, workspaceId: string | null): Promise<GraphPayload> {
    const concepts = await this.prisma.$queryRaw<ConceptRow[]>(
      workspaceId
        ? Prisma.sql`
            SELECT DISTINCT c.id, c.name, c.description, c.domain
            FROM concept c
            INNER JOIN chunk_concept cc ON cc.concept_id = c.id
            INNER JOIN chunk ch ON ch.id = cc.chunk_id
            INNER JOIN document d ON d.id = ch.document_id
            WHERE d.user_id = ${userId}
              AND d.workspace_id = ${workspaceId};
          `
        : Prisma.sql`
            SELECT DISTINCT c.id, c.name, c.description, c.domain
            FROM concept c
            INNER JOIN chunk_concept cc ON cc.concept_id = c.id
            INNER JOIN chunk ch ON ch.id = cc.chunk_id
            INNER JOIN document d ON d.id = ch.document_id
            WHERE d.user_id = ${userId};
          `,
    );

    const conceptIds = concepts.map((c) => c.id);

    const idsArrayLiteral = `{${conceptIds.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',')}}`;
    const relations = conceptIds.length
      ? await this.prisma.$queryRaw<
          { from_id: string; to_id: string; relation_type: string; strength: number }[]
        >(Prisma.sql`
          SELECT from_id, to_id, relation_type, strength
          FROM concept_relation
          WHERE from_id = ANY(${idsArrayLiteral}::text[])
            AND to_id = ANY(${idsArrayLiteral}::text[]);
        `)
      : [];

    const masteryRows = conceptIds.length
      ? await this.prisma.mastery.findMany({
          where: { user_id: userId, concept_id: { in: conceptIds } },
          select: { concept_id: true, score: true },
        })
      : [];
    const masteryMap = new Map(masteryRows.map((m) => [m.concept_id, m.score]));

    const nodes: GraphNode[] = concepts.map((c) => ({
      id: c.id,
      type: 'concept',
      data: {
        name: c.name,
        description: c.description,
        domain: c.domain,
        mastery: masteryMap.get(c.id),
      },
      position: { x: 0, y: 0 },
    }));

    const edges: GraphEdge[] = relations.map((r, i) => ({
      id: `${r.from_id}->${r.to_id}-${i}`,
      source: r.from_id,
      target: r.to_id,
      label: r.relation_type,
      data: { strength: Number(r.strength), relationType: r.relation_type },
    }));

    return { nodes, edges };
  }

  async getConceptDetail(userId: string, id: string) {
    const conceptRow = await this.prisma.concept.findUnique({
      where: { id },
      select: { id: true, name: true, description: true, domain: true },
    });
    if (!conceptRow) throw new NotFoundException({ error: 'Not found' });

    const chunks = await this.prisma.$queryRaw<
      {
        id: string;
        content: string;
        document_id: string;
        filename: string;
        page: number | null;
        strength: number;
      }[]
    >(Prisma.sql`
      SELECT
        c.id,
        c.content,
        c.document_id,
        d.filename,
        (c.metadata->>'page')::int AS page,
        cc.strength
      FROM chunk_concept cc
      INNER JOIN chunk c ON c.id = cc.chunk_id
      INNER JOIN document d ON d.id = c.document_id
      WHERE cc.concept_id = ${id}
        AND d.user_id = ${userId}
      ORDER BY cc.strength DESC, c.id
      LIMIT 10;
    `);

    return {
      concept: {
        id: conceptRow.id,
        name: conceptRow.name,
        description: conceptRow.description,
        domain: conceptRow.domain,
      },
      chunks: chunks.map((c) => ({
        id: c.id,
        snippet: c.content.length > 220 ? c.content.slice(0, 220) + '…' : c.content,
        documentId: c.document_id,
        filename: c.filename,
        page: c.page,
        strength: Number(c.strength),
      })),
    };
  }

  async minePrerequisitesForUser(
    userId: string,
  ): Promise<{ inserted: number; totalConcepts: number }> {
    try {
      const concepts = await this.listConceptsForUser(userId);
      if (concepts.length < 2) {
        throw new BadRequestException({
          error: 'Cần ≥ 2 concepts mới mine được — upload thêm tài liệu trước.',
        });
      }

      const inserted = await this.minePrerequisites(concepts);
      if (inserted > 0) await onGraphChanged(userId);
      return { inserted, totalConcepts: concepts.length };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      console.error('[graph-mine]', err);
      throw new BadGatewayException({ error: `Mine lỗi: ${(err as Error).message}` });
    }
  }

  private async listConceptsForUser(userId: string): Promise<ConceptRow[]> {
    return this.prisma.$queryRaw<ConceptRow[]>(Prisma.sql`
      SELECT DISTINCT c.id, c.name, c.description, c.domain
      FROM concept c
      INNER JOIN chunk_concept cc ON cc.concept_id = c.id
      INNER JOIN chunk ch ON ch.id = cc.chunk_id
      INNER JOIN document d ON d.id = ch.document_id
      WHERE d.user_id = ${userId};
    `);
  }

  private async minePrerequisites(concepts: ConceptRow[]): Promise<number> {
    const byDomain = new Map<string, ConceptRow[]>();
    for (const c of concepts) {
      const arr = byDomain.get(c.domain) ?? [];
      arr.push(c);
      byDomain.set(c.domain, arr);
    }

    let totalInserted = 0;
    for (const [domain, group] of byDomain) {
      for (let i = 0; i < group.length; i += MAX_GROUP_SIZE) {
        const slice = group.slice(i, i + MAX_GROUP_SIZE);
        const edges = await this.mineGroup(slice);
        const inserted = await this.insertEdges(edges);
        totalInserted += inserted;
        console.log(
          `  [${domain}] batch ${i}-${i + slice.length}: ${edges.length} edges (${inserted} inserted)`,
        );
      }
    }

    return totalInserted;
  }

  private async mineGroup(concepts: ConceptRow[]): Promise<MinedEdge[]> {
    if (concepts.length < 2) return [];

    const list = concepts
      .map((c) => `${c.id} | ${c.name} | ${c.description ?? '(no description)'}`)
      .join('\n');

    try {
      const text = await this.llm.complete(PREREQ_INSTRUCTION.replace('{{LIST}}', list), {
        temperature: 0.2,
        maxTokens: 1000,
      });
      const obj = extractJson(text) as { edges?: unknown };
      if (!Array.isArray(obj.edges)) return [];

      const validIds = new Set(concepts.map((c) => c.id));
      return obj.edges
        .filter((e): e is MinedEdge => {
          const edge = e as MinedEdge;
          return (
            typeof edge?.from === 'string' &&
            typeof edge?.to === 'string' &&
            edge.from !== edge.to &&
            validIds.has(edge.from) &&
            validIds.has(edge.to)
          );
        })
        .map((e) => ({
          from: e.from,
          to: e.to,
          strength: Math.max(0, Math.min(1, Number(e.strength) || 0.5)),
        }));
    } catch (err) {
      console.warn('[prerequisite] mine group failed:', (err as Error).message);
      return [];
    }
  }

  private async insertEdges(edges: MinedEdge[]): Promise<number> {
    let inserted = 0;
    for (const edge of edges) {
      try {
        await this.prisma.$executeRaw(Prisma.sql`
          INSERT INTO concept_relation (id, from_id, to_id, relation_type, strength)
          VALUES (${randomUUID()}, ${edge.from}, ${edge.to}, 'prerequisite', ${edge.strength})
          ON CONFLICT DO NOTHING;
        `);
        inserted++;
      } catch (err) {
        console.warn('[prerequisite] insert edge failed:', (err as Error).message);
      }
    }
    return inserted;
  }
}

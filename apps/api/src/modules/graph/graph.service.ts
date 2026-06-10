/**
 * GraphService — knowledge graph: viz (GET /graph), mine prerequisite edges
 * (POST /graph/mine) và concept detail panel (GET /graph/concept/:id).
 *
 * Port từ apps/web: app/api/graph/* + lib/graph/get-graph.ts +
 * lib/concepts/{dedup,prerequisite}.ts — GIỮ NGUYÊN wire shape (camelCase),
 * cùng cache key ck.graph(u, ws) TTL 3600s + invalidator onGraphChanged nên
 * Next/Nest sống chung không lệch cache.
 *
 * Khác biệt cố ý so với web:
 *   - Web đọc graph qua dbReplica; API hiện chỉ có 1 PrismaClient (primary).
 *     Cache Redis Tier 1 vẫn là tầng giảm tải chính — replica routing để infra lo sau.
 *   - LLM call: copy/adapt từ apps/web/src/lib/ai/models.ts (getChatModel) — gọi
 *     REST OpenAI-compatible trực tiếp vì apps/api chưa có @ai-sdk provider deps
 *     (infra/ai là việc Wave 7). Đồng bộ tay khi models.ts đổi provider/default model.
 */
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

import { PrismaService } from '../../infra/database/prisma.service';

/** Node React Flow — { id, type, data, position } (position client tự layout). */
export type GraphNode = {
  id: string;
  type: 'concept';
  data: {
    name: string;
    description: string | null;
    domain: string;
    /** Mastery BKT score (0..1) — undefined nếu user chưa attempt concept đó. */
    mastery?: number;
  };
  position: { x: number; y: number };
};

/** Edge React Flow — quan hệ prerequisite giữa 2 concept. */
export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  data: { strength: number; relationType: string };
};

export type GraphPayload = { nodes: GraphNode[]; edges: GraphEdge[] };

/** Row concept tối thiểu cho viz + mining. */
type ConceptRow = { id: string; name: string; description: string | null; domain: string };

/** Cạnh prerequisite LLM trả về (id phải thuộc batch đang mine). */
type MinedEdge = { from: string; to: string; strength: number };

// ── Prompt mining — copy NGUYÊN VĂN từ lib/concepts/prerequisite.ts ──────────
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

/** Batch ≤ 10 concept/LLM call — group lớn hơn LLM dễ bỏ sót cặp. */
const MAX_GROUP_SIZE = 10;

/** Bóc JSON khỏi output LLM (lột code-fence nếu có). */
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
  constructor(private readonly prisma: PrismaService) {}

  // ════════════════════════════════════════════════════════════════════════
  // GET /graph — viz (cache-aside Redis TTL 1h, bust qua onDocumentChanged/
  // onGraphChanged/onMasteryChanged ở server-core)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Graph (nodes + edges) của user, có thể scope theo 1 workspace (V5 MindMap).
   * ws='all' khi không lọc — KHỚP key invalidator xoá (ck.graph(u,'all')).
   */
  async getGraphForUser(userId: string, workspaceId?: string | null): Promise<GraphPayload> {
    return cached(ck.graph(userId, workspaceId ?? 'all'), 3600, () =>
      this.fetchGraph(userId, workspaceId ?? null),
    );
  }

  /** Truy vấn thật dựng graph — chỉ chạy khi cache MISS. */
  private async fetchGraph(userId: string, workspaceId: string | null): Promise<GraphPayload> {
    // 1. Concepts của user — scope qua pivot chunk_concept → chunk → document
    // (concept không có cột user_id, entity dùng chung).
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

    // 2. Prerequisite edges — chỉ cạnh mà CẢ from & to đều trong tập concept
    // của user (tránh kéo cạnh trỏ ra ngoài scope). ANY(text[]) khớp query gốc.
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

    // 3. Mastery scores → tô màu node theo BKT (đỏ/vàng/xanh).
    const masteryRows = conceptIds.length
      ? await this.prisma.mastery.findMany({
          where: { user_id: userId, concept_id: { in: conceptIds } },
          select: { concept_id: true, score: true },
        })
      : [];
    const masteryMap = new Map(masteryRows.map((m) => [m.concept_id, m.score]));

    // 4. Format chuẩn React Flow — client (Dagre/ELK) tự layout position.
    const nodes: GraphNode[] = concepts.map((c) => ({
      id: c.id,
      type: 'concept',
      data: {
        name: c.name,
        description: c.description,
        domain: c.domain,
        mastery: masteryMap.get(c.id), // undefined nếu chưa attempt
      },
      position: { x: 0, y: 0 }, // 0,0 — client layout sẽ override
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

  // ════════════════════════════════════════════════════════════════════════
  // GET /graph/concept/:id — ConceptPanel (không cache, như route cũ)
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Chi tiết 1 concept + chunks liên quan. Chunks scope theo user (chống IDOR:
   * user A click concept không xem được chunks của user B).
   */
  async getConceptDetail(userId: string, id: string) {
    const conceptRow = await this.prisma.concept.findUnique({
      where: { id },
      select: { id: true, name: true, description: true, domain: true },
    });
    if (!conceptRow) throw new NotFoundException({ error: 'Not found' });

    // Chunks của user link tới concept này — limit 10 để panel gọn.
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
        // Truncate ~220 chars cho panel — full chunk có ở document viewer
        snippet: c.content.length > 220 ? c.content.slice(0, 220) + '…' : c.content,
        documentId: c.document_id,
        filename: c.filename,
        page: c.page,
        strength: Number(c.strength),
      })),
    };
  }

  // ════════════════════════════════════════════════════════════════════════
  // POST /graph/mine — LLM mining prerequisite edges
  // ════════════════════════════════════════════════════════════════════════

  /**
   * Mine prerequisite cho toàn bộ concepts của user. Idempotent qua
   * uniqueIndex concept_relation_uniq. Edges mới → bust ck.graph(u,'all')
   * qua onGraphChanged (mine không biết workspaceId).
   */
  async minePrerequisitesForUser(userId: string): Promise<{ inserted: number; totalConcepts: number }> {
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
      if (err instanceof HttpException) throw err; // 400 ở trên giữ nguyên status
      console.error('[graph-mine]', err);
      throw new BadGatewayException({ error: `Mine lỗi: ${(err as Error).message}` });
    }
  }

  /** Concept của 1 user (qua chunks → documents) — copy SQL từ lib/concepts/dedup.ts. */
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

  /**
   * Group concepts theo domain (prereq cross-domain hiếm) → mine + INSERT ngay
   * từng batch để edges persist dù chạy dở + user refresh /graph thấy progress.
   */
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

  /** Mine 1 nhóm concepts (≤ MAX_GROUP_SIZE) — lỗi LLM chỉ warn + bỏ batch như cũ. */
  private async mineGroup(concepts: ConceptRow[]): Promise<MinedEdge[]> {
    if (concepts.length < 2) return [];

    const list = concepts
      .map((c) => `${c.id} | ${c.name} | ${c.description ?? '(no description)'}`)
      .join('\n');

    try {
      const text = await this.generatePlainText(PREREQ_INSTRUCTION.replace('{{LIST}}', list));
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

  /**
   * INSERT edges với ON CONFLICT DO NOTHING. `inserted` đếm edge KHÔNG throw
   * (kể cả conflict bị skip) — giữ đúng semantics đếm của lib cũ.
   * id: route cũ Drizzle $defaultFn(createId) sinh client-side; ở đây dùng
   * randomUUID (id không lộ ra wire — edge viz dùng id tổng hợp from->to-i).
   */
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

  // ── LLM helper — thay getChatModel()+generateText (xem header file) ────────

  /**
   * Chọn provider theo env — CÙNG thứ tự ưu tiên getChatModel() web:
   * LLM_PROVIDER ép cứng → ANTHROPIC → GROQ → GOOGLE → OPENROUTER. Kiểm GIÁ TRỊ
   * env (key rỗng = không có) chứ không chỉ "có set".
   */
  private resolveChatEndpoint(): {
    url: string;
    apiKey: string;
    model: string;
    headers: Record<string, string>;
  } {
    const forced = process.env.LLM_PROVIDER;
    const has = (k: string) => !!process.env[k];
    const provider =
      forced && ['anthropic', 'groq', 'google', 'openrouter'].includes(forced)
        ? forced
        : has('ANTHROPIC_API_KEY')
          ? 'anthropic'
          : has('GROQ_API_KEY')
            ? 'groq'
            : has('GOOGLE_GENERATIVE_AI_API_KEY')
              ? 'google'
              : has('OPENROUTER_API_KEY')
                ? 'openrouter'
                : null;
    if (!provider) {
      throw new Error(
        '[ai] Không tìm thấy AI provider key — set 1 trong: ANTHROPIC_API_KEY / GROQ_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY / OPENROUTER_API_KEY',
      );
    }

    // Default model ids khớp getChatModel() web (models.ts) — đồng bộ tay khi đổi.
    switch (provider) {
      case 'anthropic':
        // Anthropic có OpenAI-compat layer tại /v1/chat/completions (Bearer key).
        return {
          url: 'https://api.anthropic.com/v1/chat/completions',
          apiKey: process.env.ANTHROPIC_API_KEY!,
          model: 'claude-sonnet-4-6',
          headers: {},
        };
      case 'groq':
        return {
          url: 'https://api.groq.com/openai/v1/chat/completions',
          apiKey: process.env.GROQ_API_KEY!,
          model: 'llama-3.3-70b-versatile',
          headers: {},
        };
      case 'google':
        return {
          url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
          apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY!,
          model: 'gemini-2.5-flash',
          headers: {},
        };
      default:
        return {
          url: 'https://openrouter.ai/api/v1/chat/completions',
          apiKey: process.env.OPENROUTER_API_KEY!,
          model: 'openai/gpt-oss-20b:free',
          // 2 header OpenRouter recommend cho usage analytics — như web.
          headers: {
            'HTTP-Referer': process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
            'X-Title': 'Cogniva',
          },
        };
    }
  }

  /** 1 completion thuần text — temperature 0.2 + max 1000 token như mineGroup cũ. */
  private async generatePlainText(prompt: string): Promise<string> {
    const { url, apiKey, model, headers } = this.resolveChatEndpoint();
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...headers },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: 1000,
      }),
    });
    if (!res.ok) {
      throw new Error(`[ai] ${res.status} ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('[ai] Response thiếu choices[0].message.content');
    return text;
  }
}

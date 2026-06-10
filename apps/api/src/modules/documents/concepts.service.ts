/**
 * ConceptsService — concept (atom) extraction + vector dedup + pivot link.
 * Port từ apps/web/src/lib/concepts/{index,extract,dedup}.ts — GIỮ NGUYÊN
 * prompt từng chữ, threshold dedup, advisory lock chống race tạo concept trùng.
 *
 * Khác bản web (ghi để golden-diff không bất ngờ):
 *   - LLM gọi qua LlmService (provider pick chung) thay vì routedGenerateText
 *     (semantic cache + cost guardrail của router web) — params temperature/
 *     maxTokens giữ y nguyên path không-ctx của lib cũ.
 *   - prerequisite.ts KHÔNG port lại ở đây: mining đã sống trong GraphModule
 *     (graph.service.ts) từ wave trước — tránh 2 bản copy.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { EmbeddingService } from '../../infra/ai/embedding.service';
import { LlmService } from '../../infra/ai/llm.service';
import { PrismaService } from '../../infra/database/prisma.service';

/** Ngưỡng cosine similarity coi 2 concept là "trùng" (plan §6.1.9). */
const DEDUP_THRESHOLD = 0.85;

/**
 * Atom-centric prompt (Phase A6) — copy NGUYÊN VĂN từ
 * apps/web/src/lib/concepts/extract.ts. Đổi prompt thì sửa cả 2 chỗ.
 */
const EXTRACT_INSTRUCTION = `Bạn là chuyên gia trích xuất ATOM kiến thức (đơn vị học tập tối thiểu) cho hệ thống học tập. Đọc đoạn văn dưới đây và liệt kê 1-5 ATOM CÓ TÊN mà đoạn này TRỰC TIẾP nói tới.

QUY TẮC:
- Chỉ lấy thuật ngữ chuyên ngành, tên định lý, tên thuật toán, tên người, tên hệ thống, tên công nghệ.
- BỎ QUA từ chung chung: "function", "system", "data", "method", "process" nếu chỉ dùng nghĩa thường.
- Nếu đoạn không có atom có tên → trả mảng RỖNG.
- domain chọn 1 trong: "math", "cs", "physics", "biology", "chemistry", "history", "language", "business", "general".
- difficulty: 0..1 (0 dễ phổ thông, 0.5 trung học, 0.8 chuyên ngành, 1 nghiên cứu).
- strength: 0..1 — đoạn văn nói về atom này MẠNH cỡ nào (1 = chủ đề CHÍNH của đoạn, 0.5 = nói khá rõ, 0.3 = chỉ nhắc thoáng qua).
- examples: 1-3 ví dụ NGẮN (mỗi cái <100 ký tự). Có thể rỗng nếu khái niệm trừu tượng.
- previewQuestion + previewAnswer: 1 câu hỏi ngắn + đáp án để hiển thị "atom này là gì". Câu hỏi tự nhiên, không "Định nghĩa X là gì".

ĐỊNH DẠNG OUTPUT — JSON THUẦN, KHÔNG markdown, KHÔNG backtick:
{"concepts": [{"name": "Tên ngắn", "description": "1 câu mô tả", "domain": "...", "difficulty": 0.5, "strength": 0.8, "examples": ["ex1", "ex2"], "previewQuestion": "...", "previewAnswer": "..."}]}

ĐOẠN VĂN:
"""
{{CONTENT}}
"""`;

export type ExtractedConcept = {
  name: string;
  description: string;
  domain: string;
  /** Phase A6: optional vì LLM có thể trả thiếu — forward-compat. */
  difficulty?: number;
  /** Độ liên quan của chunk này tới atom (0..1) → lưu chunk_concept.strength. */
  strength?: number;
  examples?: string[];
  previewQuestion?: string;
  previewAnswer?: string;
};

export type ExtractStats = {
  /** Số chunks đã quét. */
  chunksProcessed: number;
  /** Tổng concept extracted (kể cả trùng). */
  conceptsExtracted: number;
  /** Số concept_id unique đã link vào chunk_concept. */
  linksCreated: number;
  /** Số concept extract được nhưng dedup/insert lỗi (Voyage timeout, DB…). */
  failedConcepts: number;
};

/**
 * Parse pgvector text format `'[1,2,3]'` → number[]. Format JSON-like nên
 * JSON.parse work. NGUỒN CHUẨN ở apps/web/src/lib/retrieval/index.ts —
 * đổi thì sửa cả 2.
 */
export function parseVectorText(text: string): number[] {
  return JSON.parse(text) as number[];
}

/** Strip code fence + extract object JSON đầu tiên (phòng LLM trả thêm prose). */
function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object in LLM output');
  return JSON.parse(match[0]);
}

@Injectable()
export class ConceptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * Trích concept từ 1 chunk content. Trả mảng rỗng khi LLM lỗi/empty —
   * chunk đó skip silent thay vì crash batch (y lib cũ).
   */
  async extractConceptsFromChunk(content: string): Promise<ExtractedConcept[]> {
    // <30 ký tự thường là rác/số trang — skip (ngưỡng hạ 50→30 từ lib cũ).
    if (content.length < 30) return [];

    try {
      const text = await this.llm.complete(EXTRACT_INSTRUCTION.replace('{{CONTENT}}', content), {
        temperature: 0.2,
        maxTokens: 500,
      });
      const obj = extractJson(text) as { concepts?: unknown };
      if (!Array.isArray(obj.concepts)) return [];
      return obj.concepts
        .filter(
          (c): c is ExtractedConcept =>
            typeof (c as ExtractedConcept)?.name === 'string' &&
            typeof (c as ExtractedConcept)?.description === 'string' &&
            typeof (c as ExtractedConcept)?.domain === 'string',
        )
        .map((c) => {
          // Sanitize optional fields — LLM có thể trả thiếu, sai type, hoặc null.
          const raw = c as Record<string, unknown>;
          const examples = Array.isArray(raw.examples)
            ? (raw.examples as unknown[])
                .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                .slice(0, 3)
                .map((s) => s.trim().slice(0, 200))
            : undefined;
          const difficulty =
            typeof raw.difficulty === 'number' && raw.difficulty >= 0 && raw.difficulty <= 1
              ? raw.difficulty
              : undefined;
          const strength =
            typeof raw.strength === 'number' && raw.strength >= 0 && raw.strength <= 1
              ? raw.strength
              : undefined;
          const previewQuestion =
            typeof raw.previewQuestion === 'string' && raw.previewQuestion.trim().length > 0
              ? raw.previewQuestion.trim().slice(0, 300)
              : undefined;
          const previewAnswer =
            typeof raw.previewAnswer === 'string' && raw.previewAnswer.trim().length > 0
              ? raw.previewAnswer.trim().slice(0, 500)
              : undefined;
          return {
            name: c.name.trim(),
            description: c.description.trim(),
            domain: c.domain.trim().toLowerCase(),
            examples,
            difficulty,
            strength,
            previewQuestion,
            previewAnswer,
          };
        })
        .filter((c) => c.name.length > 0 && c.name.length < 100); // sane limit
    } catch (err) {
      console.warn('[extract-concepts] skip chunk:', (err as Error).message);
      return [];
    }
  }

  /**
   * Tìm concept có sẵn match name (similarity > threshold) hoặc tạo mới.
   * Embed NGOÀI transaction (network call) để không giữ lock lâu; search +
   * insert bọc advisory lock theo (name|domain) chống 2 job concurrency=2
   * cùng INSERT 1 concept (race đã fix ở lib cũ — giữ nguyên).
   */
  async findOrCreateConcept(c: ExtractedConcept): Promise<string> {
    const embedding = await this.embedding.embedQuery(c.name);
    const vectorLiteral = `[${embedding.join(',')}]`;
    const lockKey = `concept:${c.name.trim().toLowerCase()}|${c.domain.trim().toLowerCase()}`;

    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);

        const matches = await tx.$queryRaw<{ id: string; name: string; distance: number }[]>(
          Prisma.sql`
            SELECT
              id,
              name,
              (embedding <=> ${vectorLiteral}::vector) AS distance
            FROM concept
            ORDER BY embedding <=> ${vectorLiteral}::vector
            LIMIT 1;
          `,
        );

        const candidate = matches[0];
        if (candidate) {
          // Cosine distance ∈ [0, 2]; similarity = 1 - distance/2
          const similarity = 1 - Number(candidate.distance) / 2;
          if (similarity >= DEDUP_THRESHOLD) {
            return candidate.id;
          }
        }

        // Không match → INSERT new concept (embedding là Unsupported vector →
        // bắt buộc raw SQL). id sinh app-side như Drizzle $defaultFn cũ.
        const id = randomUUID();
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO concept
            (id, name, description, domain, embedding, examples, difficulty, preview_question, preview_answer)
          VALUES
            (${id}, ${c.name}, ${c.description}, ${c.domain}, ${vectorLiteral}::vector,
             ${JSON.stringify(c.examples ?? [])}::jsonb, ${c.difficulty ?? null},
             ${c.previewQuestion ?? null}, ${c.previewAnswer ?? null});
        `);
        return id;
      },
      // Default 5s của interactive transaction quá sát khi phải CHỜ advisory
      // lock của job song song — nới 30s (lock giữ ngắn, chỉ search + insert).
      { timeout: 30_000 },
    );
  }

  /**
   * Trích concepts cho 1 list chunk_id và lưu pivot links. Tuần tự (không
   * parallel) để giữ Voyage RPM dưới rate limit free tier — y lib cũ.
   * Idempotent qua ON CONFLICT DO NOTHING — retry không tạo trùng.
   */
  async extractConceptsForChunks(chunkIds: string[]): Promise<ExtractStats> {
    if (chunkIds.length === 0) {
      return { chunksProcessed: 0, conceptsExtracted: 0, linksCreated: 0, failedConcepts: 0 };
    }

    const chunks = await this.prisma.chunk.findMany({
      where: { id: { in: chunkIds } },
      select: { id: true, content: true },
    });

    let conceptsExtracted = 0;
    let linksCreated = 0;
    let failedConcepts = 0;

    for (const ch of chunks) {
      const extracted = await this.extractConceptsFromChunk(ch.content);
      conceptsExtracted += extracted.length;

      for (const c of extracted) {
        try {
          const conceptId = await this.findOrCreateConcept(c);
          // strength theo LLM (mức liên quan chunk↔atom), default 0.5 nếu
          // LLM không trả. RETURNING để đếm linksCreated y semantics cũ
          // (conflict bị skip → không đếm).
          const inserted = await this.prisma.$queryRaw<{ chunk_id: string }[]>(Prisma.sql`
            INSERT INTO chunk_concept (chunk_id, concept_id, strength)
            VALUES (${ch.id}, ${conceptId}, ${c.strength ?? 0.5})
            ON CONFLICT DO NOTHING
            RETURNING chunk_id;
          `);
          if (inserted.length > 0) linksCreated++;
        } catch (err) {
          // Dedup/insert failure → skip concept, log nhưng không crash batch.
          failedConcepts++;
          console.warn(`[concepts] skip "${c.name}": ${(err as Error).message}`);
        }
      }
    }

    return {
      chunksProcessed: chunks.length,
      conceptsExtracted,
      linksCreated,
      failedConcepts,
    };
  }

  /** Extract concepts cho toàn bộ chunks của 1 document. */
  async extractConceptsForDocument(documentId: string): Promise<ExtractStats> {
    const rows = await this.prisma.chunk.findMany({
      where: { document_id: documentId },
      select: { id: true },
    });
    return this.extractConceptsForChunks(rows.map((r) => r.id));
  }
}

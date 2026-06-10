/**
 * AtomExtractorService — Pillar #3 Atom-Level Slicing, port từ
 * apps/web/src/lib/library/atom-extractor.ts.
 *
 * Flow: fetch chunks → build text marker [PAGE n] → LLM extract atoms →
 * slugify dedup → embed batch → DELETE atoms cũ + INSERT mới. Idempotent.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { EmbeddingService } from '../../infra/ai/embedding.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { LibraryLlmService } from './library-llm.service';

// ─── LLM output schema ───────────────────────────────────────────────
const AtomSchema = z.object({
  text: z.string().min(2).max(120),
  pageNums: z.array(z.number().int().positive()).min(1).max(20),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
});
const AtomsResponseSchema = z.object({
  atoms: z.array(AtomSchema), // không cap ở schema — sẽ slice trước insert
});
/** Hard cap số atoms / doc — defensive, tránh insert bom. */
const MAX_ATOMS_PER_DOC = 30;
type ExtractedAtom = z.infer<typeof AtomSchema>;

/** Slugify tiếng Việt → ASCII slug cho dedup cross-doc (same logic web). */
export function slugifyAtom(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip dấu thanh
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// ─── LLM system prompt — copy NGUYÊN VĂN từ lib cũ ───────────────────
const SYSTEM_PROMPT = `Bạn là chuyên gia phân tích tài liệu học tập tiếng Việt.

Nhiệm vụ: từ nội dung tài liệu (có marker [PAGE n] để chỉ trang), trích xuất 8-20 ATOMS — đơn vị kiến thức nhỏ nhất user cần master.

Atom là KHÁI NIỆM/KỸ NĂNG cụ thể, KHÔNG phải câu hỏi hay đoạn văn.

Ví dụ atoms tốt:
  ✓ "đạo hàm hàm hợp"
  ✓ "định lý Vi-et"
  ✓ "phương pháp tích phân từng phần"
  ✓ "thì hiện tại hoàn thành tiếp diễn"
  ✓ "phương trình đường thẳng trong không gian Oxyz"

Ví dụ atoms tồi:
  ✗ "bài tập 1" (không phải concept)
  ✗ "chương 3" (quá rộng)
  ✗ "câu hỏi về đạo hàm" (không phải concept, là Q)

Output JSON đúng schema:
{
  "atoms": [
    {
      "text": "tên atom ngắn gọn (2-12 từ)",
      "pageNums": [12, 13, 47],   // các trang atom xuất hiện
      "difficulty": "easy" | "medium" | "hard"
    }
  ]
}

Yêu cầu:
- TỐI THIỂU 5 atoms, TỐI ĐA 20 atoms
- pageNums BẮT BUỘC ≥1 trang
- KHÔNG markdown, KHÔNG giải thích, CHỈ JSON
- text viết tiếng Việt thường (không hoa toàn bộ)`;

export type AtomExtractResult = {
  atomsInserted: number;
  modelUsed: string;
  costUsd: number;
};

@Injectable()
export class AtomExtractorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly llm: LibraryLlmService,
  ) {}

  /**
   * Extract atoms cho 1 doc. Idempotent — gọi nhiều lần OK.
   * @throws nếu doc không có chunks (chưa ingest xong) hoặc LLM fail.
   */
  async extractAtomsForDoc(docId: string): Promise<AtomExtractResult> {
    // ── 1. Fetch doc + chunks ──────────────────────────────────────────
    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: {
        id: true,
        uploader_id: true,
        title: true,
        subject_slug: true,
        page_count: true,
      },
    });
    if (!doc) throw new Error(`libraryDoc not found: ${docId}`);

    const chunks = await this.prisma.library_doc_chunk.findMany({
      where: { doc_id: docId },
      select: { page_num: true, content: true },
      orderBy: [{ page_num: 'asc' }, { chunk_index: 'asc' }],
    });
    if (chunks.length === 0) {
      throw new Error(`Doc ${docId} chưa có chunks — chạy ingest pipeline trước`);
    }

    // ── 2. Build text với marker [PAGE n] — cap ~12k chars ────────────
    const MAX_PAGES = 20;
    const PER_PAGE_CHARS = 600;
    const byPage = new Map<number, string[]>();
    for (const c of chunks) {
      if (!byPage.has(c.page_num)) byPage.set(c.page_num, []);
      byPage.get(c.page_num)!.push(c.content);
    }
    const pageNums = Array.from(byPage.keys())
      .sort((a, b) => a - b)
      .slice(0, MAX_PAGES);
    const docText = pageNums
      .map((p) => {
        const merged = byPage.get(p)!.join(' ').slice(0, PER_PAGE_CHARS);
        return `[PAGE ${p}]\n${merged}`;
      })
      .join('\n\n');

    // ── 3. LLM extract ─────────────────────────────────────────────────
    const userMsg = `Tài liệu: "${doc.title}"
Môn: ${doc.subject_slug}
Số trang: ${doc.page_count ?? pageNums.length}

Nội dung:
${docText}

Trích xuất atoms theo schema yêu cầu.`;

    const { text, costUsd, modelId } = await this.llm.complete({
      userId: doc.uploader_id,
      plan: 'FREE',
      system: SYSTEM_PROMPT,
      prompt: userMsg,
      maxTokens: 1500,
      feature: 'library.atom.extract',
    });

    // ── 4. Parse JSON (LLM hay wrap markdown code block) ───────────────
    const jsonText = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();

    let parsed: { atoms: ExtractedAtom[] };
    try {
      const raw = JSON.parse(jsonText) as unknown;
      parsed = AtomsResponseSchema.parse(raw);
    } catch (err) {
      console.error('[atom-extract] parse fail:', text.slice(0, 200));
      throw new Error(`Atom JSON parse fail: ${(err as Error).message}`);
    }

    // Filter atoms có page hợp lệ (≤ pageCount)
    const maxPage = doc.page_count ?? Math.max(...pageNums);
    const validAtoms = parsed.atoms.filter((a) => a.pageNums.every((p) => p >= 1 && p <= maxPage));
    if (validAtoms.length === 0) {
      throw new Error('LLM không trả về atom hợp lệ');
    }

    // Dedup by slug trong cùng doc + cap MAX_ATOMS_PER_DOC
    const seenSlugs = new Set<string>();
    const dedupAtoms: Array<ExtractedAtom & { slug: string }> = [];
    for (const a of validAtoms) {
      if (dedupAtoms.length >= MAX_ATOMS_PER_DOC) break;
      const slug = slugifyAtom(a.text);
      if (!slug || seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);
      dedupAtoms.push({ ...a, slug });
    }

    // ── 5. Embed batch atom_text ───────────────────────────────────────
    const embeddings = await this.embedding.embedBatch(dedupAtoms.map((a) => a.text));

    // ── 6. DELETE atoms cũ + INSERT mới (vector qua raw SQL) ───────────
    await this.prisma.library_doc_atom.deleteMany({ where: { doc_id: docId } });

    if (dedupAtoms.length > 0) {
      const rows = dedupAtoms.map((a, idx) => {
        const emb = embeddings[idx];
        const vectorLiteral = emb ? `[${emb.join(',')}]` : null;
        const pageNumsLiteral = `{${a.pageNums.join(',')}}`;
        return Prisma.sql`(${randomUUID()}, ${docId}, ${a.text}, ${a.slug}, ${pageNumsLiteral}::int[], ${a.difficulty ?? null}, ${vectorLiteral}::vector)`;
      });
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO library_doc_atom (id, doc_id, atom_text, atom_slug, page_nums, difficulty, embedding)
        VALUES ${Prisma.join(rows)};
      `);
    }

    return {
      atomsInserted: dedupAtoms.length,
      modelUsed: modelId,
      costUsd,
    };
  }
}

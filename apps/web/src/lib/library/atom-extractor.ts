/**
 * library/atom-extractor — Pillar #3 Atom-Level Slicing (Phase 2, 2026-05-27).
 *
 * Job extract atoms (concept đơn vị học tập) từ 1 library doc:
 *   1. Fetch chunks của doc (đã embed sẵn từ ingest pipeline)
 *   2. Gộp chunks theo page → build text có marker [PAGE n] để LLM biết atom
 *      xuất hiện ở trang nào
 *   3. Gửi LLM (Sonnet via routedGenerateText useCase='classify' để rẻ +
 *      schema-constrained output)
 *   4. Parse JSON {atoms:[{text,pageNums,difficulty}]}
 *   5. Slugify atom_text → dedup cross-doc
 *   6. Embed batch atom_text → vector(1024)
 *   7. DELETE atoms cũ của doc + INSERT batch mới
 *
 * Idempotent: gọi lại trên cùng doc → wipe atom cũ + tái sinh.
 *
 * Cost ước: ~$0.001/doc (Haiku) hoặc $0.005/doc (Sonnet) tuỳ chain.
 * Time: ~3-8s/doc (LLM ~2s + embed ~1s + DB ~0.5s).
 *
 * Spec: docs/plans/library-share.md §Phase 2 / Pillar #3.
 */
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { db, libraryDoc, libraryDocChunk, libraryDocAtom } from '@cogniva/db';

import { embedBatch } from '@/lib/ingest/embed';
import { routedGenerateText } from '@/lib/ai/router';

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

// ─── Slugify tiếng Việt → ASCII slug cho dedup cross-doc ─────────────
function slugifyAtom(s: string): string {
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

// ─── LLM system prompt ───────────────────────────────────────────────
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

// ─── Public entry ────────────────────────────────────────────────────
export type AtomExtractResult = {
  atomsInserted: number;
  modelUsed: string;
  costUsd: number;
};

/**
 * Extract atoms cho 1 doc. Idempotent — gọi nhiều lần OK.
 *
 * @returns thông tin số atom + cost
 * @throws nếu doc không có chunks (chưa ingest xong) hoặc LLM fail
 */
export async function extractAtomsForDoc(
  docId: string,
): Promise<AtomExtractResult> {
  // ── 1. Fetch doc + chunks ──────────────────────────────────────────
  const [doc] = await db
    .select({
      id: libraryDoc.id,
      uploaderId: libraryDoc.uploaderId,
      title: libraryDoc.title,
      subjectSlug: libraryDoc.subjectSlug,
      pageCount: libraryDoc.pageCount,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.id, docId))
    .limit(1);
  if (!doc) throw new Error(`libraryDoc not found: ${docId}`);

  const chunks = await db
    .select({
      pageNum: libraryDocChunk.pageNum,
      content: libraryDocChunk.content,
    })
    .from(libraryDocChunk)
    .where(eq(libraryDocChunk.docId, docId))
    .orderBy(libraryDocChunk.pageNum, libraryDocChunk.chunkIndex);

  if (chunks.length === 0) {
    throw new Error(`Doc ${docId} chưa có chunks — chạy ingest pipeline trước`);
  }

  // ── 2. Build text với marker [PAGE n] ──────────────────────────────
  // Cap input ~12k chars để vừa context Haiku/Sonnet + tránh cost spike.
  // Strategy: lấy ~600 chars đầu mỗi page, lên đến 20 trang đầu.
  const MAX_PAGES = 20;
  const PER_PAGE_CHARS = 600;
  const byPage = new Map<number, string[]>();
  for (const c of chunks) {
    if (!byPage.has(c.pageNum)) byPage.set(c.pageNum, []);
    byPage.get(c.pageNum)!.push(c.content);
  }
  const pageNums = Array.from(byPage.keys()).sort((a, b) => a - b).slice(0, MAX_PAGES);
  const docText = pageNums
    .map((p) => {
      const merged = byPage.get(p)!.join(' ').slice(0, PER_PAGE_CHARS);
      return `[PAGE ${p}]\n${merged}`;
    })
    .join('\n\n');

  // ── 3. LLM extract ──────────────────────────────────────────────────
  const userMsg = `Tài liệu: "${doc.title}"
Môn: ${doc.subjectSlug}
Số trang: ${doc.pageCount ?? pageNums.length}

Nội dung:
${docText}

Trích xuất atoms theo schema yêu cầu.`;

  const { text, costUsd, modelId } = await routedGenerateText({
    useCase: 'classify',
    userId: doc.uploaderId,
    plan: 'FREE',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMsg }],
    maxOutputTokens: 1500,
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
  const maxPage = doc.pageCount ?? Math.max(...pageNums);
  const validAtoms = parsed.atoms.filter(
    (a) => a.pageNums.every((p) => p >= 1 && p <= maxPage),
  );
  if (validAtoms.length === 0) {
    throw new Error('LLM không trả về atom hợp lệ');
  }

  // Dedup by slug trong cùng doc (LLM đôi khi lặp) + cap MAX_ATOMS_PER_DOC
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
  const embeddings = await embedBatch(dedupAtoms.map((a) => a.text));

  // ── 6. DELETE atoms cũ + INSERT mới ────────────────────────────────
  await db.delete(libraryDocAtom).where(eq(libraryDocAtom.docId, docId));

  const insertRows = dedupAtoms.map((a, idx) => ({
    id: randomUUID(),
    docId,
    atomText: a.text,
    atomSlug: a.slug,
    pageNums: a.pageNums,
    difficulty: a.difficulty ?? null,
    embedding: embeddings[idx] ?? null,
  }));

  // Drizzle batch insert (max ~50 atoms/doc, không cần chia batch)
  if (insertRows.length > 0) {
    await db.insert(libraryDocAtom).values(insertRows);
  }

  return {
    atomsInserted: insertRows.length,
    modelUsed: modelId,
    costUsd,
  };
}

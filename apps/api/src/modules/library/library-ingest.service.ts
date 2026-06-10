/**
 * LibraryIngestService — post-upload pipeline, port từ
 * apps/web/src/lib/library/ingest.ts + 2 step async best-effort của nó:
 * duplicate-detect.autoFlagDuplicates + difficulty-prereq.recompute (gộp
 * private ở đây để khỏi đụng file của agent khác cùng wave).
 *
 * Flow: download R2 → parse per page → thumbnail → chunk+embed → AI summary
 * → title embedding → preview + PUBLISHED → async (atoms / dup-flag /
 * difficulty+prereq). Throws nếu parse fail → caller UPDATE hiddenReason.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { EmbeddingService } from '../../infra/ai/embedding.service';
import { PrismaService } from '../../infra/database/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { AtomExtractorService, slugifyAtom } from './atom-extractor.service';
import { LibraryLlmService } from './library-llm.service';
import { chunkPageText, parseFile } from './library-parsers';

/** Cosine sim ≥ X coi như near-duplicate (auto-flag admin report). */
const NEAR_DUPLICATE_THRESHOLD = 0.92;

// ─── Difficulty heuristic (port difficulty-prereq.ts) ────────────────
type Difficulty = 'easy' | 'medium' | 'hard';

/** Weighted score từ atom mix + page count + doc_type → bucket easy/medium/hard. */
function computeDifficulty(input: {
  atomDifficulties: Array<Difficulty | null>;
  pageCount: number | null;
  docType: string;
}): Difficulty {
  let atomScore = 0;
  let validAtoms = 0;
  for (const d of input.atomDifficulties) {
    if (!d) continue;
    validAtoms++;
    if (d === 'hard') atomScore += 2;
    else if (d === 'medium') atomScore += 1;
  }
  const atomAvg = validAtoms > 0 ? atomScore / validAtoms : 0.8; // default medium-ish

  const pc = input.pageCount ?? 0;
  const pageScore = pc < 20 ? 0 : pc < 50 ? 0.3 : 0.5;

  const t = input.docType;
  const typeBias =
    t === 'exam' || t === 'thesis' ? 0.3 : t === 'summary' || t === 'mind_map' ? -0.2 : 0;

  const score = atomAvg + pageScore + typeBias;
  if (score < 0.7) return 'easy';
  if (score < 1.4) return 'medium';
  return 'hard';
}

// ─── Prereq LLM prompt — copy NGUYÊN VĂN difficulty-prereq.ts ────────
const PREREQ_SYSTEM = `Bạn là chuyên gia phân tích tài liệu học tập.

Nhiệm vụ: đọc tài liệu, xác định 2-5 KHÁI NIỆM/KỸ NĂNG user CẦN BIẾT TRƯỚC khi đọc tài liệu này.

Ví dụ:
  - Doc "Tích phân nâng cao" → prerequisite: "đạo hàm cơ bản", "giới hạn hàm số"
  - Doc "React hooks" → prerequisite: "javascript es6+", "react component cơ bản"
  - Doc "IELTS Writing Task 2" → prerequisite: "ngữ pháp tiếng anh cơ bản", "tense"

Yêu cầu output JSON:
{
  "prerequisites": [
    "atom name 1 (ngắn gọn, 2-8 từ)",
    "atom name 2",
    ...
  ]
}

Quy tắc:
- Tối thiểu 2, tối đa 5 atom
- Mỗi atom viết thường, tiếng Việt (trừ thuật ngữ chuyên ngành)
- KHÔNG markdown, CHỈ JSON
- Nếu doc là cơ bản nhất → trả [] (không có prereq)`;

const PrereqSchema = z.object({
  prerequisites: z.array(z.string().min(2).max(80)).max(5),
});

@Injectable()
export class LibraryIngestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly embedding: EmbeddingService,
    private readonly llm: LibraryLlmService,
    private readonly atomExtractor: AtomExtractorService,
  ) {}

  /** Run ingest pipeline cho 1 doc. Idempotent: chunks cũ bị xoá trước. */
  async ingestLibraryDoc(docId: string): Promise<void> {
    // ── 0. Fetch doc record ────────────────────────────────────────────
    const doc = await this.prisma.library_doc.findUnique({ where: { id: docId } });
    if (!doc) throw new Error(`libraryDoc not found: ${docId}`);
    if (doc.status === 'PUBLISHED') {
      console.warn(`[ingest] doc ${docId} already PUBLISHED, re-ingesting`);
    }

    const r2Key = extractR2Key(doc.file_url);
    if (!r2Key) throw new Error('Không trích xuất được R2 key từ file_url');

    // ── 1. Download file ───────────────────────────────────────────────
    const buffer = await this.storage.get(r2Key);

    // ── 2. Parse theo format ───────────────────────────────────────────
    const fmt = doc.file_format as 'pdf' | 'docx' | 'image';
    const mimeType = inferMimeType(doc.file_url, fmt);
    const parsed = await parseFile(buffer, fmt, mimeType);

    // ── 3. Upload thumbnail (null khi sharp chưa cài — xem library-parsers) ─
    let thumbUrl: string | null = null;
    if (parsed.thumbnailJpeg) {
      const thumbKey = `lib/${doc.uploader_id}/${docId}-thumb.jpg`;
      await this.storage.put(thumbKey, parsed.thumbnailJpeg, 'image/jpeg');
      thumbUrl = this.storage.getPublicUrl(thumbKey);
    }

    // ── 4. Chunk + embed mọi page ──────────────────────────────────────
    await this.prisma.library_doc_chunk.deleteMany({ where: { doc_id: docId } });

    type ChunkSpec = { pageNum: number; chunkIndex: number; content: string };
    const chunkSpecs: ChunkSpec[] = [];
    for (const page of parsed.pages) {
      const pageChunks = chunkPageText(page.text);
      for (let i = 0; i < pageChunks.length; i++) {
        chunkSpecs.push({ pageNum: page.pageNum, chunkIndex: i, content: pageChunks[i]! });
      }
    }

    if (chunkSpecs.length > 0) {
      const embeddings = await this.embedding.embedBatch(chunkSpecs.map((c) => c.content));

      // INSERT batch 100 — vector qua raw SQL (content_vec Unsupported trong Prisma)
      const BATCH = 100;
      for (let i = 0; i < chunkSpecs.length; i += BATCH) {
        const slice = chunkSpecs.slice(i, i + BATCH);
        const rows = slice.map((c, j) => {
          const emb = embeddings[i + j];
          const vectorLiteral = emb ? `[${emb.join(',')}]` : null;
          return Prisma.sql`(${randomUUID()}, ${docId}, ${c.pageNum}, ${c.chunkIndex}, ${c.content}, ${vectorLiteral}::vector)`;
        });
        await this.prisma.$executeRaw(Prisma.sql`
          INSERT INTO library_doc_chunk (id, doc_id, page_num, chunk_index, content, content_vec)
          VALUES ${Prisma.join(rows)};
        `);
      }
    }

    // ── 5. Generate AI summary 200 từ (best-effort) ────────────────────
    let aiSummary: string | null = null;
    try {
      const firstPagesText = parsed.pages
        .slice(0, 5)
        .map((p) => p.text)
        .join('\n\n')
        .slice(0, 5000);

      if (firstPagesText.length > 200) {
        const { text } = await this.llm.complete({
          userId: doc.uploader_id,
          plan: 'FREE',
          system: `Bạn viết tóm tắt tài liệu học tập tiếng Việt 150-200 từ.
Phong cách thân thiện, mô tả nội dung chính + đối tượng phù hợp.
KHÔNG dùng markdown, KHÔNG bullet points, viết 1-2 đoạn liền mạch.`,
          prompt: `Tài liệu: "${doc.title}"\nMôn: ${doc.subject_slug}\nLoại: ${doc.doc_type}\n\nNội dung (trích 5 trang đầu):\n${firstPagesText}\n\nViết tóm tắt 150-200 từ.`,
          maxTokens: 400,
          feature: 'library.ingest.summary',
        });
        aiSummary = text.trim();
      }
    } catch (err) {
      console.error('[ingest.summary]', err);
    }

    // ── 6. Embed title + desc + summary cho search-vec doc-level ───────
    const titleText = [doc.title, doc.description ?? '', aiSummary ?? '']
      .filter(Boolean)
      .join('\n')
      .slice(0, 4000);
    let titleEmbedding: number[] | null = null;
    try {
      titleEmbedding = await this.embedding.embedQuery(titleText);
    } catch (err) {
      console.error('[ingest.title-embed]', err);
    }

    // ── 7-8. Preview text + UPDATE doc → PUBLISHED ─────────────────────
    const previewText = parsed.fullText.slice(0, 500);
    await this.prisma.library_doc.update({
      where: { id: docId },
      data: {
        status: 'PUBLISHED',
        preview_thumb_url: thumbUrl,
        preview_text: previewText,
        page_count: parsed.pageCount,
        ai_summary: aiSummary,
        ai_summary_at: aiSummary ? new Date() : null,
        updated_at: new Date(),
      },
    });
    if (titleEmbedding) {
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE library_doc SET title_embedding = ${`[${titleEmbedding.join(',')}]`}::vector
        WHERE id = ${docId}
      `);
    }

    // ── 9. Atom extraction async (fail không hỏng doc) ─────────────────
    void (async () => {
      try {
        const result = await this.atomExtractor.extractAtomsForDoc(docId);
        console.log(
          `[ingest.atoms] doc=${docId} atoms=${result.atomsInserted} cost=$${result.costUsd.toFixed(4)}`,
        );
      } catch (err) {
        console.error('[ingest.atoms]', docId, err);
      }
    })();

    // ── 10. Duplicate detection async — sim ≥ 0.92 tự tạo report admin ─
    void (async () => {
      try {
        const flagged = await this.autoFlagDuplicates(docId);
        if (flagged > 0) {
          console.log(`[ingest.dup-detect] doc=${docId} flagged for admin review`);
        }
      } catch (err) {
        console.error('[ingest.dup-detect]', docId, err);
      }
    })();

    // ── 11. Difficulty + prerequisite chain async (chờ atom job 8s) ────
    void (async () => {
      try {
        await new Promise((r) => setTimeout(r, 8000)); // chờ atom extract
        const result = await this.recomputeDifficultyAndPrereqForDoc(docId);
        console.log(
          `[ingest.diff-prereq] doc=${docId} diff=${result.difficulty} prereq=${result.prereqSlugs.length}`,
        );
      } catch (err) {
        console.error('[ingest.diff-prereq]', docId, err);
      }
    })();
  }

  // ─── Duplicate auto-flag (port lib/library/duplicate-detect.ts) ─────

  /** Quét title_embedding cùng môn — near-duplicate → 1 report PENDING. */
  private async autoFlagDuplicates(sourceDocId: string): Promise<number> {
    try {
      const source = await this.prisma.$queryRaw<
        Array<{ subject_slug: string; uploader_id: string; embedding: string | null }>
      >(Prisma.sql`
        SELECT subject_slug, uploader_id, title_embedding::text AS embedding
        FROM library_doc WHERE id = ${sourceDocId} LIMIT 1
      `);
      const src = source[0];
      if (!src?.embedding) return 0;

      const matches = await this.prisma.$queryRaw<Array<{ id: string; similarity: number }>>(
        Prisma.sql`
          SELECT id,
                 (1 - (title_embedding <=> ${src.embedding}::vector))::float AS similarity
          FROM library_doc
          WHERE status = 'PUBLISHED'
            AND id <> ${sourceDocId}
            AND subject_slug = ${src.subject_slug}
            AND title_embedding IS NOT NULL
          ORDER BY title_embedding <=> ${src.embedding}::vector
          LIMIT 5
        `,
      );
      const nearDups = matches.filter((m) => Number(m.similarity) >= NEAR_DUPLICATE_THRESHOLD);
      if (nearDups.length === 0) return 0;

      // 1 report tổng hợp tất cả matches — self-report (system flag), admin review
      await this.prisma.library_doc_report.create({
        data: {
          id: randomUUID(),
          doc_id: sourceDocId,
          reporter_id: src.uploader_id,
          reason: 'duplicate',
          detail: `Phát hiện ${nearDups.length} doc tương tự (sim ≥ ${NEAR_DUPLICATE_THRESHOLD}): ${nearDups
            .map((m) => `${m.id} (${(Number(m.similarity) * 100).toFixed(1)}%)`)
            .join(', ')}`,
          status: 'PENDING',
        },
      });
      return 1;
    } catch (err) {
      console.error('[duplicate.autoFlag]', sourceDocId, err);
      return 0;
    }
  }

  // ─── Difficulty + prereq (port lib/library/difficulty-prereq.ts) ────

  private async recomputeDifficultyAndPrereqForDoc(
    docId: string,
  ): Promise<{ difficulty: Difficulty; prereqSlugs: string[]; costUsd: number }> {
    const atoms = await this.prisma.library_doc_atom.findMany({
      where: { doc_id: docId },
      select: { difficulty: true },
    });
    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: { page_count: true, doc_type: true },
    });
    if (!doc) throw new Error(`Doc not found: ${docId}`);

    const difficulty = computeDifficulty({
      atomDifficulties: atoms.map((a) => a.difficulty as Difficulty | null),
      pageCount: doc.page_count,
      docType: doc.doc_type,
    });

    await this.prisma.library_doc.update({
      where: { id: docId },
      data: { difficulty, updated_at: new Date() },
    });

    const { prereqSlugs, costUsd } = await this.extractPrerequisitesForDoc(docId);
    return { difficulty, prereqSlugs, costUsd };
  }

  private async extractPrerequisitesForDoc(
    docId: string,
  ): Promise<{ prereqSlugs: string[]; costUsd: number; modelUsed: string }> {
    const doc = await this.prisma.library_doc.findUnique({
      where: { id: docId },
      select: {
        id: true,
        uploader_id: true,
        title: true,
        subject_slug: true,
        level: true,
        ai_summary: true,
        preview_text: true,
      },
    });
    if (!doc) throw new Error(`Doc not found: ${docId}`);

    const userMsg = `Tài liệu: "${doc.title}"
Môn: ${doc.subject_slug}
Cấp: ${doc.level}

AI tóm tắt:
${doc.ai_summary ?? '(chưa có)'}

Nội dung mẫu:
${(doc.preview_text ?? '').slice(0, 1500)}

Liệt kê prerequisite atoms.`;

    const { text, costUsd, modelId } = await this.llm.complete({
      userId: doc.uploader_id,
      plan: 'FREE',
      system: PREREQ_SYSTEM,
      prompt: userMsg,
      maxTokens: 400,
      feature: 'library.prereq.extract',
    });

    const jsonText = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    let parsed: z.infer<typeof PrereqSchema>;
    try {
      parsed = PrereqSchema.parse(JSON.parse(jsonText));
    } catch (err) {
      throw new Error(`Prereq JSON parse fail: ${(err as Error).message}`);
    }

    const slugs = parsed.prerequisites.map(slugifyAtom).filter((s) => s.length > 0);
    const dedupedSlugs = Array.from(new Set(slugs));

    await this.prisma.library_doc.update({
      where: { id: docId },
      data: { prerequisite_atom_slugs: dedupedSlugs, updated_at: new Date() },
    });

    return { prereqSlugs: dedupedSlugs, costUsd, modelUsed: modelId };
  }
}

// ─── Utility (port nguyên ingest.ts) ─────────────────────────────────

function extractR2Key(fileUrl: string): string | null {
  // file_url pattern: https://lib.cogniva.dev/lib/{uid}/{docId}.{ext}
  const match = fileUrl.match(/\/(lib\/[^/]+\/[^/?]+)/);
  return match ? match[1]! : null;
}

function inferMimeType(fileUrl: string, fmt: 'pdf' | 'docx' | 'image'): string {
  if (fmt === 'pdf') return 'application/pdf';
  if (fmt === 'docx')
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const lower = fileUrl.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

/**
 * Golden dataset builder — sinh 50 cặp (question, ground_truth) từ chunks
 * trong DB bằng LLM-as-author.
 *
 * Cách dùng:
 *   pnpm --filter=@cogniva/web eval:golden               # 50 chunks random toàn user
 *   pnpm --filter=@cogniva/web eval:golden -- 30         # size khác
 *   EVAL_USER_ID=... pnpm --filter=@cogniva/web eval:golden  # 1 user cụ thể
 *   EVAL_DOCUMENT_ID=... ...                             # 1 document cụ thể
 *
 * Vì sao AI-synthesize?
 *   - Manual viết 50 Q-A tốn 4-5 giờ — không feasible cho 1 user dev.
 *   - Synthesize cho ground truth bằng chính chunk → đo recall chính xác
 *     (ta biết chunk gốc, nếu retrieval không trả về = fail).
 *   - Trade-off: questions hơi "AI-style" — Phase 3 v2 có thể trộn 10 manual
 *     + 40 synthetic để cân bằng. Hiện tại synthetic-only đủ cho A/B test.
 *
 * Output: apps/web/evals/golden.json (commit vào repo nếu dataset stable).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { generateText } from 'ai';

import { db, sql } from '@cogniva/db';

import { getChatModel } from '../src/lib/ai/models';
import type { GoldenItem } from './types';

const SYNTHESIZE_INSTRUCTION = `Bạn là chuyên gia tạo bài kiểm tra. Đọc đoạn văn dưới đây và sinh:
1. MỘT câu hỏi mà người học (sinh viên) thường hỏi để truy vấn đoạn này.
2. Câu trả lời ngắn gọn (2-4 câu) DỰA HOÀN TOÀN trên nội dung đoạn — không thêm thông tin ngoài.

Yêu cầu:
- Câu hỏi cụ thể, không quá general (tránh "Đoạn này nói về cái gì?").
- Trả về JSON THUẦN không markdown, không backtick, không giải thích kèm:
{"question": "...", "answer": "..."}

Đoạn văn:
"""
{{CONTENT}}
"""`;

type ChunkRow = {
  id: string;
  content: string;
  document_id: string;
  filename: string;
};

/** Strip code fence + extract object JSON đầu tiên trong text. */
function extractJson(text: string): unknown {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  // Tìm đoạn { ... } đầu tiên — phòng LLM trả thêm prose
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in LLM output');
  return JSON.parse(match[0]);
}

async function pickChunks(size: number): Promise<ChunkRow[]> {
  const userId = process.env.EVAL_USER_ID;
  const documentId = process.env.EVAL_DOCUMENT_ID;

  // Tách filter ra biến để tránh type collision SQL<unknown> (xem note ở
  // retrieval/index.ts về đa version drizzle-orm)
  const userFilter = userId ? sql`AND d.user_id = ${userId}` : sql``;
  const docFilter = documentId ? sql`AND c.document_id = ${documentId}` : sql``;

  const rows = await db.execute<ChunkRow>(sql`
    SELECT
      c.id,
      c.content,
      c.document_id,
      d.filename
    FROM chunk c
    INNER JOIN document d ON d.id = c.document_id
    WHERE d.status = 'READY'
      AND length(c.content) > 100
      ${userFilter}
      ${docFilter}
    ORDER BY random()
    LIMIT ${size};
  `);
  return rows;
}

async function synthesizeQA(chunk: ChunkRow): Promise<{ question: string; answer: string }> {
  const { text } = await generateText({
    model: getChatModel(),
    prompt: SYNTHESIZE_INSTRUCTION.replace('{{CONTENT}}', chunk.content),
    temperature: 0.5,
    maxTokens: 400,
  });
  const obj = extractJson(text) as { question?: unknown; answer?: unknown };
  if (typeof obj.question !== 'string' || typeof obj.answer !== 'string') {
    throw new Error('LLM trả thiếu field question/answer');
  }
  return { question: obj.question, answer: obj.answer };
}

async function main() {
  const size = Number(process.argv[2] ?? 50);
  console.log(`[golden-build] Sampling ${size} chunks...`);
  const chunks = await pickChunks(size);
  console.log(`[golden-build] Got ${chunks.length} chunks. Synthesizing...`);

  const dataset: GoldenItem[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    try {
      const { question, answer } = await synthesizeQA(chunk);
      dataset.push({
        id: randomUUID(),
        question,
        ground_truth: answer,
        source_chunk_id: chunk.id,
        source_document_id: chunk.document_id,
        source_filename: chunk.filename,
      });
      console.log(`  ✓ [${i + 1}/${chunks.length}] ${question.slice(0, 80)}...`);
    } catch (err) {
      console.warn(`  ✗ [${i + 1}/${chunks.length}] skip: ${(err as Error).message}`);
    }
  }

  const outDir = resolve(process.cwd(), 'evals');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'golden.json');
  writeFileSync(outPath, JSON.stringify(dataset, null, 2), 'utf8');
  console.log(`[golden-build] Saved ${dataset.length} Q-A pairs → ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[golden-build] Fatal:', err);
  process.exit(1);
});

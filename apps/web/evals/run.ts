/**
 * A/B test runner — chạy basic vs advanced retrieval trên golden dataset
 * và tính RAGAS metrics cho cả 2.
 *
 * Cách dùng:
 *   pnpm --filter=@cogniva/web eval:run
 *   pnpm --filter=@cogniva/web eval:run -- 10        # giới hạn 10 items
 *   EVAL_SKIP_METRICS=1 pnpm --filter=@cogniva/web eval:run   # nhanh, chỉ retrieval
 *
 * Output:
 *   1. apps/web/evals/results.json — chi tiết từng item
 *   2. Console: bảng tóm tắt + delta (advanced - basic) cho 4 metric
 *
 * Cách chạy:
 *   - Đọc evals/golden.json
 *   - Với mỗi item: chạy SONG SONG basic + advanced retrieval (cùng userId
 *     scope qua source_document_id). Generate answer với cùng LLM. Judge
 *     metrics.
 *   - Aggregate cuối: mean per metric per mode + win rate (advanced > basic).
 *
 * Không scope theo user thật vì golden dataset đã ràng source_chunk_id —
 * chỉ cần truy ngược ra userId của document gốc trong runner để retrieval
 * không leak chunks user khác (giả sử user có quyền với source).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { generateText } from 'ai';

import { db, sql } from '@cogniva/db';

import { getChatModel } from '../src/lib/ai/models';
import { buildChatContext } from '../src/lib/chat/pipeline';

import {
  computeContextRecall,
  judgeAnswerRelevancy,
  judgeContextRelevancy,
  judgeFaithfulness,
} from './ragas';
import type { GoldenItem, Mode, RunResult, SingleRun } from './types';

const ANSWER_PROMPT = `Trả lời câu hỏi sau dựa HOÀN TOÀN trên context. Nếu context không đủ thông tin, nói "Tôi không có thông tin về vấn đề này trong tài liệu". Trả lời ngắn gọn 2-4 câu.

CONTEXT:
{{CONTEXT}}

CÂU HỎI:
{{QUESTION}}`;

/** Tra ngược userId từ document_id để pass vào pipeline scope. */
async function lookupUserId(documentId: string): Promise<string> {
  const rows = await db.execute<{ user_id: string }>(sql`
    SELECT user_id FROM document WHERE id = ${documentId} LIMIT 1;
  `);
  if (!rows[0]) throw new Error(`Document ${documentId} not found`);
  return rows[0].user_id;
}

async function generateAnswer(question: string, contextChunks: { content: string }[]): Promise<string> {
  const contextText = contextChunks.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n---\n\n');
  const { text } = await generateText({
    model: getChatModel(),
    prompt: ANSWER_PROMPT.replace('{{CONTEXT}}', contextText).replace('{{QUESTION}}', question),
    temperature: 0.2,
    maxTokens: 300,
  });
  return text.trim();
}

async function runMode(
  mode: Mode,
  question: string,
  userId: string,
  sourceChunkId: string,
  skipMetrics: boolean,
): Promise<SingleRun> {
  // Pass mode override để pipeline KHÔNG đọc env (eval cần ép cứng)
  const ctx = await buildChatContext({ query: question, userId, mode });
  const answer = await generateAnswer(question, ctx.chunks);

  const retrieved = ctx.chunks.map((c) => ({
    id: c.id,
    score: c.score,
    documentId: c.documentId,
    page: c.page,
  }));

  const result: SingleRun = {
    answer,
    retrieved,
    retrievalMs: ctx.retrievalMs,
  };

  if (!skipMetrics) {
    // Chạy 3 LLM judge song song để tiết kiệm thời gian
    const [faithfulness, answer_relevancy, context_relevancy] = await Promise.all([
      judgeFaithfulness(answer, ctx.chunks),
      judgeAnswerRelevancy(question, answer),
      judgeContextRelevancy(question, ctx.chunks),
    ]);
    const context_recall = computeContextRecall(
      sourceChunkId,
      retrieved.map((r) => r.id),
    );
    result.metrics = { faithfulness, answer_relevancy, context_relevancy, context_recall };
  }

  return result;
}

/** Bảng tổng hợp số trung bình + win rate. */
function summarize(results: RunResult[]): void {
  const metrics: (keyof NonNullable<SingleRun['metrics']>)[] = [
    'faithfulness',
    'answer_relevancy',
    'context_relevancy',
    'context_recall',
  ];

  const withMetrics = results.filter((r) => r.basic.metrics && r.advanced.metrics);
  if (withMetrics.length === 0) {
    console.log('\n(Không có metric — chạy với EVAL_SKIP_METRICS=0 để tính RAGAS)');
    return;
  }

  console.log('\n=== A/B Test Summary ===');
  console.log(`N = ${withMetrics.length}\n`);
  console.log('Metric                | Basic   | Advanced | Δ        | Adv wins');
  console.log('----------------------|---------|----------|----------|---------');

  for (const m of metrics) {
    const basicAvg =
      withMetrics.reduce((sum, r) => sum + r.basic.metrics![m], 0) / withMetrics.length;
    const advancedAvg =
      withMetrics.reduce((sum, r) => sum + r.advanced.metrics![m], 0) / withMetrics.length;
    const wins = withMetrics.filter((r) => r.advanced.metrics![m] > r.basic.metrics![m]).length;
    const winRate = ((wins / withMetrics.length) * 100).toFixed(0);
    const delta = (advancedAvg - basicAvg).toFixed(3);
    const deltaStr = (advancedAvg >= basicAvg ? '+' : '') + delta;
    console.log(
      `${m.padEnd(22)}| ${basicAvg.toFixed(3)}   | ${advancedAvg.toFixed(3)}    | ${deltaStr.padStart(8)} | ${winRate}%`,
    );
  }

  // Latency summary (không bias mode nào — chỉ thông tin)
  const basicLatency =
    results.reduce((sum, r) => sum + r.basic.retrievalMs, 0) / results.length;
  const advancedLatency =
    results.reduce((sum, r) => sum + r.advanced.retrievalMs, 0) / results.length;
  console.log('\nRetrieval latency (mean ms):');
  console.log(`  basic:    ${basicLatency.toFixed(0)} ms`);
  console.log(`  advanced: ${advancedLatency.toFixed(0)} ms (${(advancedLatency / basicLatency).toFixed(1)}x)`);
}

async function main() {
  const limit = Number(process.argv[2] ?? 0); // 0 = run all
  const skipMetrics = process.env.EVAL_SKIP_METRICS === '1';

  const goldenPath = resolve(process.cwd(), 'evals', 'golden.json');
  const golden: GoldenItem[] = JSON.parse(readFileSync(goldenPath, 'utf8'));
  const items = limit > 0 ? golden.slice(0, limit) : golden;
  console.log(`[run] Evaluating ${items.length}/${golden.length} items (skipMetrics=${skipMetrics})`);

  const results: RunResult[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    try {
      const userId = await lookupUserId(item.source_document_id);
      // Sequential (không Promise.all) — Voyage free tier 3 RPM, embed song
      // song của basic+advanced sẽ hit 429. Trade-off chậm hơn nhưng robust.
      // Khi user upgrade Voyage payment → có thể đổi sang Promise.all.
      const basic = await runMode('basic', item.question, userId, item.source_chunk_id, skipMetrics);
      const advanced = await runMode('advanced', item.question, userId, item.source_chunk_id, skipMetrics);
      results.push({
        goldenId: item.id,
        question: item.question,
        ground_truth: item.ground_truth,
        source_chunk_id: item.source_chunk_id,
        basic,
        advanced,
      });
      const m = basic.metrics && advanced.metrics
        ? `b.faith=${basic.metrics.faithfulness.toFixed(2)} a.faith=${advanced.metrics.faithfulness.toFixed(2)}`
        : '(no metrics)';
      console.log(`  ✓ [${i + 1}/${items.length}] ${m} ${item.question.slice(0, 60)}`);
    } catch (err) {
      console.warn(`  ✗ [${i + 1}/${items.length}] ${(err as Error).message}`);
    }
  }

  const outDir = resolve(process.cwd(), 'evals');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, 'results.json');
  writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n[run] Saved ${results.length} results → ${outPath}`);

  summarize(results);
  process.exit(0);
}

main().catch((err) => {
  console.error('[run] Fatal:', err);
  process.exit(1);
});

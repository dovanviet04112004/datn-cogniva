/**
 * CLI script — backfill concepts cho tài liệu đã ingest trước Phase 4.
 *
 * Cách dùng:
 *   pnpm --filter=@cogniva/web extract:concepts                    # toàn DB
 *   pnpm --filter=@cogniva/web extract:concepts -- <documentId>    # 1 doc
 *   pnpm --filter=@cogniva/web extract:concepts -- --user <userId> # 1 user
 *   pnpm --filter=@cogniva/web extract:concepts -- --prereq        # mine prereq sau
 *
 * Luồng:
 *   1. Tìm tất cả chunk_id thoả filter
 *   2. Gọi extractConceptsForChunks → fill chunk_concept + concept tables
 *   3. Nếu --prereq: scan all concepts → mine prerequisite edges
 *
 * Lưu ý: chạy idempotent — chunks đã extract trước đó được link lại
 * nhưng không tạo concept trùng (vector dedup).
 */
import { sql, db } from '@cogniva/db';

import {
  extractConceptsForChunks,
  listAllConcepts,
  minePrerequisites,
} from '../src/lib/concepts';

async function main() {
  const args = process.argv.slice(2);
  const userIdx = args.indexOf('--user');
  const userId = userIdx >= 0 ? args[userIdx + 1] : undefined;
  const minePrereq = args.includes('--prereq');
  const documentId = args.find((a) => !a.startsWith('--') && a !== userId);

  // Build query lấy chunk_id theo filter
  const userFilter = userId ? sql`AND d.user_id = ${userId}` : sql``;
  const docFilter = documentId ? sql`AND c.document_id = ${documentId}` : sql``;

  console.log('[extract-concepts] Loading chunk ids...');
  const rows = await db.execute<{ id: string }>(sql`
    SELECT c.id
    FROM chunk c
    INNER JOIN document d ON d.id = c.document_id
    WHERE d.status = 'READY'
      AND length(c.content) > 50
      ${userFilter}
      ${docFilter}
    ORDER BY c.id;
  `);
  const chunkIds = rows.map((r) => r.id);
  console.log(`[extract-concepts] Found ${chunkIds.length} chunks. Extracting...`);

  const stats = await extractConceptsForChunks(chunkIds);
  console.log(`[extract-concepts] Done: ${stats.chunksProcessed} chunks · ${stats.conceptsExtracted} concepts extracted · ${stats.linksCreated} links created`);

  if (minePrereq) {
    console.log('\n[extract-concepts] Mining prerequisites...');
    const allConcepts = await listAllConcepts();
    console.log(`  Loaded ${allConcepts.length} concepts. Querying LLM per domain group...`);
    const inserted = await minePrerequisites(allConcepts);
    console.log(`[extract-concepts] Prereq done: ${inserted} edges inserted`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[extract-concepts] Fatal:', err);
  process.exit(1);
});

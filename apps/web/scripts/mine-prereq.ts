/**
 * CLI script — chỉ mine prerequisite edges từ concepts đã có sẵn trong DB.
 *
 * Khác `extract-concepts.ts --prereq` ở chỗ KHÔNG re-extract concepts trước
 * (extract step gây rate limit Voyage trên tài liệu lớn). Phù hợp khi bạn
 * đã có concepts ổn và chỉ muốn fill edges.
 *
 * Cách dùng:
 *   pnpm --filter=@cogniva/web exec tsx --env-file=.env.local scripts/mine-prereq.ts
 */
import { listAllConcepts, minePrerequisites } from '../src/lib/concepts';

async function main() {
  console.log('[mine-prereq] Loading concepts...');
  const concepts = await listAllConcepts();
  console.log(`[mine-prereq] ${concepts.length} concepts. Querying LLM per domain group...`);

  const inserted = await minePrerequisites(concepts);
  console.log(`[mine-prereq] Done: ${inserted} edges inserted`);

  process.exit(0);
}

main().catch((err) => {
  console.error('[mine-prereq] Fatal:', err);
  process.exit(1);
});

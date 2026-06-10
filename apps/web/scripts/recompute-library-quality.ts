/**
 * Recompute Quality Score + badges cho mọi library doc PUBLISHED (Phase 2).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/recompute-library-quality.ts
 *
 * Idempotent — chạy nhiều lần OK, formula deterministic từ stats.
 */
import { recomputeQualityAll } from '../src/lib/library/quality-score';

async function main() {
  console.log('🏆 Recompute Quality Score cho mọi doc PUBLISHED...\n');
  const result = await recomputeQualityAll();
  console.log(`\n────────────────────────────────`);
  console.log(`Total: ${result.total}`);
  console.log(`Success: ${result.succeeded}`);
  console.log(`Fail: ${result.failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

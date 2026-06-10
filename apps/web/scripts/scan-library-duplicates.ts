/**
 * Scan mọi library doc PUBLISHED → flag near-duplicates (Phase 2, 2026-05-27).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/scan-library-duplicates.ts
 *   pnpm exec tsx --env-file=.env.local scripts/scan-library-duplicates.ts --dry-run
 *
 * --dry-run: chỉ log, không tạo report rows.
 */
import { eq } from 'drizzle-orm';

import { db, libraryDoc } from '@cogniva/db';

import {
  findDuplicateMatches,
  autoFlagDuplicates,
  NEAR_DUPLICATE_THRESHOLD,
} from '../src/lib/library/duplicate-detect';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const docs = await db
    .select({ id: libraryDoc.id, title: libraryDoc.title })
    .from(libraryDoc)
    .where(eq(libraryDoc.status, 'PUBLISHED'));

  console.log(
    `🔍 Quét ${docs.length} doc tìm duplicate (threshold ${NEAR_DUPLICATE_THRESHOLD})...\n`,
  );

  let nearDupCount = 0;
  let flaggedCount = 0;
  const seen = new Set<string>(); // pair dedup (a,b) === (b,a)

  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]!;
    const matches = await findDuplicateMatches(d.id, NEAR_DUPLICATE_THRESHOLD);
    if (matches.length === 0) continue;

    for (const m of matches) {
      const pairKey = [d.id, m.id].sort().join('|');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      nearDupCount++;
      console.log(`  ${(m.similarity * 100).toFixed(1)}%  ${d.title.slice(0, 40)}`);
      console.log(`         ↕  ${m.title.slice(0, 40)}\n`);
    }

    if (!DRY_RUN) {
      const flagged = await autoFlagDuplicates(d.id);
      flaggedCount += flagged;
    }
  }

  console.log(`────────────────────────────────`);
  console.log(`Near-duplicate pairs: ${nearDupCount}`);
  if (!DRY_RUN) console.log(`Reports created: ${flaggedCount}`);
  else console.log(`(dry-run — no reports created)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

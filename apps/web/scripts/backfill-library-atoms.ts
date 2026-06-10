/**
 * Backfill atoms cho mọi library doc đã PUBLISHED chưa có atom (Phase 2).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-library-atoms.ts
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-library-atoms.ts --reextract
 *
 * --reextract: chạy lại cả những doc đã có atoms (xoá + tái sinh).
 *
 * Phase 2 — Pillar #3 (atom-slicing) — seed atoms cho 17 doc seed-v1.
 */
import { eq, sql } from 'drizzle-orm';

import { db, libraryDoc } from '@cogniva/db';

import { extractAtomsForDoc } from '../src/lib/library/atom-extractor';

const REEXTRACT = process.argv.includes('--reextract');

async function main() {
  // ── Liệt kê docs cần backfill ──────────────────────────────────────
  // Default: doc PUBLISHED + chưa có atom (LEFT JOIN COUNT=0)
  // --reextract: tất cả PUBLISHED
  const docs = await db
    .select({
      id: libraryDoc.id,
      title: libraryDoc.title,
      pageCount: libraryDoc.pageCount,
      atomCount: sql<number>`(SELECT COUNT(*)::int FROM library_doc_atom WHERE doc_id = ${libraryDoc.id})`,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.status, 'PUBLISHED'));

  const targets = REEXTRACT
    ? docs
    : docs.filter((d) => Number(d.atomCount) === 0);

  if (targets.length === 0) {
    console.log(
      REEXTRACT
        ? 'Không có doc PUBLISHED nào.'
        : 'Tất cả doc đã có atoms. Dùng --reextract để chạy lại.',
    );
    return;
  }

  console.log(
    `🧩 Backfill atoms cho ${targets.length} doc${REEXTRACT ? ' (re-extract)' : ''}\n`,
  );

  let totalAtoms = 0;
  let totalCost = 0;
  let failCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const doc = targets[i]!;
    const idx = `[${i + 1}/${targets.length}]`;
    console.log(
      `${idx} ${doc.title.slice(0, 50)}${doc.title.length > 50 ? '…' : ''}`,
    );
    try {
      const result = await extractAtomsForDoc(doc.id);
      totalAtoms += result.atomsInserted;
      totalCost += result.costUsd;
      console.log(
        `       ✓ ${result.atomsInserted} atoms — ${result.modelUsed} — $${result.costUsd.toFixed(4)}`,
      );
    } catch (err) {
      failCount++;
      console.error(`       ✗ ${(err as Error).message}`);
    }
  }

  console.log(`\n────────────────────────────────`);
  console.log(`Total atoms inserted: ${totalAtoms}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Fail: ${failCount}/${targets.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/**
 * Backfill difficulty + prerequisite chain cho doc PUBLISHED (Phase 3 Bonus #13).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-difficulty-prereq.ts
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-difficulty-prereq.ts --reextract
 *
 * --reextract: chạy lại cả prereq cho mọi doc (mặc định chỉ doc chưa có prereq).
 */
import { eq, sql } from 'drizzle-orm';

import { db, libraryDoc } from '@cogniva/db';

import {
  recomputeDifficultyAndPrereqForDoc,
  computeDifficulty,
} from '../src/lib/library/difficulty-prereq';
import { libraryDocAtom } from '@cogniva/db';

const REEXTRACT = process.argv.includes('--reextract');

async function main() {
  const docs = await db
    .select({
      id: libraryDoc.id,
      title: libraryDoc.title,
      pageCount: libraryDoc.pageCount,
      docType: libraryDoc.docType,
      difficulty: libraryDoc.difficulty,
      prereqSlugs: libraryDoc.prerequisiteAtomSlugs,
    })
    .from(libraryDoc)
    .where(eq(libraryDoc.status, 'PUBLISHED'));

  const targets = REEXTRACT
    ? docs
    : docs.filter(
        (d) => !d.difficulty || (d.prereqSlugs ?? []).length === 0,
      );

  if (targets.length === 0) {
    console.log('Tất cả doc đã có difficulty + prereq. Dùng --reextract để chạy lại.');
    return;
  }

  console.log(
    `🎯 Backfill difficulty + prereq cho ${targets.length} doc${REEXTRACT ? ' (re-extract)' : ''}\n`,
  );

  let totalCost = 0;
  let succeeded = 0;
  let diffOnly = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const doc = targets[i]!;
    const idx = `[${i + 1}/${targets.length}]`;
    console.log(
      `${idx} ${doc.title.slice(0, 50)}${doc.title.length > 50 ? '…' : ''}`,
    );
    try {
      // Optimisation: nếu chỉ thiếu difficulty (đã có prereq), tính nhanh không LLM
      if (!REEXTRACT && (doc.prereqSlugs ?? []).length > 0 && !doc.difficulty) {
        const atoms = await db
          .select({ difficulty: libraryDocAtom.difficulty })
          .from(libraryDocAtom)
          .where(eq(libraryDocAtom.docId, doc.id));
        const diff = computeDifficulty({
          atomDifficulties: atoms.map(
            (a) => a.difficulty as 'easy' | 'medium' | 'hard' | null,
          ),
          pageCount: doc.pageCount,
          docType: doc.docType,
        });
        await db
          .update(libraryDoc)
          .set({ difficulty: diff, updatedAt: new Date() })
          .where(eq(libraryDoc.id, doc.id));
        diffOnly++;
        console.log(`       ✓ difficulty=${diff} (no LLM)`);
        continue;
      }
      const result = await recomputeDifficultyAndPrereqForDoc(doc.id);
      totalCost += result.costUsd;
      succeeded++;
      console.log(
        `       ✓ diff=${result.difficulty} prereq=${result.prereqSlugs.length} — $${result.costUsd.toFixed(4)}`,
      );
    } catch (err) {
      failed++;
      console.error(`       ✗ ${(err as Error).message}`);
    }
  }

  // Stats
  const [stats] = await db.execute(sql`
    SELECT
      difficulty,
      COUNT(*)::int AS n
    FROM library_doc
    WHERE status = 'PUBLISHED'
    GROUP BY difficulty
  `);

  console.log(`\n────────────────────────────────`);
  console.log(`LLM-full: ${succeeded}, diff-only: ${diffOnly}, fail: ${failed}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);
  console.log(`Distribution:`, stats);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

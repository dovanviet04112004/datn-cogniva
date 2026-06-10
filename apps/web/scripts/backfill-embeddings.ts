/**
 * Backfill embeddings cho doc seed thiếu (2026-05-28).
 *
 * Các doc seed thẳng vào DB (seed-university-docs / regenerate-real-pdfs) bỏ qua
 * pipeline ingest nên thiếu title_embedding + chunks → vector search/dedup/voice
 * yếu. Script này backfill CHỈ embedding + chunks, KHÔNG đụng thumbnail/summary/
 * status (tránh regress thumbnail trang-2 + tốn LLM summary).
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/backfill-embeddings.ts
 */
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';

import { db, libraryDoc, libraryDocChunk } from '@cogniva/db';

import { embedBatch } from '../src/lib/ingest/embed';
import { embedQuery } from '../src/lib/ingest/embed-query';
import { getR2Object } from '../src/lib/r2-client';
import { chunkPageText, parseFile } from '../src/lib/library/parsers';

function extractR2Key(fileUrl: string): string | null {
  const m = fileUrl.match(/\/(lib\/[^/]+\/[^/?]+)/);
  return m ? m[1]! : null;
}

function inferMime(url: string, fmt: string): string {
  if (fmt === 'pdf') return 'application/pdf';
  if (fmt === 'docx')
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const l = url.toLowerCase();
  if (l.endsWith('.png')) return 'image/png';
  if (l.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function main() {
  const docs = await db
    .select({
      id: libraryDoc.id,
      title: libraryDoc.title,
      description: libraryDoc.description,
      aiSummary: libraryDoc.aiSummary,
      fileUrl: libraryDoc.fileUrl,
      fileFormat: libraryDoc.fileFormat,
    })
    .from(libraryDoc)
    .where(and(eq(libraryDoc.status, 'PUBLISHED'), isNull(libraryDoc.titleEmbedding)));

  console.log(`📦 Backfill ${docs.length} doc thiếu title_embedding...\n`);
  let ok = 0;
  let fail = 0;

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!;
    const tag = `[${i + 1}/${docs.length}] ${doc.title.slice(0, 48)}`;
    try {
      // 1) title_embedding (grid search cần cái này) — set NGAY, độc lập chunks.
      const titleText = [doc.title, doc.description ?? '', doc.aiSummary ?? '']
        .filter(Boolean)
        .join('\n')
        .slice(0, 4000);
      const titleEmbedding = await embedQuery(titleText);
      await db
        .update(libraryDoc)
        .set({ titleEmbedding, updatedAt: new Date() })
        .where(eq(libraryDoc.id, doc.id));

      // 2) chunks (cho cross-doc/voice) — BEST-EFFORT, lỗi không làm fail doc.
      let chunkCount = 0;
      let chunkNote = '';
      try {
        const key = extractR2Key(doc.fileUrl);
        if (key) {
          const buffer = await getR2Object(key);
          const parsed = await parseFile(
            buffer,
            doc.fileFormat as 'pdf' | 'docx' | 'image',
            inferMime(doc.fileUrl, doc.fileFormat),
          );
          const specs: Array<{ pageNum: number; chunkIndex: number; content: string }> = [];
          for (const page of parsed.pages) {
            const chunks = chunkPageText(page.text);
            chunks.forEach((c, idx) =>
              specs.push({ pageNum: page.pageNum, chunkIndex: idx, content: c }),
            );
          }
          await db.delete(libraryDocChunk).where(eq(libraryDocChunk.docId, doc.id));
          if (specs.length > 0) {
            const embs = await embedBatch(specs.map((s) => s.content));
            const rows = specs.map((s, idx) => ({
              id: randomUUID(),
              docId: doc.id,
              pageNum: s.pageNum,
              chunkIndex: s.chunkIndex,
              content: s.content,
              contentVec: embs[idx] ?? null,
            }));
            for (let j = 0; j < rows.length; j += 100) {
              await db.insert(libraryDocChunk).values(rows.slice(j, j + 100));
            }
            chunkCount = rows.length;
          }
        }
      } catch (cerr) {
        const cause = (cerr as { cause?: unknown }).cause;
        chunkNote = ` (chunks lỗi: ${String((cause as Error)?.message ?? (cerr as Error).message).slice(0, 120)})`;
      }

      console.log(`${tag}\n       ✓ title_embedding + ${chunkCount} chunks${chunkNote}`);
      ok++;
    } catch (err) {
      const cause = (err as { cause?: unknown }).cause;
      console.log(`${tag}\n       ✗ ${String((cause as Error)?.message ?? (err as Error).message).slice(0, 160)}`);
      fail++;
    }
  }

  console.log(`\n────────────\nOK: ${ok} · Fail: ${fail}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

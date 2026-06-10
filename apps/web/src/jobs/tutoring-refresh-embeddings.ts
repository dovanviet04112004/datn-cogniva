/**
 * BullMQ job `tutoring-refresh-embeddings` — V4 T1 (2026-05-22).
 *
 * BullMQ job (chạy bởi worker; lịch/trigger ở src/queue/jobs.ts + src/worker).
 *
 * Cron daily refresh bioEmbedding cho tutor profile có embedding stale
 * (> 14 ngày) hoặc bio/headline đã update sau lần embed cuối.
 *
 * Lý do batch refresh thay lazy compute (V3):
 *   - Concierge search hit hot path → cần embedding sẵn để < 200ms
 *   - Tutor edit bio → đáng lý phải re-embed nhưng PATCH endpoint không
 *     biết → cron cleanup
 *
 * Schedule: 03:00 UTC daily = 10:00 VN (low traffic).
 *
 * Logic:
 *   SELECT id, bio, headline FROM tutor_profile
 *    WHERE status = 'PUBLISHED'
 *      AND (
 *        bio_embedding IS NULL OR
 *        bio_embedding_updated_at IS NULL OR
 *        bio_embedding_updated_at < NOW() - INTERVAL '14 days' OR
 *        updated_at > bio_embedding_updated_at
 *      )
 *    LIMIT 100;
 *
 * Cap 100/run để không spam embedding API. Caller cron tự gọi lại next day.
 *
 * Idempotent: mỗi lần chạy đọc lại candidate stale rồi re-embed + ghi
 * bioEmbeddingUpdatedAt = now. Chạy lại (BullMQ retry cả job) chỉ làm rows
 * đã refresh rớt khỏi tập candidate lần sau — an toàn lặp.
 */
import { eq, or, sql, isNull } from 'drizzle-orm';

import { db, tutorProfile } from '@cogniva/db';

import { embedQuery } from '@/lib/ingest/embed-query';
import { logger } from '@/lib/observability/logger';

const BATCH_SIZE = 100;
const STALE_DAYS = 14;

export async function tutoringRefreshEmbeddings() {
  // Step 1: Find stale candidates
  const candidates = await (async () => {
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
    return db
      .select({
        id: tutorProfile.id,
        headline: tutorProfile.headline,
        bio: tutorProfile.bio,
      })
      .from(tutorProfile)
      .where(
        sql`${tutorProfile.status} = 'PUBLISHED'
            AND (
              ${tutorProfile.bioEmbedding} IS NULL
              OR ${tutorProfile.bioEmbeddingUpdatedAt} IS NULL
              OR ${tutorProfile.bioEmbeddingUpdatedAt} < ${cutoff}
              OR ${tutorProfile.updatedAt} > ${tutorProfile.bioEmbeddingUpdatedAt}
            )`,
      )
      .limit(BATCH_SIZE);
  })();

  logger.info(`tutoring-refresh.candidates ${candidates.length}`);

  if (candidates.length === 0) return { refreshed: 0 };

  // Step 2: Embed + update per row (sequential — Anthropic/Voyage rate limit safe)
  const refreshed = await (async () => {
    let count = 0;
    for (const c of candidates) {
      try {
        const embedding = await embedQuery(`${c.headline}\n${c.bio}`);
        await db
          .update(tutorProfile)
          .set({
            bioEmbedding: embedding,
            bioEmbeddingUpdatedAt: new Date(),
          })
          .where(eq(tutorProfile.id, c.id));
        count++;
      } catch (err) {
        logger.error('tutoring-refresh.embed-failed', {
          tutorId: c.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return count;
  })();

  logger.info('tutoring-refresh.done', { refreshed, total: candidates.length });
  return { refreshed };
}

// Marker imports cho ESLint không xoá khi unused
void or;
void isNull;

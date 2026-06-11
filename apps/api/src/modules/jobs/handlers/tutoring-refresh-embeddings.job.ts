import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';

import { EmbeddingService } from '../../../infra/ai/embedding.service';
import { PrismaService } from '../../../infra/database/prisma.service';

const BATCH_SIZE = 100;
const STALE_DAYS = 14;

@Injectable()
export class TutoringRefreshEmbeddingsJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  async run(): Promise<{ refreshed: number }> {
    const cutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.$queryRaw<
      Array<{ id: string; headline: string; bio: string }>
    >(Prisma.sql`
      SELECT id, headline, bio
      FROM tutor_profile
      WHERE status = 'PUBLISHED'
        AND (
          bio_embedding IS NULL
          OR bio_embedding_updated_at IS NULL
          OR bio_embedding_updated_at < ${cutoff}
          OR updated_at > bio_embedding_updated_at
        )
      LIMIT ${BATCH_SIZE}
    `);

    logger.info(`tutoring-refresh.candidates ${candidates.length}`);

    if (candidates.length === 0) return { refreshed: 0 };

    let refreshed = 0;
    for (const c of candidates) {
      try {
        const embedding = await this.embedding.embedQuery(`${c.headline}\n${c.bio}`);
        await this.prisma.$executeRaw(Prisma.sql`
          UPDATE tutor_profile
          SET bio_embedding = ${`[${embedding.join(',')}]`}::vector,
              bio_embedding_updated_at = ${new Date()}
          WHERE id = ${c.id}
        `);
        refreshed++;
      } catch (err) {
        logger.error('tutoring-refresh.embed-failed', {
          tutorId: c.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('tutoring-refresh.done', { refreshed, total: candidates.length });
    return { refreshed };
  }
}

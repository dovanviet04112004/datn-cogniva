import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, library_saved_search as SavedSearchRow } from '@prisma/client';

import { PrismaService } from '../../../infra/database/prisma.service';
import { savedSearchBodySchema } from './dto/annotations.dto';

function toSavedSearchDto(row: SavedSearchRow) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    queryParams: row.query_params,
    notifyOnNew: row.notify_on_new,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
  };
}

@Injectable()
export class LibrarySavedSearchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.library_saved_search.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
    return { savedSearches: rows.map(toSavedSearchDto) };
  }

  async create(userId: string, raw: unknown) {
    const parsed = savedSearchBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException({ error: 'Invalid body', details: parsed.error.flatten() });
    }

    const id = randomUUID();
    await this.prisma.library_saved_search.create({
      data: {
        id,
        user_id: userId,
        name: parsed.data.name,
        query_params: parsed.data.queryParams as Prisma.InputJsonValue,
        notify_on_new: parsed.data.notifyOnNew,
      },
    });

    return { ok: true, id };
  }

  async remove(userId: string, id: string) {
    const result = await this.prisma.library_saved_search.deleteMany({
      where: { id, user_id: userId },
    });
    if (result.count === 0) throw new NotFoundException({ error: 'Not found' });
    return { ok: true };
  }
}

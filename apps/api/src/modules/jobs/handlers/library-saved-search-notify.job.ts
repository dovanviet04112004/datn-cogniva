import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { logger } from '@cogniva/server-core';

import { PrismaService } from '../../../infra/database/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const NOTIF_TYPE = 'library-saved-search';
const EXPO_BATCH_SIZE = 100;

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: { type: string; [k: string]: unknown };
  sound?: 'default';
  priority?: 'normal' | 'high';
  channelId?: string;
}

interface ExpoPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

type SavedSearchParams = Record<string, string | number | string[]>;

const PARAM_TO_COL: Record<string, string> = {
  subject: 'subject_slug',
  level: 'level',
  grade: 'grade',
  docType: 'doc_type',
  language: 'language',
  fileFormat: 'file_format',
  difficulty: 'difficulty',
};

function buildFilterPredicates(params: SavedSearchParams, sinceAt: Date): Prisma.Sql[] {
  const predicates: Prisma.Sql[] = [
    Prisma.sql`library_doc."status" = 'PUBLISHED'`,
    Prisma.sql`library_doc."created_at" > ${sinceAt}`,
  ];
  for (const [key, value] of Object.entries(params)) {
    if (key === 'q') {
      const text = typeof value === 'string' ? value.trim() : '';
      if (text.length >= 2) {
        predicates.push(
          Prisma.sql`library_doc.search_vec @@ plainto_tsquery('simple', immutable_unaccent(${text}))`,
        );
      }
      continue;
    }
    const col = PARAM_TO_COL[key];
    if (!col) continue;
    const colRef = Prisma.raw(`library_doc."${col}"`);
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      predicates.push(Prisma.sql`${colRef} IN (${Prisma.join(value)})`);
    } else if (key === 'grade') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) continue;
      predicates.push(Prisma.sql`${colRef} = ${n}`);
    } else {
      predicates.push(Prisma.sql`${colRef} = ${String(value)}`);
    }
  }
  return predicates;
}

@Injectable()
export class LibrarySavedSearchNotifyJob {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async run(): Promise<Record<string, number>> {
    const savedSearches = await this.prisma.library_saved_search.findMany({
      where: { notify_on_new: true },
    });

    logger.info(`Found ${savedSearches.length} saved-searches with notify_on_new`);

    if (savedSearches.length === 0) {
      return { processed: 0, matchedSearches: 0, sent: 0 };
    }

    type MatchResult = {
      savedSearchId: string;
      userId: string;
      savedName: string;
      matchCount: number;
      firstDocTitle: string;
    };
    const matches: MatchResult[] = [];
    for (const s of savedSearches) {
      const sinceAt = new Date(s.last_run_at ?? s.created_at);
      const predicates = buildFilterPredicates(s.query_params as SavedSearchParams, sinceAt);
      const rows = await this.prisma.$queryRaw<Array<{ count: number; title: string }>>(Prisma.sql`
        SELECT COUNT(*) OVER ()::int AS "count", library_doc."title" AS "title"
        FROM library_doc
        WHERE ${Prisma.join(predicates, ' AND ')}
        ORDER BY library_doc."created_at" DESC
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) continue;
      matches.push({
        savedSearchId: s.id,
        userId: s.user_id,
        savedName: s.name,
        matchCount: row.count,
        firstDocTitle: row.title,
      });
    }

    logger.info(`Saved-searches with new matches: ${matches.length}`);

    if (matches.length === 0) {
      await this.prisma.library_saved_search.updateMany({
        where: { notify_on_new: true },
        data: { last_run_at: new Date() },
      });
      return { processed: savedSearches.length, matchedSearches: 0, sent: 0 };
    }

    const userIds = Array.from(new Set(matches.map((m) => m.userId)));
    const targets = await this.notifications.getPushTokens(userIds);

    const messages: ExpoPushMessage[] = [];
    const messageMeta: Array<{ savedSearchId: string; userId: string; token: string }> = [];

    for (const m of matches) {
      const userTokens = targets.filter((t) => t.userId === m.userId);
      if (userTokens.length === 0) continue;
      const body =
        m.matchCount === 1
          ? `📚 "${m.firstDocTitle}"`
          : `📚 "${m.firstDocTitle}" + ${m.matchCount - 1} tài liệu khác`;
      for (const t of userTokens) {
        messages.push({
          to: t.token,
          title: `Cogniva Library — ${m.matchCount} tài liệu mới khớp "${m.savedName}"`,
          body,
          data: {
            type: NOTIF_TYPE,
            savedSearchId: m.savedSearchId,
            count: m.matchCount,
          },
          sound: 'default',
          priority: 'normal',
          channelId: 'default',
        });
        messageMeta.push({
          savedSearchId: m.savedSearchId,
          userId: m.userId,
          token: t.token,
        });
      }
    }

    const tickets: Array<{ meta: (typeof messageMeta)[number]; ticket: ExpoPushTicket }> = [];
    const invalidTokens: string[] = [];

    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      const batch = messages.slice(i, i + EXPO_BATCH_SIZE);
      const batchMeta = messageMeta.slice(i, i + EXPO_BATCH_SIZE);
      try {
        const res = await fetch(EXPO_PUSH_API_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'accept-encoding': 'gzip, deflate',
            'content-type': 'application/json',
          },
          body: JSON.stringify(batch),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          logger.error('library-notify.expo-batch-failed', {
            status: res.status,
            body_preview: text.slice(0, 500),
            batch_size: batch.length,
          });
          for (const meta of batchMeta) {
            tickets.push({ meta, ticket: { status: 'error', message: `HTTP ${res.status}` } });
          }
          continue;
        }
        const json = (await res.json()) as { data: ExpoPushTicket[] };
        json.data.forEach((ticket, idx) => {
          const meta = batchMeta[idx]!;
          tickets.push({ meta, ticket });
          if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(meta.token);
          }
        });
      } catch (err) {
        logger.error('library-notify.fetch-throw', {
          error: err instanceof Error ? err.message : String(err),
          batch_size: batch.length,
        });
        for (const meta of batchMeta) {
          tickets.push({ meta, ticket: { status: 'error', message: 'fetch threw' } });
        }
      }
    }

    if (invalidTokens.length > 0) {
      await this.prisma.push_token.deleteMany({ where: { token: { in: invalidTokens } } });
    }

    type Entry = {
      userId: string;
      savedSearchId: string;
      anySuccess: boolean;
      firstError: string | null;
    };
    const byKey = new Map<string, Entry>();
    for (const t of tickets) {
      const key = `${t.meta.userId}|${t.meta.savedSearchId}`;
      const cur = byKey.get(key) ?? {
        userId: t.meta.userId,
        savedSearchId: t.meta.savedSearchId,
        anySuccess: false,
        firstError: null,
      };
      if (t.ticket.status === 'ok') cur.anySuccess = true;
      else if (!cur.firstError) cur.firstError = t.ticket.message ?? 'unknown';
      byKey.set(key, cur);
    }
    const rows = Array.from(byKey.values()).map((e) => {
      const match = matches.find((m) => m.savedSearchId === e.savedSearchId);
      return {
        id: randomUUID(),
        user_id: e.userId,
        type: NOTIF_TYPE,
        title: `Cogniva Library — ${match?.matchCount ?? 0} tài liệu mới khớp "${match?.savedName ?? ''}"`,
        body: match?.firstDocTitle ?? '',
        data: {
          type: NOTIF_TYPE,
          savedSearchId: e.savedSearchId,
          count: match?.matchCount ?? 0,
        } as Prisma.InputJsonValue,
        status: e.anySuccess ? 'sent' : 'failed',
        error: e.anySuccess ? null : e.firstError,
        sent_at: e.anySuccess ? new Date() : null,
      };
    });
    if (rows.length > 0) {
      await this.prisma.notification_log.createMany({ data: rows });
    }

    const allIds = savedSearches.map((s) => s.id);
    if (allIds.length > 0) {
      await this.prisma.library_saved_search.updateMany({
        where: { id: { in: allIds } },
        data: { last_run_at: new Date() },
      });
    }

    const sent = tickets.filter((t) => t.ticket.status === 'ok').length;
    logger.info('library-saved-search-notify.done', {
      processed: savedSearches.length,
      matched_searches: matches.length,
      tokens: targets.length,
      sent,
      invalidated: invalidTokens.length,
    });

    return {
      processed: savedSearches.length,
      matchedSearches: matches.length,
      sent,
      invalidated: invalidTokens.length,
    };
  }
}

/**
 * library-saved-search-notify — Phase 4 Step 4 (2026-05-27).
 *
 * BullMQ job (chạy bởi worker; lịch/trigger ở src/queue/jobs.ts + src/worker).
 * Cron daily 14:00 UTC (21:00 VN — sau flashcard reminder 1h để tách traffic).
 *
 * Pipeline:
 *   1. Query saved_search rows có `notifyOnNew=true`.
 *   2. Với mỗi saved-search, count + lấy top 5 docs PUBLISHED khớp filter
 *      và mới hơn `last_run_at` (lần đầu thì lấy mốc `saved_search.createdAt`).
 *   3. Nếu ≥ 1 match → gửi Expo push (1 push per saved-search có match,
 *      multi-device gửi 1 message / token), insert notification_log, update
 *      `last_run_at = NOW()` (idempotent — chạy lại trong cùng cycle no-op).
 *
 * Idempotency: update `last_run_at = NOW()` ở cuối mỗi cycle là choke-point
 * windowing — chạy lại trong cùng cycle sẽ không re-quét doc cũ (no-op match).
 *
 * Filter columns hỗ trợ (subset của TRACKABLE_PARAMS — bỏ `q` FTS vì rebuild
 * search vector cho từng saved-search ở cron scale tốn kém, Phase 5 sẽ thêm):
 *   subject (subject_slug), level, grade, docType, language, fileFormat, difficulty
 *
 * Sort: skipped — count + ORDER BY created_at DESC để lấy doc mới nhất hiển thị
 * trong push body.
 */
import { and, eq, gt, inArray, isNotNull, sql, desc } from 'drizzle-orm';

import {
  db,
  libraryDoc,
  librarySavedSearch,
  notificationLog,
  pushToken,
} from '@cogniva/db';

import { logger } from '@/lib/observability/logger';

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

/** Whitelist param → cột libraryDoc tương ứng. */
const PARAM_TO_COL: Record<string, keyof typeof libraryDoc> = {
  subject: 'subjectSlug',
  level: 'level',
  grade: 'grade',
  docType: 'docType',
  language: 'language',
  fileFormat: 'fileFormat',
  difficulty: 'difficulty',
};

function buildFilterPredicates(
  params: Record<string, string | number | string[]>,
  sinceAt: Date,
) {
  const predicates = [
    eq(libraryDoc.status, 'PUBLISHED'),
    gt(libraryDoc.createdAt, sinceAt),
  ];
  for (const [key, value] of Object.entries(params)) {
    // Phase 5: FTS text match `q` qua search_vec @@ plainto_tsquery
    // (plainto_tsquery tự escape user input, không cần sanitize riêng).
    // `search_vec` là generated column trong DB, chưa map qua Drizzle schema
    // nên reference bằng raw identifier.
    if (key === 'q') {
      const text = typeof value === 'string' ? value.trim() : '';
      if (text.length >= 2) {
        // unaccent để khớp search_vec (đã unaccent từ migration 0054) — gõ
        // không dấu vẫn match.
        predicates.push(
          sql`library_doc.search_vec @@ plainto_tsquery('simple', immutable_unaccent(${text}))`,
        );
      }
      continue;
    }
    const colKey = PARAM_TO_COL[key];
    if (!colKey) continue; // 'sort' — không filter cứng
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      predicates.push(inArray(libraryDoc[colKey] as never, value as never));
    } else if (key === 'grade') {
      // grade là integer column
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) continue;
      predicates.push(eq(libraryDoc.grade, n));
    } else {
      predicates.push(eq(libraryDoc[colKey] as never, String(value) as never));
    }
  }
  return predicates;
}

export async function librarySavedSearchNotify() {
  // Step 1: load saved-searches đang theo dõi
  const savedSearches = await db
    .select()
    .from(librarySavedSearch)
    .where(eq(librarySavedSearch.notifyOnNew, true));

  logger.info(`Found ${savedSearches.length} saved-searches with notify_on_new`);

  if (savedSearches.length === 0) {
    return { processed: 0, matchedSearches: 0, sent: 0 };
  }

  // Step 2: với mỗi saved-search, query doc mới matching
  type MatchResult = {
    savedSearchId: string;
    userId: string;
    savedName: string;
    matchCount: number;
    firstDocTitle: string;
  };
  const matches = await (async () => {
    const out: MatchResult[] = [];
    for (const s of savedSearches) {
      // Date có thể về string ở boundary — luôn `new Date()` cast, no-op nếu đã Date.
      const rawSince: Date | string = s.lastRunAt ?? s.createdAt;
      const sinceAt = new Date(rawSince);
      const predicates = buildFilterPredicates(s.queryParams, sinceAt);
      const [row] = await db
        .select({
          count: sql<number>`COUNT(*) OVER ()::int`,
          title: libraryDoc.title,
        })
        .from(libraryDoc)
        .where(and(...predicates))
        .orderBy(desc(libraryDoc.createdAt))
        .limit(1);
      if (!row) continue;
      out.push({
        savedSearchId: s.id,
        userId: s.userId,
        savedName: s.name,
        matchCount: row.count,
        firstDocTitle: row.title,
      });
    }
    return out;
  })();

  logger.info(`Saved-searches with new matches: ${matches.length}`);

  if (matches.length === 0) {
    // Vẫn update lastRunAt để chu kỳ kế tiếp không re-quét doc cũ
    await db
      .update(librarySavedSearch)
      .set({ lastRunAt: new Date() })
      .where(eq(librarySavedSearch.notifyOnNew, true));
    return { processed: savedSearches.length, matchedSearches: 0, sent: 0 };
  }

  // Step 3: load push tokens cho các user có match
  const userIds = Array.from(new Set(matches.map((m) => m.userId)));
  const targets = await db
    .select({ userId: pushToken.userId, token: pushToken.token })
    .from(pushToken)
    .where(
      and(
        inArray(pushToken.userId, userIds),
        eq(pushToken.enabled, true),
        isNotNull(pushToken.token),
      ),
    );

  // Step 4: build + gửi messages (1 push per match, multi-device fan-out)
  const sendResult = await (async () => {
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

    return { tickets, invalidTokens };
  })();

  // Step 5a: cleanup invalid tokens
  if (sendResult.invalidTokens.length > 0) {
    await db
      .delete(pushToken)
      .where(inArray(pushToken.token, sendResult.invalidTokens));
  }

  // Step 5b: insert notification_log (1 row / userId × savedSearchId)
  await (async () => {
    type Entry = {
      userId: string;
      savedSearchId: string;
      anySuccess: boolean;
      firstError: string | null;
    };
    const byKey = new Map<string, Entry>();
    for (const t of sendResult.tickets) {
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
        userId: e.userId,
        type: NOTIF_TYPE,
        title: `Cogniva Library — ${match?.matchCount ?? 0} tài liệu mới khớp "${match?.savedName ?? ''}"`,
        body: match?.firstDocTitle ?? '',
        data: {
          type: NOTIF_TYPE,
          savedSearchId: e.savedSearchId,
          count: match?.matchCount ?? 0,
        },
        status: e.anySuccess ? 'sent' : 'failed',
        error: e.anySuccess ? null : e.firstError,
        sentAt: e.anySuccess ? new Date() : null,
      };
    });
    if (rows.length > 0) await db.insert(notificationLog).values(rows);
  })();

  // Step 5c: update lastRunAt cho TẤT CẢ saved-search có notify (cả không match)
  // để cycle sau không scan doc cũ — fix windowing.
  await (async () => {
    const allIds = savedSearches.map((s) => s.id);
    if (allIds.length === 0) return;
    await db
      .update(librarySavedSearch)
      .set({ lastRunAt: new Date() })
      .where(inArray(librarySavedSearch.id, allIds));
  })();

  const sent = sendResult.tickets.filter((t) => t.ticket.status === 'ok').length;
  logger.info('library-saved-search-notify.done', {
    processed: savedSearches.length,
    matched_searches: matches.length,
    tokens: targets.length,
    sent,
    invalidated: sendResult.invalidTokens.length,
  });

  return {
    processed: savedSearches.length,
    matchedSearches: matches.length,
    sent,
    invalidated: sendResult.invalidTokens.length,
  };
}

/**
 * Entry point của package @cogniva/db.
 *
 * Cung cấp 2 Drizzle client:
 *   - `db`        : primary writer + reader. Connection string DATABASE_URL.
 *                   Mọi mutation (INSERT/UPDATE/DELETE) BẮT BUỘC qua đây.
 *   - `dbReplica` : read-only replica. Connection string DATABASE_REPLICA_URL.
 *                   Dùng cho heavy SELECT (analytics, list, search) — giảm tải
 *                   primary. Fallback về `db` nếu replica env không cấu hình.
 *
 * Khi nào dùng dbReplica:
 *   - List/feed query (room list, document list, deck list)
 *   - Analytics aggregation
 *   - Search query (BM25 + vector)
 *   - Dashboard summary
 *
 * Khi nào KHÔNG dùng dbReplica:
 *   - Trong cùng transaction với write (read-your-own-write)
 *   - Khi cần strong consistency (auth session lookup, payment status check)
 *   - Khi vừa write xong và đọc lại trong cùng request (replica lag 1-2s)
 *
 * Connection strategy:
 *   - Neon Pooler endpoint (`?pgbouncer=true`) cho serverless connection share
 *   - postgres.js `prepare: false` (yêu cầu cho pg-bouncer transaction mode)
 *   - Pool size nhỏ (max=10) — Vercel function ephemeral, không cần lớn
 *   - Idle timeout 20s — đóng connection idle để tránh exhausted pool
 *
 * Đặc điểm thiết kế (giữ từ v1):
 *   1. Lazy Proxy — không khởi tạo connection lúc import
 *   2. Global HMR cache cho dev
 *   3. Re-export schema + types
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

type PgClient = ReturnType<typeof postgres>;
type DbClient = ReturnType<typeof drizzle<typeof schema>>;

// Cache xuyên HMR trong dev — production sẽ skip vì NODE_ENV !== 'development'
//
// Lưu ý: CHỈ cache PG connection pool. KHÔNG cache drizzle wrapper vì khi
// schema.ts được edit + HMR re-import, wrapper cũ sẽ dùng schema cũ.
const globalForDb = globalThis as unknown as {
  _cognivaPg?: PgClient;
  _cognivaPgReplica?: PgClient;
};

/**
 * Resolve connection string — primary hoặc replica.
 * Throw clearly khi missing.
 */
function resolveDbUrl(role: 'primary' | 'replica'): string | null {
  if (role === 'primary') {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        '[@cogniva/db] DATABASE_URL chưa set. Copy .env.example sang .env.local + chạy `pnpm db:up`.',
      );
    }
    return url;
  }
  // Replica: optional — fallback primary nếu không có
  return process.env.DATABASE_REPLICA_URL ?? null;
}

/**
 * Tạo postgres.js client với config tối ưu cho:
 *   - Serverless (Vercel) — short-lived process, không cần huge pool
 *   - pg-bouncer transaction mode (Neon Pooler) — prepare statement OFF
 *   - pgvector — prepare statement off cũng giúp tránh corruption cache
 *
 * @param role - 'primary' hoặc 'replica'. Replica có thể tăng pool size cao hơn
 *               vì read-only queries thường dài hơn.
 */
function createClient(role: 'primary' | 'replica'): PgClient {
  const url = resolveDbUrl(role);
  if (!url) {
    throw new Error(`[@cogniva/db] ${role} URL không có`);
  }

  // Pool sizing:
  //   - primary: 10 connections / instance — đủ cho ~100 req/s với conn re-use
  //   - replica: 15 connections — read query có thể dài hơn (analytics)
  const max = role === 'replica' ? 15 : 10;

  return postgres(url, {
    max,
    // BẮT BUỘC cho pg-bouncer transaction mode (Neon Pooler):
    //   - Prepared statements bind theo connection, transaction mode swap
    //     connection mỗi tx → prepared cache invalid → error.
    //   - pgvector cũng không thân thiện với prepare cache.
    prepare: false,
    // Đóng connection idle sau 20s → tránh exhausted pool khi traffic spike
    // qua đêm rồi tụt. Neon Pooler quản lý outer pool — ta chỉ cần lean.
    idle_timeout: 20,
    // Max lifetime 30 phút — tránh connection stale (Neon scale-to-zero
    // restart, network drop, etc.)
    max_lifetime: 60 * 30,
    // Connection timeout 10s — fail fast khi DB down thay vì wait 30s default
    connect_timeout: 10,
    // Tắt notice log (NOTICE level từ Postgres) trừ khi debug
    onnotice: process.env.DB_DEBUG === '1' ? undefined : () => {},
  });
}

/**
 * Module-level cache cho drizzle wrapper — separate cho primary vs replica.
 * Reset khi HMR (module re-import).
 */
let _moduleDb: DbClient | null = null;
let _moduleDbReplica: DbClient | null = null;

function createDb(role: 'primary' | 'replica'): DbClient {
  const cacheKey = role === 'primary' ? '_cognivaPg' : '_cognivaPgReplica';
  const client = globalForDb[cacheKey] ?? createClient(role);
  if (process.env.NODE_ENV !== 'production') {
    globalForDb[cacheKey] = client;
  }
  return drizzle(client, {
    schema,
    // Logger dev = console.log mọi query → handy debug nhưng noisy.
    // Tắt cho replica để không double-log khi cùng query qua cả 2.
    logger: process.env.NODE_ENV === 'development' && role === 'primary',
  });
}

/**
 * Primary Drizzle client — mọi mutation + read mặc định đi qua đây.
 *
 * ```ts
 * import { db, user } from '@cogniva/db';
 * const me = await db.select().from(user).where(eq(user.id, '...')).limit(1);
 * await db.insert(flashcard).values({ ... });
 * ```
 */
export const db = new Proxy({} as DbClient, {
  get(_target, prop, receiver) {
    if (!_moduleDb) _moduleDb = createDb('primary');
    return Reflect.get(_moduleDb as object, prop, receiver);
  },
});

/**
 * Read-only Drizzle client trỏ vào replica.
 *
 * Fallback behavior:
 *   - Nếu DATABASE_REPLICA_URL không cấu hình → trả về cùng instance với `db`
 *     primary. Code không cần if-else, write & deploy không thay đổi.
 *   - Replica xuất hiện qua env → tự động route SELECT sang.
 *
 * Caveat replica lag:
 *   - Neon logical replication lag thường 100-500ms, có thể 1-2s spike.
 *   - Read-your-own-write KHÔNG đảm bảo. Sau khi insert/update, đọc ngay
 *     qua replica có thể chưa thấy → dùng `db` (primary) cho case này.
 *
 * ```ts
 * import { dbReplica, document } from '@cogniva/db';
 * // List query an toàn dùng replica
 * const docs = await dbReplica.select().from(document).where(...);
 * ```
 */
export const dbReplica = new Proxy({} as DbClient, {
  get(_target, prop, receiver) {
    // Nếu replica URL không set → fallback primary (transparent)
    if (!process.env.DATABASE_REPLICA_URL) {
      if (!_moduleDb) _moduleDb = createDb('primary');
      return Reflect.get(_moduleDb as object, prop, receiver);
    }
    if (!_moduleDbReplica) _moduleDbReplica = createDb('replica');
    return Reflect.get(_moduleDbReplica as object, prop, receiver);
  },
});

/**
 * Helper: kiểm tra replica có available không (cho health check, dashboard).
 */
export function hasReplica(): boolean {
  return !!process.env.DATABASE_REPLICA_URL;
}

/**
 * Region-aware DB client selector (Stage 2 M4 W3).
 *
 * Edge gateway tag header `x-cogniva-region` (asia/eu/us/oceania/africa).
 * Route handler call `getDbForRegion(region)` để chọn replica gần user nhất.
 *
 * Stage 1 (hiện tại): single replica → tất cả region → dbReplica.
 * Stage 2 M5+ (khi có Neon multi-region): switch theo region env:
 *   - asia    → DATABASE_REPLICA_ASIA_URL
 *   - europe  → DATABASE_REPLICA_EU_URL
 *   - us/khác → DATABASE_REPLICA_URL (primary region replica)
 *
 * KHÔNG dùng cho mutation — luôn `db` primary.
 */
export function getDbForRegion(_region?: string | null): DbClient {
  // Stage 1 implementation: ignore region, return universal replica.
  // Stage 2 M5 sẽ wire env DATABASE_REPLICA_{ASIA,EU,US}_URL.
  return dbReplica;
}

export type Db = DbClient;
export * from './schema';
export * from './types';

// Re-export `sql` template tag từ drizzle-orm để consumer (apps/web) chắc
// chắn dùng CÙNG instance drizzle-orm với @cogniva/db. Nếu apps tự import
// `sql from 'drizzle-orm'` mà pnpm resolve khác version (do peer conflict
// với better-auth/openapi-fetch...), TS sẽ báo type collision SQL<unknown>.
export { sql } from 'drizzle-orm';

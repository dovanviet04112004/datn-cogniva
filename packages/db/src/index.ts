/**
 * Entry point của package @cogniva/db.
 *
 * Cung cấp client Drizzle (`db`) đã cấu hình sẵn driver postgres.js + schema
 * full domain. Mọi route handler / server component muốn truy vấn DB đều
 * import từ đây.
 *
 * Đặc điểm thiết kế:
 *  1. **Lazy proxy**: client chỉ thực sự khởi tạo khi có ai đó truy cập
 *     property đầu tiên. Lý do: `next build` import module này lúc collect
 *     page data — nếu khởi tạo eager mà DATABASE_URL chưa được set sẽ lỗi.
 *     Dùng Proxy hoãn cho tới runtime.
 *  2. **Global cache trong dev**: HMR của Next.js sẽ re-import module nhiều
 *     lần → tạo nhiều connection pool → cạn limit. Cache vào globalThis để
 *     tái dùng connection xuyên reload (chỉ dev, production tắt cache vì
 *     mỗi worker có process riêng).
 *  3. **Re-export schema + types**: app code có thể `import { user, db,
 *     UserPreferences } from '@cogniva/db'` mà không cần biết các sub-path.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

type PgClient = ReturnType<typeof postgres>;
type DbClient = ReturnType<typeof drizzle<typeof schema>>;

// Cache xuyên HMR trong dev — production sẽ skip vì NODE_ENV !== 'development'
const globalForDb = globalThis as unknown as {
  _cognivaPg?: PgClient;
  _cognivaDb?: DbClient;
};

/**
 * Đọc DATABASE_URL từ env. Throw nếu chưa set — giúp fail-fast với thông báo
 * rõ ràng thay vì để postgres.js báo lỗi connection rối.
 */
function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      '[@cogniva/db] DATABASE_URL is not set. Copy .env.example to .env.local and start the local Postgres with `pnpm db:up`.',
    );
  }
  return url;
}

/** Tạo client postgres.js với pool nhỏ — đủ cho 1 instance Next.js. */
function createClient(): PgClient {
  return postgres(resolveDatabaseUrl(), {
    max: 10,
    // Tắt prepared statement vì pgvector không thân thiện với prepare cache;
    // ngoài ra postgres.js prepare gây lỗi khi dùng với pg-bouncer transaction mode.
    prepare: false,
  });
}

/** Khởi tạo Drizzle client + tận dụng cache xuyên HMR. */
function createDb(): DbClient {
  const client = globalForDb._cognivaPg ?? createClient();
  if (process.env.NODE_ENV !== 'production') globalForDb._cognivaPg = client;
  return drizzle(client, { schema, logger: process.env.NODE_ENV === 'development' });
}

/**
 * Drizzle client xuất ra cho app code. Wrap qua Proxy để hoãn việc kết nối
 * tới khi thực sự có truy vấn — quan trọng cho Next.js build (không cần
 * DATABASE_URL khi compile). Sử dụng giống một Drizzle client bình thường:
 *
 * ```ts
 * import { db, user } from '@cogniva/db';
 * const me = await db.select().from(user).where(eq(user.id, '...')).limit(1);
 * ```
 */
export const db = new Proxy({} as DbClient, {
  get(_target, prop, receiver) {
    if (!globalForDb._cognivaDb) globalForDb._cognivaDb = createDb();
    return Reflect.get(globalForDb._cognivaDb as object, prop, receiver);
  },
});

export type Db = DbClient;
export * from './schema';
export * from './types';

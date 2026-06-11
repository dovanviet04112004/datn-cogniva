import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

type PgClient = ReturnType<typeof postgres>;
type DbClient = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  _cognivaPg?: PgClient;
  _cognivaPgReplica?: PgClient;
};

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
  return process.env.DATABASE_REPLICA_URL ?? null;
}

function createClient(role: 'primary' | 'replica'): PgClient {
  const url = resolveDbUrl(role);
  if (!url) {
    throw new Error(`[@cogniva/db] ${role} URL không có`);
  }

  const max = role === 'replica' ? 15 : 10;

  return postgres(url, {
    max,
    prepare: false,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
    onnotice: process.env.DB_DEBUG === '1' ? undefined : () => {},
  });
}

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
    logger: process.env.DB_DEBUG === '1' && role === 'primary',
  });
}

export const db = new Proxy({} as DbClient, {
  get(_target, prop, receiver) {
    if (!_moduleDb) _moduleDb = createDb('primary');
    return Reflect.get(_moduleDb as object, prop, receiver);
  },
});

export const dbReplica = new Proxy({} as DbClient, {
  get(_target, prop, receiver) {
    if (!process.env.DATABASE_REPLICA_URL) {
      if (!_moduleDb) _moduleDb = createDb('primary');
      return Reflect.get(_moduleDb as object, prop, receiver);
    }
    if (!_moduleDbReplica) _moduleDbReplica = createDb('replica');
    return Reflect.get(_moduleDbReplica as object, prop, receiver);
  },
});

export function hasReplica(): boolean {
  return !!process.env.DATABASE_REPLICA_URL;
}

export function getDbForRegion(_region?: string | null): DbClient {
  return dbReplica;
}

export type Db = DbClient;
export * from './schema';
export * from './types';
export * from './taxonomy-subjects';

export { sql } from 'drizzle-orm';

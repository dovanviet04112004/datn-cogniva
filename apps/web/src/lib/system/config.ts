/**
 * System config helper — read/write `system_config` table.
 *
 * Hai use case chính:
 *   1. Maintenance mode: key='maintenance' → { enabled, banner, dismissible }
 *   2. Feature flags:    key='flags.<name>' → arbitrary JSON
 *
 * Cache 5 giây in-memory để giảm DB hit. Banner config được fetch ở mỗi
 * server render qua `getMaintenanceConfig()` — cache 5s tránh dồn query trên
 * traffic spike. Cache scope per-process — Vercel function instance.
 *
 * KHÔNG dùng cho config bí mật (token, secret) — đó là việc của env vars.
 */
import { eq } from 'drizzle-orm';

import { db, systemConfig } from '@cogniva/db';

const CACHE_TTL_MS = 5_000;

/** Maintenance config shape. */
export type MaintenanceConfig = {
  enabled: boolean;
  /** Banner text hiển thị top trang khi enabled=true. Null = không banner. */
  banner: string | null;
  /** User có thể dismiss banner trong session không. */
  dismissible: boolean;
};

const DEFAULT_MAINTENANCE: MaintenanceConfig = {
  enabled: false,
  banner: null,
  dismissible: true,
};

type CacheEntry<T> = { value: T; expiresAt: number };

const cache = new Map<string, CacheEntry<unknown>>();

/**
 * Đọc 1 key từ system_config với cache 5s. Trả về null nếu key không tồn tại.
 */
export async function getSystemConfig<T>(key: string): Promise<T | null> {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value as T;
  }

  const [row] = await db
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, key))
    .limit(1);

  const value = (row?.value ?? null) as T | null;
  if (value !== null) {
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
  return value;
}

/**
 * Write/upsert 1 key. KHÔNG cache write — caller chỉ admin endpoint, không gọi
 * thường xuyên. Invalidate cache local.
 */
export async function setSystemConfig(
  key: string,
  value: unknown,
  updatedBy: string,
): Promise<void> {
  const now = new Date();
  await db
    .insert(systemConfig)
    .values({ key, value, updatedBy, updatedAt: now })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value, updatedBy, updatedAt: now },
    });
  cache.delete(key);
}

/**
 * Maintenance config với default fallback.
 */
export async function getMaintenanceConfig(): Promise<MaintenanceConfig> {
  const raw = await getSystemConfig<MaintenanceConfig>('maintenance');
  if (!raw) return DEFAULT_MAINTENANCE;
  return {
    enabled: !!raw.enabled,
    banner: typeof raw.banner === 'string' ? raw.banner : null,
    dismissible: raw.dismissible !== false,
  };
}

/**
 * Đọc 1 feature flag. Key = 'flags.<name>'. Trả về null nếu chưa set.
 */
export async function getFlag<T = unknown>(name: string): Promise<T | null> {
  return getSystemConfig<T>(`flags.${name}`);
}

/**
 * List tất cả flags hiện có (admin UI). KHÔNG dùng cho hot path.
 */
export async function listAllFlags(): Promise<
  Array<{ name: string; value: unknown; updatedAt: Date; updatedBy: string | null }>
> {
  const rows = await db
    .select()
    .from(systemConfig);
  return rows
    .filter((r) => r.key.startsWith('flags.'))
    .map((r) => ({
      name: r.key.slice('flags.'.length),
      value: r.value,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    }));
}

/**
 * Clear cache toàn bộ — dùng khi unit test hoặc admin force refresh.
 */
export function clearSystemConfigCache(): void {
  cache.clear();
}

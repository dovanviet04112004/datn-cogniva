import { eq } from 'drizzle-orm';

import { db, systemConfig } from '@cogniva/db';

const CACHE_TTL_MS = 5_000;

export type MaintenanceConfig = {
  enabled: boolean;
  banner: string | null;
  dismissible: boolean;
};

const DEFAULT_MAINTENANCE: MaintenanceConfig = {
  enabled: false,
  banner: null,
  dismissible: true,
};

type CacheEntry<T> = { value: T; expiresAt: number };

const cache = new Map<string, CacheEntry<unknown>>();

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

export async function getMaintenanceConfig(): Promise<MaintenanceConfig> {
  const raw = await getSystemConfig<MaintenanceConfig>('maintenance');
  if (!raw) return DEFAULT_MAINTENANCE;
  return {
    enabled: !!raw.enabled,
    banner: typeof raw.banner === 'string' ? raw.banner : null,
    dismissible: raw.dismissible !== false,
  };
}

export async function getFlag<T = unknown>(name: string): Promise<T | null> {
  return getSystemConfig<T>(`flags.${name}`);
}

export async function listAllFlags(): Promise<
  Array<{ name: string; value: unknown; updatedAt: Date; updatedBy: string | null }>
> {
  const rows = await db.select().from(systemConfig);
  return rows
    .filter((r) => r.key.startsWith('flags.'))
    .map((r) => ({
      name: r.key.slice('flags.'.length),
      value: r.value,
      updatedAt: r.updatedAt,
      updatedBy: r.updatedBy,
    }));
}

export function clearSystemConfigCache(): void {
  cache.clear();
}

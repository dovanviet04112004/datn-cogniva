import type { QueryClient } from '@tanstack/react-query';
import { get, set, del } from 'idb-keyval';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

const idbStorage = {
  getItem: (key: string) => get<string>(key).then((v) => v ?? null),
  setItem: (key: string, value: string) => set(key, value),
  removeItem: (key: string) => del(key),
};

export const idbPersister = createAsyncStoragePersister({
  storage: idbStorage,
  key: 'cogniva-react-query',
  throttleTime: 1000,
});

export async function purgeQueryCache(qc: QueryClient): Promise<void> {
  qc.clear();
  await idbPersister.removeClient();
}

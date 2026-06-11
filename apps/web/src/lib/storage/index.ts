export interface Storage {
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;

  get(key: string): Promise<Buffer>;

  delete(key: string): Promise<void>;

  exists(key: string): Promise<boolean>;
}

import { LocalStorage } from './local';
import { R2Storage } from './r2';

let _storage: Storage | undefined;

function resolveDriver(): 'local' | 'r2' {
  const explicit = process.env.STORAGE_DRIVER?.toLowerCase();
  if (explicit === 'r2' || explicit === 'local') return explicit;
  const hasR2 =
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY &&
    !!process.env.R2_ACCOUNT_ID;
  return hasR2 ? 'r2' : 'local';
}

export function getStorage(): Storage {
  if (_storage) return _storage;
  _storage = resolveDriver() === 'r2' ? new R2Storage() : new LocalStorage();
  return _storage;
}

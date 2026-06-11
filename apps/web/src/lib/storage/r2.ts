import {
  LIBRARY_BUCKET,
  deleteR2Object,
  getR2Object,
  putR2Object,
  r2ObjectExists,
} from '../r2-client';

import type { Storage } from './index';

export class R2Storage implements Storage {
  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    await putR2Object(key, body, contentType);
  }

  async get(key: string): Promise<Buffer> {
    return getR2Object(key);
  }

  async delete(key: string): Promise<void> {
    await deleteR2Object(key, LIBRARY_BUCKET);
  }

  async exists(key: string): Promise<boolean> {
    return r2ObjectExists(key);
  }
}

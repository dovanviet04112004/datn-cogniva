import fs from 'node:fs/promises';
import path from 'node:path';

import type { Storage } from './index';

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');

function safeJoin(key: string): string {
  if (key.includes('..')) {
    throw new Error(`[storage] illegal key with '..': ${key}`);
  }
  return path.join(UPLOADS_DIR, key);
}

export class LocalStorage implements Storage {
  async put(key: string, body: Buffer | Uint8Array, _contentType: string): Promise<void> {
    const target = safeJoin(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, body);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(safeJoin(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(safeJoin(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(safeJoin(key));
      return true;
    } catch {
      return false;
    }
  }
}

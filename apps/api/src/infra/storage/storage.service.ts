import path from 'node:path';
import fs from 'node:fs/promises';

import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

interface StorageDriver {
  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), '../web/uploads');

function safeJoin(key: string): string {
  if (key.includes('..')) {
    throw new Error(`[storage] illegal key with '..': ${key}`);
  }
  return path.join(UPLOADS_DIR, key);
}

class LocalDriver implements StorageDriver {
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

const LIBRARY_BUCKET =
  process.env.R2_LIBRARY_BUCKET ?? process.env.R2_BUCKET_NAME ?? 'cogniva-library';

class R2Driver implements StorageDriver {
  private s3: S3Client | null = null;

  private client(): S3Client {
    if (this.s3) return this.s3;
    const accessKey = process.env.R2_ACCESS_KEY_ID;
    const secret = process.env.R2_SECRET_ACCESS_KEY;
    const accountId = process.env.R2_ACCOUNT_ID;
    if (!accessKey || !secret || !accountId) {
      throw new Error(
        'R2 env chưa đủ — cần R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ACCOUNT_ID',
      );
    }
    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKey, secretAccessKey: secret },
      forcePathStyle: true,
    });
    return this.s3;
  }

  async put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    await this.client().send(
      new PutObjectCommand({
        Bucket: LIBRARY_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client().send(
      new GetObjectCommand({ Bucket: LIBRARY_BUCKET, Key: key }),
    );
    if (!res.Body) throw new Error(`R2 object empty: ${key}`);
    const chunks: Uint8Array[] = [];
    const stream = res.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client().send(new DeleteObjectCommand({ Bucket: LIBRARY_BUCKET, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client().send(new HeadObjectCommand({ Bucket: LIBRARY_BUCKET, Key: key }));
      return true;
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return false;
      throw err;
    }
  }

  async presignPut(key: string, contentType: string, expiresSeconds: number): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: LIBRARY_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getSignedUrl(this.client() as any, cmd as any, { expiresIn: expiresSeconds });
  }

  async presignGet(key: string, expiresSeconds: number): Promise<string> {
    const cmd = new GetObjectCommand({ Bucket: LIBRARY_BUCKET, Key: key });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return getSignedUrl(this.client() as any, cmd as any, { expiresIn: expiresSeconds });
  }
}

function resolveDriver(): 'local' | 'r2' {
  const explicit = process.env.STORAGE_DRIVER?.toLowerCase();
  if (explicit === 'r2' || explicit === 'local') return explicit;
  const hasR2 =
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY &&
    !!process.env.R2_ACCOUNT_ID;
  return hasR2 ? 'r2' : 'local';
}

@Injectable()
export class StorageService implements StorageDriver {
  private readonly driver: StorageDriver =
    resolveDriver() === 'r2' ? new R2Driver() : new LocalDriver();

  private readonly r2: R2Driver = this.driver instanceof R2Driver ? this.driver : new R2Driver();

  put(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
    return this.driver.put(key, body, contentType);
  }

  get(key: string): Promise<Buffer> {
    return this.driver.get(key);
  }

  delete(key: string): Promise<void> {
    return this.driver.delete(key);
  }

  exists(key: string): Promise<boolean> {
    return this.driver.exists(key);
  }

  getPresignedUploadUrl(
    storageKey: string,
    contentType: string,
    expiresSeconds = 900,
  ): Promise<string> {
    return this.r2.presignPut(storageKey, contentType, expiresSeconds);
  }

  getPresignedDownloadUrl(storageKey: string, expiresSeconds = 3600): Promise<string> {
    return this.r2.presignGet(storageKey, expiresSeconds);
  }

  getPublicUrl(storageKey: string): string {
    const base = process.env.R2_LIBRARY_PUBLIC_URL ?? process.env.R2_PUBLIC_URL;
    if (base) return `${base.replace(/\/$/, '')}/${storageKey}`;
    const accountId = process.env.R2_ACCOUNT_ID;
    return `https://${accountId}.r2.cloudflarestorage.com/${LIBRARY_BUCKET}/${storageKey}`;
  }
}

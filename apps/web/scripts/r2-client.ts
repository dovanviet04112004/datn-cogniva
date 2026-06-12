import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let _s3: S3Client | null = null;

function getR2Client(): S3Client {
  if (_s3) return _s3;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accessKey || !secret || !accountId) {
    throw new Error('R2 env chưa đủ — cần R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY + R2_ACCOUNT_ID');
  }
  _s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secret },
    forcePathStyle: true,
  });
  return _s3;
}

export const LIBRARY_BUCKET =
  process.env.R2_LIBRARY_BUCKET ?? process.env.R2_BUCKET_NAME ?? 'cogniva-library';

export async function deleteR2Object(
  storageKey: string,
  bucket: string = process.env.R2_BUCKET_NAME ?? 'cogniva-recordings',
): Promise<void> {
  await getR2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
}

export async function getPresignedUploadUrl(
  storageKey: string,
  contentType: string,
  expiresSeconds = 900,
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: LIBRARY_BUCKET,
    Key: storageKey,
    ContentType: contentType,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSignedUrl(getR2Client() as any, cmd as any, { expiresIn: expiresSeconds });
}

export async function getPresignedDownloadUrl(
  storageKey: string,
  expiresSeconds = 3600,
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: LIBRARY_BUCKET,
    Key: storageKey,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getSignedUrl(getR2Client() as any, cmd as any, { expiresIn: expiresSeconds });
}

export function getPublicUrl(storageKey: string): string {
  const base = process.env.R2_LIBRARY_PUBLIC_URL ?? process.env.R2_PUBLIC_URL;
  if (base) return `${base.replace(/\/$/, '')}/${storageKey}`;
  const accountId = process.env.R2_ACCOUNT_ID;
  return `https://${accountId}.r2.cloudflarestorage.com/${LIBRARY_BUCKET}/${storageKey}`;
}

export async function putR2Object(
  storageKey: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: LIBRARY_BUCKET,
      Key: storageKey,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function r2ObjectExists(storageKey: string): Promise<boolean> {
  try {
    await getR2Client().send(new HeadObjectCommand({ Bucket: LIBRARY_BUCKET, Key: storageKey }));
    return true;
  } catch (err) {
    const code = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (code.name === 'NotFound' || code.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

export async function getR2Object(storageKey: string): Promise<Buffer> {
  const res = await getR2Client().send(
    new GetObjectCommand({ Bucket: LIBRARY_BUCKET, Key: storageKey }),
  );
  if (!res.Body) throw new Error(`R2 object empty: ${storageKey}`);
  const chunks: Uint8Array[] = [];
  const stream = res.Body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

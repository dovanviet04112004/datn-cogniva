import { PutBucketCorsCommand, GetBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

const BUCKET = process.env.R2_LIBRARY_BUCKET ?? process.env.R2_BUCKET_NAME ?? 'cogniva-library';

const ORIGINS = [process.env.NEXT_PUBLIC_APP_URL, 'http://localhost:3000', 'http://127.0.0.1:3000']
  .filter((o): o is string => Boolean(o))
  .map((o) => o.replace(/\/$/, ''));

async function main() {
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secret = process.env.R2_SECRET_ACCESS_KEY;
  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accessKey || !secret || !accountId) {
    throw new Error('Thiếu R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID');
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: accessKey, secretAccessKey: secret },
    forcePathStyle: true,
  });

  const origins = [...new Set(ORIGINS)];
  console.log(`Bucket: ${BUCKET}`);
  console.log(`AllowedOrigins: ${origins.join(', ')}`);

  await s3.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: origins,
            AllowedMethods: ['PUT', 'GET', 'HEAD'],
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log('✅ PutBucketCors OK');

  const got = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
  console.log('Xác nhận CORSRules:', JSON.stringify(got.CORSRules, null, 2));
}

main().catch((e) => {
  console.error('❌ Lỗi set CORS:', e);
  process.exit(1);
});

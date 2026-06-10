/**
 * setup-r2-cors — cấu hình CORS cho bucket R2 (chạy 1 lần).
 *
 * Lý do: upload tài liệu ở Library dùng presigned URL → browser PUT THẲNG lên
 * `https://{account}.r2.cloudflarestorage.com` (cross-origin). Nếu bucket chưa
 * có CORS policy cho origin app, browser chặn preflight → fetch reject
 * "Failed to fetch" (lỗi user đang gặp khi bấm Upload).
 *
 * Script set AllowedOrigins = origin app (localhost + prod) cho PUT/GET/HEAD,
 * giữ kiến trúc upload thẳng browser→R2 (server không phải proxy file 20MB).
 *
 * Chạy:  cd apps/web && pnpm exec tsx --env-file=.env.local scripts/setup-r2-cors.ts
 */
import { PutBucketCorsCommand, GetBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';

// Bucket library dùng (khớp logic LIBRARY_BUCKET trong src/lib/r2-client.ts).
const BUCKET =
  process.env.R2_LIBRARY_BUCKET ?? process.env.R2_BUCKET_NAME ?? 'cogniva-library';

// Origin được phép PUT — dev + prod. Lấy từ env, thêm sẵn localhost dev.
const ORIGINS = [
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]
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
            // Content-Type cần cho presigned PUT; '*' phủ các header browser gửi.
            AllowedHeaders: ['*'],
            ExposeHeaders: ['ETag'],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    }),
  );
  console.log('✅ PutBucketCors OK');

  // Đọc lại để xác nhận.
  const got = await s3.send(new GetBucketCorsCommand({ Bucket: BUCKET }));
  console.log('Xác nhận CORSRules:', JSON.stringify(got.CORSRules, null, 2));
}

main().catch((e) => {
  console.error('❌ Lỗi set CORS:', e);
  process.exit(1);
});

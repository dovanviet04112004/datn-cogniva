/**
 * verify-r2-cors — kiểm CORS bucket R2 có cho browser PUT không (không cần mở trình duyệt).
 *
 * Cách: tạo presigned PUT URL (giống hệt upload web) rồi gửi OPTIONS preflight
 * kèm Origin + Access-Control-Request-Method như browser làm. Đọc header trả về:
 *   - access-control-allow-origin khớp origin → CORS OK
 *   - thiếu → browser sẽ chặn → "Failed to fetch"
 *
 * Chạy: cd apps/web && pnpm exec tsx --env-file=.env.local scripts/verify-r2-cors.ts
 */
import { getPresignedUploadUrl } from '../src/lib/r2-client';

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';

async function main() {
  const key = `lib/_corscheck/probe-${Date.now()}.pdf`;
  const url = await getPresignedUploadUrl(key, 'application/pdf', 300);
  console.log('Presigned URL host:', new URL(url).host);
  console.log('Origin test:', ORIGIN);

  const res = await fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type',
    },
  });

  const allowOrigin = res.headers.get('access-control-allow-origin');
  const allowMethods = res.headers.get('access-control-allow-methods');
  console.log('\n--- Preflight response ---');
  console.log('status:', res.status);
  console.log('access-control-allow-origin:', allowOrigin);
  console.log('access-control-allow-methods:', allowMethods);

  if (allowOrigin && (allowOrigin === '*' || allowOrigin === ORIGIN)) {
    console.log('\n✅ CORS OK — browser PUT từ', ORIGIN, 'sẽ được phép.');
  } else {
    console.log('\n❌ CORS CHƯA OK — thiếu access-control-allow-origin cho', ORIGIN);
    console.log('   → kiểm lại CORS policy đã save đúng bucket cogniva-recordings chưa.');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('Lỗi probe:', e);
  process.exit(1);
});

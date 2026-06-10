/**
 * Golden contract snapshot (plan §10.1) — lưới chống silent-breakage khi port
 * route từ Next sang NestJS: response 2 backend phải GIỐNG HỆT về shape.
 *
 * Cách dùng (mỗi wave, cho từng domain):
 *   1. Chụp golden từ backend HIỆN TẠI (Next):
 *      node test/contract/capture.mjs --manifest test/contract/manifests/<domain>.json \
 *           --base http://localhost:3000 --out test/contract/golden/<domain>
 *   2. Port xong → chụp lại từ Nest (--base http://localhost:4000, --out .../<domain>.nest)
 *   3. Diff 2 thư mục — khác shape = chưa được cutover.
 *
 * Manifest JSON: [{ "name": "list", "method": "GET", "path": "/api/workspaces" }, …]
 * Auth: env CONTRACT_COOKIE (cookie đăng nhập) hoặc CONTRACT_BEARER.
 * Field volatile (id/timestamp/token) được normalize để diff ổn định.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, arr) => {
    if (v.startsWith('--')) acc.push([v.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
if (!args.manifest || !args.base || !args.out) {
  console.error('Cần --manifest <file> --base <url> --out <dir>');
  process.exit(1);
}

const VOLATILE_KEYS = /^(id|.*Id|.*_id|token|createdAt|updatedAt|created_at|updated_at|expiresAt|expires_at|timestamp|lastMessageAt|due)$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Thay giá trị volatile bằng placeholder theo KIỂU — shape giữ nguyên. */
function normalize(value, key = '') {
  if (Array.isArray(value)) return value.map((v) => normalize(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
  }
  if (typeof value === 'string' && (VOLATILE_KEYS.test(key) || ISO_DATE.test(value))) {
    return `<${typeof value}>`;
  }
  if (typeof value === 'number' && VOLATILE_KEYS.test(key)) return '<number>';
  return value;
}

const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'));
mkdirSync(args.out, { recursive: true });

const headers = {};
if (process.env.CONTRACT_COOKIE) headers.cookie = process.env.CONTRACT_COOKIE;
if (process.env.CONTRACT_BEARER) headers.authorization = `Bearer ${process.env.CONTRACT_BEARER}`;

let failed = 0;
for (const route of manifest) {
  const res = await fetch(`${args.base}${route.path}`, {
    method: route.method ?? 'GET',
    headers: { ...headers, ...(route.body ? { 'content-type': 'application/json' } : {}) },
    body: route.body ? JSON.stringify(route.body) : undefined,
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? normalize(await res.json()) : `<non-json:${ct}>`;
  const snapshot = { status: res.status, contentType: ct.split(';')[0], body };
  writeFileSync(join(args.out, `${route.name}.json`), JSON.stringify(snapshot, null, 2) + '\n');
  const ok = res.status === (route.expectStatus ?? res.status);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${route.method ?? 'GET'} ${route.path} → ${res.status}`);
}
process.exit(failed ? 1 : 0);

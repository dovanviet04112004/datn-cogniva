/**
 * Sinh apps/api/.env từ apps/web/.env.local (DB = Neon) + keypair ES256.
 * Chạy lại bất kỳ lúc nào — ghi đè .env (idempotent). Không in secret.
 */
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const webEnv = readFileSync(join(apiDir, '../web/.env.local'), 'utf8');

const get = (key) => {
  for (const raw of webEnv.split(/\r?\n/)) {
    if (!raw.startsWith(key + '=')) continue;
    let v = raw.slice(key.length + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return null;
};

const pooled = new URL(get('DATABASE_URL'));
if (!pooled.searchParams.has('pgbouncer')) pooled.searchParams.set('pgbouncer', 'true');
const direct = new URL(pooled.toString());
direct.hostname = direct.hostname.replace('-pooler', '');
direct.searchParams.delete('pgbouncer');

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = (k, type) => k.export({ type, format: 'pem' }).trim().replaceAll('\n', '\\n');

const lines = [
  '# apps/api/.env — sinh bởi scripts/setup-env.mjs từ apps/web/.env.local.',
  '# ⚠️ DB = NEON (không phải localhost). Migration phải apply CẢ Neon lẫn docker local.',
  'PORT=4000',
  'NODE_ENV=development',
  `DATABASE_URL="${pooled.toString()}"`,
  `DIRECT_DATABASE_URL="${direct.toString()}"`,
  `DATABASE_URL_LOCAL="postgresql://cogniva:cogniva@localhost:5432/cogniva"`,
  `REDIS_URL="${get('REDIS_URL')}"`,
  `BETTER_AUTH_SECRET="${get('BETTER_AUTH_SECRET')}"`,
  `AUTH_JWT_PRIVATE_KEY="${pem(privateKey, 'pkcs8')}"`,
  `AUTH_JWT_PUBLIC_KEY="${pem(publicKey, 'spki')}"`,
];
// Key optional — chỉ ghi khi web có cấu hình (OAuth, AI providers, APP_URL).
const appUrl = get('NEXT_PUBLIC_APP_URL') ?? get('BETTER_AUTH_URL');
if (appUrl) lines.push(`APP_URL="${appUrl}"`);
for (const k of [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GROQ_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'VOYAGE_API_KEY',
  'COHERE_API_KEY',
  'CRON_SECRET',
  // Wave 3: storage R2 + embedding provider — api phải CÙNG driver với web,
  // không thì upload (Nest) ghi local mà file proxy/web đọc R2 và ngược lại.
  'STORAGE_DRIVER',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCOUNT_ID',
  'R2_BUCKET_NAME',
  'R2_LIBRARY_BUCKET',
  'R2_PUBLIC_URL',
  'R2_LIBRARY_PUBLIC_URL',
  'EMBEDDING_PROVIDER',
  'UPLOADS_DIR',
  'LLM_PROVIDER',
]) {
  const v = get(k);
  if (v) lines.push(`${k}="${v}"`);
}
writeFileSync(join(apiDir, '.env'), lines.join('\n') + '\n');
console.log('OK — pooled host:', pooled.hostname, '| direct host:', direct.hostname);

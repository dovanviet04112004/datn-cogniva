import { generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const webEnv = readFileSync(join(apiDir, '../web/.env.local'), 'utf8');
const prevEnv = existsSync(join(apiDir, '.env')) ? readFileSync(join(apiDir, '.env'), 'utf8') : '';
const getPrev = (key) => {
  const m = prevEnv.match(new RegExp(`^${key}="?(.*?)"?$`, 'm'));
  return m ? m[1] : null;
};

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

let privPem = getPrev('AUTH_JWT_PRIVATE_KEY');
let pubPem = getPrev('AUTH_JWT_PUBLIC_KEY');
if (!privPem || !pubPem) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = (k, type) => k.export({ type, format: 'pem' }).trim().replaceAll('\n', '\\n');
  privPem = pem(privateKey, 'pkcs8');
  pubPem = pem(publicKey, 'spki');
}

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
  `AUTH_JWT_PRIVATE_KEY="${privPem}"`,
  `AUTH_JWT_PUBLIC_KEY="${pubPem}"`,
];
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
  'LIVEKIT_API_KEY',
  'LIVEKIT_API_SECRET',
  'NEXT_PUBLIC_LIVEKIT_URL',
  'JWT_SECRET',
  'NEXT_PUBLIC_HOCUSPOCUS_URL',
  'PAYMENT_PROVIDER',
  'VNPAY_TMN_CODE',
  'VNPAY_HASH_SECRET',
  'VNPAY_RETURN_URL',
  'VNPAY_PAY_URL',
  'VNPAY_REFUND_URL',
  'MOMO_PARTNER_CODE',
  'MOMO_ACCESS_KEY',
  'MOMO_SECRET_KEY',
  'MOMO_CREATE_URL',
  'MOMO_REFUND_URL',
  'MOMO_RETURN_URL',
  'MOMO_IPN_URL',
  'TUTORING_ESCROW_HOURS',
  'NEXT_PUBLIC_REALTIME_URL',
]) {
  const v = get(k);
  if (v) lines.push(`${k}="${v}"`);
}
writeFileSync(join(apiDir, '.env'), lines.join('\n') + '\n');
console.log('OK — pooled host:', pooled.hostname, '| direct host:', direct.hostname);

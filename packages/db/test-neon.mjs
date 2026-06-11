import { readFileSync } from 'node:fs';
import postgres from 'postgres';

function resolveUrl(envName, fileName, argIdx) {
  if (process.env[envName]) return process.env[envName];
  if (process.argv[argIdx]) return process.argv[argIdx];
  try {
    return readFileSync(new URL(fileName, import.meta.url), 'utf8').trim();
  } catch {
    return null;
  }
}

function mask(url) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
}

async function probe(label, url) {
  console.log(`\n──────── ${label} ────────`);
  console.log('🔗', mask(url));

  const isPooler = /-pooler\./.test(url);
  const hasSsl = /sslmode=require/.test(url) || /\.neon\.tech/.test(url);
  console.log(`   pooler endpoint : ${isPooler ? '✓ (-pooler)' : '⚠ KHÔNG — serverless nên dùng pooler'}`);
  console.log(`   ssl            : ${hasSsl ? '✓' : '⚠ Neon cần SSL (sslmode=require)'}`);

  const sql = postgres(url, {
    prepare: false,
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    ssl: 'require',
  });

  try {
    const t0 = Date.now();
    const [{ version }] = await sql`SELECT version()`;
    const latency = Date.now() - t0;
    const [{ db }] = await sql`SELECT current_database() AS db`;
    const [{ ts }] = await sql`SELECT now() AS ts`;
    const [{ one }] = await sql`SELECT 1 AS one`;
    const [{ n }] = await sql`
      SELECT count(*)::int AS n
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `;

    console.log('\n✅ KẾT NỐI OK');
    console.log('   server   :', version.split(' on ')[0]);
    console.log('   database :', db);
    console.log('   now()    :', ts.toISOString());
    console.log('   SELECT 1 :', one);
    console.log('   latency  :', latency, 'ms', latency > 400 ? '(region xa? cân nhắc đổi region gần VN)' : '');
    console.log('   bảng public:', n, n === 0 ? '→ DB TRỐNG, cần push schema trước khi app chạy' : '→ đã có schema');
    await sql.end();
    return true;
  } catch (err) {
    console.error('\n❌ LỖI:', err.message);
    if (/password|auth/i.test(err.message)) console.error('   → sai user/password trong URL');
    if (/ENOTFOUND|getaddrinfo/i.test(err.message)) console.error('   → sai host (copy thiếu/thừa) hoặc mất mạng');
    if (/timeout/i.test(err.message)) console.error('   → host không phản hồi (firewall? sai endpoint?)');
    if (/SSL|ssl/i.test(err.message)) console.error('   → vấn đề SSL — thêm ?sslmode=require');
    await sql.end().catch(() => {});
    return false;
  }
}

const primary = resolveUrl('NEON_TEST_URL', '.neon-url.txt', 2);
if (!primary) {
  console.error('❌ Chưa có URL. Bỏ URL vào packages/db/.neon-url.txt rồi chạy lại,');
  console.error('   hoặc: NEON_TEST_URL="postgresql://..." node test-neon.mjs');
  process.exit(1);
}

const okPrimary = await probe('PRIMARY (DATABASE_URL)', primary);

const replica = resolveUrl('NEON_TEST_REPLICA_URL', '.neon-replica-url.txt', 3);
let okReplica = true;
if (replica) okReplica = await probe('REPLICA (DATABASE_REPLICA_URL)', replica);

console.log('\n════════ KẾT QUẢ ════════');
console.log('PRIMARY:', okPrimary ? '✅ OK' : '❌ FAIL');
if (replica) console.log('REPLICA:', okReplica ? '✅ OK' : '❌ FAIL');
console.log('\n⚠ Nhớ XOÁ .neon-url.txt sau khi test (chứa password).');
process.exit(okPrimary && okReplica ? 0 : 1);

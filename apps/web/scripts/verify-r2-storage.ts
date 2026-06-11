import { R2Storage } from '../src/lib/storage/r2';

async function main() {
  const s = new R2Storage();
  const key = `lib/_selftest/roundtrip-${Date.now()}.bin`;
  const payload = Buffer.from('cogniva r2 storage selftest àéí', 'utf8');

  await s.put(key, payload, 'application/octet-stream');
  const exists1 = await s.exists(key);
  const got = await s.get(key);
  const match = got.equals(payload);
  await s.delete(key);
  const exists2 = await s.exists(key);

  console.log('put/exists:', exists1);
  console.log('get byte-match:', match);
  console.log('delete/exists:', exists2);

  const ok = exists1 && match && !exists2;
  if (!ok) {
    console.log('\n❌ Roundtrip FAIL');
    process.exit(2);
  }
  console.log('\n✅ Roundtrip OK (put/get/exists/delete đều đúng).');

  const migratedKey = process.argv[2];
  if (migratedKey) {
    const buf = await s.get(migratedKey);
    console.log(`\n✅ Đọc lại file migrate "${migratedKey}": ${(buf.length / 1024).toFixed(0)} KB`);
  }
}

main().catch((e) => {
  console.error('Lỗi verify:', e);
  process.exit(1);
});

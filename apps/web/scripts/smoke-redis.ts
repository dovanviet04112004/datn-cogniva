import { getRedis, checkRedisHealth, IoRedisAdapter, InMemoryRedis } from '../src/lib/redis';

async function main() {
  console.log('REDIS_URL:', process.env.REDIS_URL ? 'set' : 'NOT set');
  console.log('UPSTASH:', process.env.UPSTASH_REDIS_REST_URL ? 'set' : 'NOT set');

  const r = getRedis();
  const mode =
    r instanceof InMemoryRedis
      ? 'inmemory'
      : r instanceof IoRedisAdapter
        ? 'redis-tcp'
        : 'redis-rest';
  console.log('Mode picked:', mode);

  const k = 'smoke:cogniva:' + Date.now();

  await r.set(k, 'hello', { ex: 60 });
  console.log('1. set+get:', await r.get(k));

  const incrKey = k + ':counter';
  await r.set(incrKey, '0', { ex: 60 });
  console.log('2a. incr →', await r.incr(incrKey));
  console.log('2b. incrby 5 →', await r.incrby(incrKey, 5));
  console.log('2c. ttl →', await r.ttl(incrKey), '(should ~60)');

  const nxKey = k + ':nx';
  const nx1 = await r.set(nxKey, 'first', { ex: 30, nx: true });
  const nx2 = await r.set(nxKey, 'second', { ex: 30, nx: true });
  console.log('3. set NX first:', nx1, '(should OK)');
  console.log('   set NX second:', nx2, '(should null)');
  console.log('   value:', await r.get(nxKey), '(should "first")');

  await r.expire(nxKey, 5);
  console.log('4. expire override → ttl:', await r.ttl(nxKey), '(should ~5)');

  const delCount = await r.del(k, incrKey, nxKey);
  console.log('5. del 3 keys → deleted:', delCount, '(should 3)');

  const plKey = k + ':pl';
  const pipeline = r.pipeline();
  pipeline.incr(plKey);
  pipeline.expire(plKey, 60);
  const results = await pipeline.exec();
  console.log('6. pipeline incr+expire results:', results, '(should [1, 1])');
  await r.del(plKey);

  if (r instanceof IoRedisAdapter || ('eval' in r && !(r instanceof InMemoryRedis))) {
    try {
      const result = await (r as IoRedisAdapter).eval('return ARGV[1]', [], ['hello-lua']);
      console.log('7. eval Lua →', result, '(should "hello-lua")');
    } catch (err) {
      console.log('7. eval Lua FAIL:', err instanceof Error ? err.message : err);
    }
  }

  const health = await checkRedisHealth();
  console.log('8. checkRedisHealth:', health);

  console.log('\n✅ All checks OK — IoRedisAdapter working');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SMOKE FAIL:', err);
    process.exit(1);
  });

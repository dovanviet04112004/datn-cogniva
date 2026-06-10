/**
 * SHIM — Redis client đã move sang @cogniva/server-core (Next + NestJS dùng
 * chung, plan §5.3). Giữ path cũ để ~60 import site không phải đổi; XÓA shim
 * khi web không còn route/lib server nào import (cuối GĐ1).
 */
export {
  getRedis,
  zRevRangeWithScores,
  checkRedisHealth,
  IoRedisAdapter,
  InMemoryRedis,
  type RedisClient,
} from '@cogniva/server-core/redis';

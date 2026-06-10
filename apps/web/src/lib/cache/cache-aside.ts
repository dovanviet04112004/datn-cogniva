/**
 * SHIM — cache-aside đã move sang @cogniva/server-core (plan §5.3).
 * XÓA khi web không còn import (cuối GĐ1).
 */
export {
  cached,
  cacheDelete,
  cacheVersion,
  bumpCacheVersion,
} from '@cogniva/server-core/cache/cache-aside';

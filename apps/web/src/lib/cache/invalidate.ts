/**
 * SHIM — invalidator choke-point đã move sang @cogniva/server-core (plan §5.3).
 * Next + NestJS PHẢI gọi cùng 1 bộ hàm này — fork là stale-data.
 * XÓA khi web không còn import (cuối GĐ1).
 */
export * from '@cogniva/server-core/cache/invalidate';

/**
 * SHIM — key factory `ck` đã move sang @cogniva/server-core (plan §5.3).
 * XÓA khi web không còn import (cuối GĐ1).
 */
export { ck, LB_XP, TAG_LIBRARY } from '@cogniva/server-core/cache/keys';

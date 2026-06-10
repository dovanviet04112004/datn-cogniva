/**
 * SHIM — realtime emitter đã move sang @cogniva/server-core (plan §5.3).
 * XÓA khi web không còn import (cuối GĐ1).
 */
export { triggerEvent } from '@cogniva/server-core/realtime-emitter';

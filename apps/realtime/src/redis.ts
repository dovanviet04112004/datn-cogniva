import IORedis from 'ioredis';

import { cfg } from './config';

export const pubClient = new IORedis(cfg.redisUrl, { maxRetriesPerRequest: null });
export const subClient = pubClient.duplicate();
export const redis = new IORedis(cfg.redisUrl);

for (const [name, client] of [
  ['pub', pubClient],
  ['sub', subClient],
  ['cmd', redis],
] as const) {
  client.on('error', (err) => console.error(`[realtime/redis:${name}]`, err.message));
}
